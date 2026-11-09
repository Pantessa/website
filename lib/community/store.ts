// COMMUNITY STORE — the server functions every lane calls (lane CORE owns the
// bodies; the SIGNATURES are the squad contract — add, never change one
// without a note in the blackboard). The bot lanes call these directly; the
// pages go through the HTTP routes built on them. Server-only.
//
// Rules that hold in every body (pinned by CORE):
//   · a member is a PROVEN key (lib/community/identity) — never a typed one
//   · public lists and counts fence is_internal:false; a by-slug read is the
//     one unfenced read (the /i/<slug> rule)
//   · a secret (a Discord webhook URL) never leaves this module's write path
//   · join is idempotent; member_count moves only on a real insert/delete

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { authorLabel, decoratePosts, handlesFor, type PostRow } from '@/lib/chart-posts'
import { chartPairFor } from '@/lib/charts'
import { mintSlug } from '@/lib/intent-links'
import { absoluteUrl } from '@/lib/site-url'
import { hourStartUTC } from '@/lib/turn-limits'
import { REAL_TRAFFIC_WHERE } from '@/lib/value-origin'
import { chainNameFor, explorerTxFor } from './proof-words'
import {
  ANNOUNCE_HOURLY_CAP,
  COMMUNITY_SLUG_RE,
  FEED_PAGE,
  INVITE_CODE_RE,
  LINK_CODE_RE,
  LINK_CODE_TTL_MS,
  hotRank,
  invitePath,
  isMemberKey,
  parseVideoUrl,
  walletKey,
  walletOfKey,
  type Actor,
  type AnnounceFrom,
  type ChannelPlatform,
  type CommunityRole,
  type FeedKind,
  type FeedPost,
  type FeedSort,
  type FeedWindow,
  type MemberKey,
  type MemberSource,
  type MyMembership,
  type PublicCommunity,
  type PublicMember,
  type TradeProof,
} from './spec'
import {
  HOT_SCAN,
  HOT_WINDOW_MS,
  WINDOW_MS,
  asRole,
  asSource,
  canManage,
  checkAbout,
  checkName,
  checkSlug,
  checkSymbols,
  decodeCursor,
  encodeCursor,
  higherRole,
  labelWithSource,
  memberLabel,
} from './rules'

export type StoreRefusal = { ok: false; status: number; reason: string }
const refuse = (status: number, reason: string): StoreRefusal => ({ ok: false, status, reason })

export interface CommunityDraft {
  slug: string
  name: string
  about?: string
  symbols?: string[]
}

type CommunityRow = { slug: string; name: string; about: string; owner: string; symbols: string[]; memberCount: number; isInternal: boolean; createdAt: Date }

const WEEK_MS = 7 * 86_400_000
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'

/** Rows → PublicCommunity in three batched reads (posts this week, channels, owner handles). */
async function decorateCommunities(rows: CommunityRow[]): Promise<PublicCommunity[]> {
  if (rows.length === 0) return []
  const slugs = rows.map((r) => r.slug)
  const since = new Date(Date.now() - WEEK_MS)
  const [weekly, channels, handles] = await Promise.all([
    prisma.chartPost
      .groupBy({ by: ['communitySlug'], where: { communitySlug: { in: slugs }, isInternal: false, createdAt: { gte: since } }, _count: { _all: true } })
      .catch(() => [] as { communitySlug: string | null; _count: { _all: number } }[]),
    prisma.communityChannel.findMany({ where: { communitySlug: { in: slugs } }, select: { communitySlug: true, platform: true, title: true }, orderBy: { createdAt: 'asc' } }).catch(() => []),
    handlesFor(rows.map((r) => r.owner)),
  ])
  const week = new Map(weekly.map((w) => [w.communitySlug ?? '', w._count._all]))
  const chans = new Map<string, PublicCommunity['channels']>()
  for (const c of channels) {
    const list = chans.get(c.communitySlug) ?? []
    list.push({ platform: c.platform === 'discord' ? 'discord' : 'telegram', title: c.title ?? null })
    chans.set(c.communitySlug, list)
  }
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    about: r.about,
    symbols: r.symbols,
    members: r.memberCount,
    postsWeek: week.get(r.slug) ?? 0,
    channels: chans.get(r.slug) ?? [],
    ownerLabel: authorLabel(r.owner, handles.get(r.owner.toLowerCase())),
    createdAt: Math.floor(r.createdAt.getTime() / 1000),
  }))
}

const normSlug = (s: string) => (typeof s === 'string' ? s.trim().toLowerCase() : '')

export async function createCommunity(owner: string, draft: CommunityDraft, isInternal: boolean): Promise<{ ok: true; community: PublicCommunity } | StoreRefusal> {
  const slug = checkSlug(draft.slug)
  if (!slug.ok) return refuse(400, slug.reason)
  const name = checkName(draft.name)
  if (!name.ok) return refuse(400, name.reason)
  const about = checkAbout(draft.about)
  if (!about.ok) return refuse(400, about.reason)
  const symbols = checkSymbols(draft.symbols)
  if (!symbols.ok) return refuse(400, symbols.reason)
  const o = owner.toLowerCase()
  try {
    await prisma.$transaction([
      prisma.community.create({ data: { slug: slug.value, name: name.value, about: about.value, owner: o, symbols: symbols.value, memberCount: 1, isInternal } }),
      prisma.communityMember.create({ data: { communitySlug: slug.value, memberKey: walletKey(o), wallet: o, role: 'owner', source: 'site', isInternal } }),
    ])
  } catch (e) {
    if (isUnique(e)) return refuse(409, `/g/${slug.value} is taken. Pick another slug.`)
    throw e
  }
  const community = await getCommunity(slug.value)
  return community ? { ok: true, community } : refuse(500, 'The room was created but could not be read back.')
}

/** By slug — the one unfenced read. null = no such room. */
export async function getCommunity(slug: string): Promise<PublicCommunity | null> {
  const s = normSlug(slug)
  if (!COMMUNITY_SLUG_RE.test(s)) return null
  const row = await prisma.community.findUnique({ where: { slug: s } })
  if (!row) return null
  const [c] = await decorateCommunities([row])
  return c
}

/** Internal flag of a room (null = no such room). Server-side callers only. */
export async function communityIsInternal(slug: string): Promise<boolean | null> {
  const s = normSlug(slug)
  if (!COMMUNITY_SLUG_RE.test(s)) return null
  const row = await prisma.community.findUnique({ where: { slug: s }, select: { isInternal: true } })
  return row ? row.isInternal : null
}

export async function listCommunities(opts: { sort?: 'members' | 'new' | 'active'; limit?: number; symbol?: string } = {}): Promise<PublicCommunity[]> {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 30) || 30))
  const sym = opts.symbol ? chartPairFor(opts.symbol)?.symbol ?? null : null
  if (opts.symbol && !sym) return []
  const where: Prisma.CommunityWhereInput = { isInternal: false, ...(sym ? { symbols: { has: sym } } : {}) }
  if (opts.sort === 'active') {
    // Active = posts this week; ranked in memory over a bounded set.
    const rows = await prisma.community.findMany({ where, orderBy: [{ memberCount: 'desc' }, { createdAt: 'desc' }], take: 300 })
    const all = await decorateCommunities(rows)
    return all.sort((a, b) => b.postsWeek - a.postsWeek || b.members - a.members || b.createdAt - a.createdAt).slice(0, limit)
  }
  const orderBy: Prisma.CommunityOrderByWithRelationInput[] = opts.sort === 'new' ? [{ createdAt: 'desc' }] : [{ memberCount: 'desc' }, { createdAt: 'desc' }]
  return decorateCommunities(await prisma.community.findMany({ where, orderBy, take: limit }))
}

export interface CommunityPatch {
  name?: unknown
  about?: unknown
  symbols?: unknown
  /** S10: 'mods' | 'members' — whose posts reach the linked chats. */
  announceFrom?: unknown
}

/** Owner only. Fields not sent are left alone. */
export async function updateCommunity(slug: string, by: MemberKey, patch: CommunityPatch): Promise<{ ok: true; community: PublicCommunity } | StoreRefusal> {
  const s = normSlug(slug)
  const row = COMMUNITY_SLUG_RE.test(s) ? await prisma.community.findUnique({ where: { slug: s } }) : null
  if (!row) return refuse(404, 'No such room.')
  if ((await roleOf(s, by)) !== 'owner') return refuse(403, 'Only the owner can edit this room.')
  const data: Prisma.CommunityUpdateInput = {}
  if (patch.name !== undefined) {
    const v = checkName(patch.name)
    if (!v.ok) return refuse(400, v.reason)
    data.name = v.value
  }
  if (patch.about !== undefined) {
    const v = checkAbout(patch.about)
    if (!v.ok) return refuse(400, v.reason)
    data.about = v.value
  }
  if (patch.symbols !== undefined) {
    const v = checkSymbols(patch.symbols)
    if (!v.ok) return refuse(400, v.reason)
    data.symbols = v.value
  }
  if (patch.announceFrom !== undefined) {
    if (patch.announceFrom !== 'mods' && patch.announceFrom !== 'members') return refuse(400, "announceFrom must be 'mods' or 'members'.")
    data.announceFrom = patch.announceFrom
  }
  if (Object.keys(data).length) await prisma.community.update({ where: { slug: s }, data })
  const community = await getCommunity(s)
  return community ? { ok: true, community } : refuse(404, 'No such room.')
}

export interface JoinInput {
  /** The invite code the join carried (?via= / a deep-link payload). Unknown codes are ignored, never an error. */
  via?: string | null
  source?: MemberSource
  /** Provider-reported name for a wallet-less member (rendered as text). */
  displayName?: string | null
  isInternal?: boolean
  /** S4: asked only when this join WOULD credit an inviter; false withholds the credit (the seat is still made). */
  creditAllowed?: () => Promise<boolean>
}

/** A seat moves the room's count when it is a real person in a real room, or
 *  anyone in an internal room (so a harness room still counts its own). */
const counts = (memberInternal: boolean, roomInternal: boolean) => !memberInternal || roomInternal

/** Idempotent. `joined` is true only when this call created the seat. */
export async function joinCommunity(slug: string, actor: Actor, input: JoinInput = {}): Promise<{ ok: true; joined: boolean; community: PublicCommunity; me: MyMembership } | StoreRefusal> {
  const s = normSlug(slug)
  if (!isMemberKey(actor.key)) return refuse(401, 'Sign in or open this from Telegram or Discord to join.')
  const room = COMMUNITY_SLUG_RE.test(s) ? await prisma.community.findUnique({ where: { slug: s }, select: { slug: true, isInternal: true } }) : null
  if (!room) return refuse(404, 'No such room.')
  const existing = await prisma.communityMember.findUnique({ where: { communitySlug_memberKey: { communitySlug: s, memberKey: actor.key } }, select: { id: true } })
  let joined = false
  if (!existing) {
    // Credit an inviter only for a real code of THIS room that is not the joiner's own.
    let via: string | null = null
    const code = typeof input.via === 'string' ? input.via.trim().toLowerCase() : ''
    if (INVITE_CODE_RE.test(code)) {
      const inv = await prisma.communityInvite.findUnique({ where: { code } }).catch(() => null)
      if (inv && inv.communitySlug === s && inv.inviterKey !== actor.key) via = code
      if (via && input.creditAllowed && !(await input.creditAllowed().catch(() => true))) via = null
    }
    const memberInternal = input.isInternal === true
    const display = actor.wallet ? null : (input.displayName ?? actor.provider?.name ?? actor.provider?.username ?? null)
    const source: MemberSource = input.source ?? (actor.wallet ? 'site' : actor.provider?.p === 'dc' ? 'discord' : 'telegram')
    try {
      await prisma.$transaction([
        prisma.communityMember.create({
          data: {
            communitySlug: s,
            memberKey: actor.key,
            wallet: actor.wallet ? actor.wallet.toLowerCase() : null,
            displayName: display ? display.slice(0, 64) : null,
            role: 'member',
            via,
            source,
            isInternal: memberInternal,
          },
        }),
        ...(counts(memberInternal, room.isInternal) ? [prisma.community.update({ where: { slug: s }, data: { memberCount: { increment: 1 } } })] : []),
      ])
      joined = true
    } catch (e) {
      if (!isUnique(e)) throw e // a concurrent join won the race: the seat exists
    }
  }
  const [community, me] = await Promise.all([getCommunity(s), membershipOf(s, actor.key)])
  if (!community || !me) return refuse(500, 'Joined, but the room could not be read back.')
  return { ok: true, joined, community, me }
}

/** The owner cannot leave (they hand the room over or keep it). */
export async function leaveCommunity(slug: string, key: MemberKey): Promise<{ ok: true; left: boolean } | StoreRefusal> {
  const s = normSlug(slug)
  const room = COMMUNITY_SLUG_RE.test(s) ? await prisma.community.findUnique({ where: { slug: s }, select: { isInternal: true } }) : null
  if (!room) return refuse(404, 'No such room.')
  const seat = await prisma.communityMember.findUnique({ where: { communitySlug_memberKey: { communitySlug: s, memberKey: key } } })
  if (!seat) return { ok: true, left: false }
  if (seat.role === 'owner') return refuse(409, 'The owner cannot leave the room.')
  const left = await prisma.$transaction(async (tx) => {
    const del = await tx.communityMember.deleteMany({ where: { id: seat.id } })
    if (del.count && counts(seat.isInternal, room.isInternal)) await tx.community.update({ where: { slug: s }, data: { memberCount: { decrement: 1 } } })
    return del.count > 0
  })
  return { ok: true, left }
}

/** The member's own invite code for a room, minted lazily (one per member per room). */
async function inviteFor(slug: string, key: MemberKey): Promise<string> {
  const found = await prisma.communityInvite.findUnique({ where: { communitySlug_inviterKey: { communitySlug: slug, inviterKey: key } } })
  if (found) return found.code
  for (let i = 0; i < 3; i++) {
    try {
      const row = await prisma.communityInvite.create({ data: { code: mintSlug(8), communitySlug: slug, inviterKey: key } })
      return row.code
    } catch (e) {
      if (!isUnique(e)) throw e
      const raced = await prisma.communityInvite.findUnique({ where: { communitySlug_inviterKey: { communitySlug: slug, inviterKey: key } } })
      if (raced) return raced.code
    }
  }
  throw new Error('Could not mint an invite code.')
}

export async function membershipOf(slug: string, key: MemberKey): Promise<MyMembership | null> {
  const s = normSlug(slug)
  if (!COMMUNITY_SLUG_RE.test(s) || !isMemberKey(key)) return null
  const seat = await prisma.communityMember.findUnique({ where: { communitySlug_memberKey: { communitySlug: s, memberKey: key } }, select: { role: true } })
  if (!seat) return null
  const code = await inviteFor(s, key)
  const uses = await prisma.communityMember.count({ where: { communitySlug: s, via: code } })
  return { key, role: asRole(seat.role), invite: { code, url: absoluteUrl(invitePath(s, code)), uses } }
}

export async function roleOf(slug: string, key: MemberKey): Promise<CommunityRole | null> {
  const s = normSlug(slug)
  if (!COMMUNITY_SLUG_RE.test(s) || !isMemberKey(key)) return null
  const seat = await prisma.communityMember.findUnique({ where: { communitySlug_memberKey: { communitySlug: s, memberKey: key } }, select: { role: true } })
  return seat ? asRole(seat.role) : null
}

/** The rooms an identity sits in, newest first. (The identity's own list: unfenced.) */
export async function communitiesOf(key: MemberKey): Promise<PublicCommunity[]> {
  if (!isMemberKey(key)) return []
  const seats = await prisma.communityMember.findMany({ where: { memberKey: key }, orderBy: { createdAt: 'desc' }, take: 100, select: { communitySlug: true } })
  if (!seats.length) return []
  const rows = await prisma.community.findMany({ where: { slug: { in: seats.map((x) => x.communitySlug) } } })
  const order = new Map(seats.map((x, i) => [x.communitySlug, i]))
  rows.sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0))
  return decorateCommunities(rows)
}

const TRADES_WINDOW_MS = 30 * 86_400_000
const MEMBERS_SCAN = 1000

export async function listMembers(slug: string, opts: { sort?: 'invites' | 'trades' | 'new'; limit?: number; refs?: boolean } = {}): Promise<PublicMember[]> {
  const s = normSlug(slug)
  const room = COMMUNITY_SLUG_RE.test(s) ? await prisma.community.findUnique({ where: { slug: s }, select: { isInternal: true } }) : null
  if (!room) return []
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 50) || 50))
  const sort = opts.sort ?? 'invites'
  // An internal room lists its own (harness) seats; a public room never does.
  const where: Prisma.CommunityMemberWhereInput = { communitySlug: s, ...(room.isInternal ? {} : { isInternal: false }) }
  const seats = await prisma.communityMember.findMany({ where, orderBy: { createdAt: sort === 'new' ? 'desc' : 'asc' }, take: sort === 'new' ? limit : MEMBERS_SCAN })
  if (!seats.length) return []
  const keys = seats.map((m) => m.memberKey)
  const wallets = [...new Set(seats.map((m) => m.wallet ?? walletOfKey(m.memberKey)).filter((w): w is string => !!w))]
  const since = new Date(Date.now() - TRADES_WINDOW_MS)
  const [invites, viaCounts, trades, handles] = await Promise.all([
    prisma.communityInvite.findMany({ where: { communitySlug: s, inviterKey: { in: keys } }, select: { code: true, inviterKey: true } }),
    prisma.communityMember.groupBy({ by: ['via'], where: { ...where, via: { not: null } }, _count: { _all: true } }),
    wallets.length
      ? prisma.embedTurn.groupBy({
          by: ['walletAddress'],
          where: { AND: [{ walletAddress: { in: wallets }, outcome: 'signed', verification: 'verified', createdAt: { gte: since } }, REAL_TRAFFIC_WHERE] },
          _count: { _all: true },
        })
      : Promise.resolve([] as { walletAddress: string | null; _count: { _all: number } }[]),
    handlesFor(wallets),
  ])
  const codeOf = new Map(invites.map((i) => [i.inviterKey, i.code]))
  const usesOf = new Map(viaCounts.map((v) => [v.via ?? '', v._count._all]))
  const tradesOf = new Map(trades.map((t) => [t.walletAddress ?? '', t._count._all]))
  const out: PublicMember[] = seats.map((m) => {
    const wallet = m.wallet ?? walletOfKey(m.memberKey)
    const code = codeOf.get(m.memberKey)
    return {
      label: memberLabel({ wallet, handle: wallet ? handles.get(wallet) : null, displayName: m.displayName, source: m.source }),
      role: asRole(m.role),
      source: asSource(m.source),
      invited: code ? usesOf.get(code) ?? 0 : 0,
      verifiedTrades: wallet ? tradesOf.get(wallet) ?? 0 : 0,
      joinedAt: Math.floor(m.createdAt.getTime() / 1000),
      ...(opts.refs ? { ref: memberRef(s, m.memberKey) } : {}),
    }
  })
  if (sort === 'invites') out.sort((a, b) => b.invited - a.invited || b.verifiedTrades - a.verifiedTrades || a.joinedAt - b.joinedAt)
  else if (sort === 'trades') out.sort((a, b) => b.verifiedTrades - a.verifiedTrades || b.invited - a.invited || a.joinedAt - b.joinedAt)
  return out.slice(0, limit)
}

/** Who an invite code belongs to, as the room page may print it ("You were
 *  invited by @handle"). The code must be a real invite of THIS room whose
 *  owner still sits in it; anything else is null (the page then says only
 *  "You were invited to <room>"). Never a raw provider id (memberLabel). */
export async function inviterLabel(slug: string, code: unknown): Promise<string | null> {
  const s = normSlug(slug)
  if (!COMMUNITY_SLUG_RE.test(s) || typeof code !== 'string' || !INVITE_CODE_RE.test(code)) return null
  const invite = await prisma.communityInvite.findUnique({ where: { code } }).catch(() => null)
  if (!invite || invite.communitySlug !== s) return null
  const seat = await prisma.communityMember.findUnique({ where: { communitySlug_memberKey: { communitySlug: s, memberKey: invite.inviterKey } } }).catch(() => null)
  if (!seat) return null
  const wallet = seat.wallet ?? walletOfKey(seat.memberKey)
  const handles = wallet ? await handlesFor([wallet]) : new Map<string, string>()
  const label = memberLabel({ wallet, handle: wallet ? handles.get(wallet) : null, displayName: seat.displayName, source: seat.source })
  return labelWithSource(label, { wallet, source: seat.source })
}

/** NOT REACHABLE — see QA-SECURITY-2 T7 (its only caller, the link route, was removed).
 *  When a provider identity is linked to a wallet, its seats move to the wallet key (one seat per person). */
export async function mergeSeats(from: MemberKey, toWallet: string): Promise<number> {
  const w = toWallet.toLowerCase()
  const to = walletKey(w)
  if (!isMemberKey(from) || !isMemberKey(to) || from === to) return 0
  const seats = await prisma.communityMember.findMany({ where: { memberKey: from } })
  let moved = 0
  for (const seat of seats) {
    await prisma.$transaction(async (tx) => {
      const mine = await tx.communityMember.findUnique({ where: { communitySlug_memberKey: { communitySlug: seat.communitySlug, memberKey: to } } })
      if (mine) {
        // Two seats, one person: keep the earlier join, the higher role, a via.
        await tx.communityMember.update({
          where: { id: mine.id },
          data: {
            createdAt: seat.createdAt < mine.createdAt ? seat.createdAt : mine.createdAt,
            role: higherRole(mine.role, seat.role),
            via: mine.via ?? seat.via,
          },
        })
        await tx.communityMember.delete({ where: { id: seat.id } })
        const room = await tx.community.findUnique({ where: { slug: seat.communitySlug }, select: { isInternal: true } })
        if (room && counts(seat.isInternal, room.isInternal)) await tx.community.update({ where: { slug: seat.communitySlug }, data: { memberCount: { decrement: 1 } } })
      } else {
        await tx.communityMember.update({ where: { id: seat.id }, data: { memberKey: to, wallet: w } })
      }
      // The provider's invite code follows the person: adopted when the wallet
      // has none in that room, else the joins it brought re-credit the wallet's code.
      const theirs = await tx.communityInvite.findUnique({ where: { communitySlug_inviterKey: { communitySlug: seat.communitySlug, inviterKey: from } } })
      if (theirs) {
        const walletInv = await tx.communityInvite.findUnique({ where: { communitySlug_inviterKey: { communitySlug: seat.communitySlug, inviterKey: to } } })
        if (!walletInv) await tx.communityInvite.update({ where: { code: theirs.code }, data: { inviterKey: to } })
        else {
          await tx.communityMember.updateMany({ where: { communitySlug: seat.communitySlug, via: theirs.code }, data: { via: walletInv.code } })
          await tx.communityInvite.delete({ where: { code: theirs.code } })
        }
      }
    })
    moved++
  }
  // Votes follow too; where both keys voted the same post, the provider's vote goes and the score is recomputed.
  const votes = await prisma.postVote.findMany({ where: { voterKey: from } })
  for (const v of votes) {
    await prisma.$transaction(async (tx) => {
      await lockPostRow(tx, v.postId)
      const dup = await tx.postVote.findUnique({ where: { postId_voterKey: { postId: v.postId, voterKey: to } } })
      if (dup) await tx.postVote.delete({ where: { postId_voterKey: { postId: v.postId, voterKey: from } } })
      else await tx.postVote.update({ where: { postId_voterKey: { postId: v.postId, voterKey: from } }, data: { voterKey: to } })
      await recomputeScore(tx, v.postId)
    })
  }
  return moved
}

// ── feed ───────────────────────────────────────────────────────────────────

export interface FeedQuery {
  community?: string | null
  symbol?: string | null
  sort?: FeedSort
  window?: FeedWindow
  kind?: FeedPost['kind'] | null
  author?: string | null
  limit?: number
  /** Opaque cursor from the previous page. */
  cursor?: string | null
  /** The caller, for `myVote`. */
  viewer?: MemberKey | null
  includeInternal?: boolean
}

const FEED_KINDS: FeedKind[] = ['idea', 'link', 'video', 'trade']

/** Only a proof the server wrote parses back; anything else reads as none.
 *  S2: the link must be exactly the registry's rebuild of the proof's own
 *  chain + hash, and the chain name is re-read from the registry. A proof in
 *  the pre-SECFIX shape (no chainId / txHash) reads as none. */
export function storedProof(raw: unknown): TradeProof | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (p.verification !== 'verified' || typeof p.turnId !== 'string' || typeof p.signedAt !== 'number' || !Array.isArray(p.symbols)) return null
  if (typeof p.chainId !== 'number' || typeof p.txHash !== 'string' || typeof p.txUrl !== 'string') return null
  const rebuilt = explorerTxFor(p.chainId, p.txHash)
  const chain = chainNameFor(p.chainId)
  if (!rebuilt || !chain || p.txUrl !== rebuilt) return null
  const side = p.side === 'buy' || p.side === 'sell' || p.side === 'long' || p.side === 'short' ? p.side : null
  return {
    turnId: p.turnId,
    chainId: p.chainId,
    txHash: p.txHash.toLowerCase(),
    symbols: p.symbols.filter((x): x is string => typeof x === 'string').slice(0, 8),
    side,
    sizeUsd: typeof p.sizeUsd === 'number' && Number.isFinite(p.sizeUsd) && p.sizeUsd > 0 ? p.sizeUsd : null,
    chain,
    txUrl: rebuilt,
    signedAt: p.signedAt,
    verification: 'verified',
  }
}

/** Rows → FeedPost: the forum's decoration plus room, video, proof, score, myVote. */
async function toFeedPosts(rows: PostRow[], viewer: MemberKey | null | undefined): Promise<FeedPost[]> {
  if (!rows.length) return []
  const slugs = [...new Set(rows.map((r) => r.communitySlug).filter((s): s is string => !!s))]
  const [base, rooms, votes] = await Promise.all([
    decoratePosts(rows),
    slugs.length ? prisma.community.findMany({ where: { slug: { in: slugs } }, select: { slug: true, name: true } }) : Promise.resolve([] as { slug: string; name: string }[]),
    viewer && isMemberKey(viewer)
      ? prisma.postVote.findMany({ where: { voterKey: viewer, postId: { in: rows.map((r) => r.id) } }, select: { postId: true, value: true } })
      : Promise.resolve([] as { postId: string; value: number }[]),
  ])
  const roomName = new Map(rooms.map((r) => [r.slug, r.name]))
  const myVote = new Map(votes.map((v) => [v.postId, v.value]))
  return rows.map((r, i) => {
    const kind: FeedKind = (FEED_KINDS as string[]).includes(r.kind) ? (r.kind as FeedKind) : 'idea'
    const video = kind === 'video' ? parseVideoUrl(r.mediaUrl) : null
    const mv = myVote.get(r.id)
    return {
      ...base[i],
      kind,
      community: r.communitySlug && roomName.has(r.communitySlug) ? { slug: r.communitySlug, name: roomName.get(r.communitySlug)! } : null,
      mediaUrl: video ? video.url : null,
      video,
      proof: kind === 'trade' ? storedProof(r.proof) : null,
      score: r.score ?? 0,
      myVote: mv === 1 ? 1 : mv === -1 ? -1 : 0,
    }
  })
}

export async function listFeed(q: FeedQuery): Promise<{ posts: FeedPost[]; next: string | null }> {
  const limit = Math.max(1, Math.min(100, Math.floor(q.limit ?? FEED_PAGE) || FEED_PAGE))
  const sort: FeedSort = q.sort === 'new' || q.sort === 'top' ? q.sort : 'hot'
  const where: Prisma.ChartPostWhereInput = {}
  if (q.community) {
    const s = normSlug(q.community)
    if (!COMMUNITY_SLUG_RE.test(s)) return { posts: [], next: null }
    where.communitySlug = s
  }
  if (q.symbol) {
    const pair = chartPairFor(q.symbol)
    if (!pair) return { posts: [], next: null }
    where.symbol = pair.symbol
  }
  if (q.kind) {
    if (!(FEED_KINDS as string[]).includes(q.kind)) return { posts: [], next: null }
    where.kind = q.kind
  }
  if (q.author) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(q.author)) return { posts: [], next: null }
    where.author = q.author.toLowerCase()
  }
  if (!q.includeInternal) where.isInternal = false
  const cursor = decodeCursor(q.cursor)
  const now = Date.now()

  if (sort === 'new') {
    const keyset = cursor && 't' in cursor ? cursor : null
    const rows = await prisma.chartPost.findMany({
      where: keyset
        ? { AND: [where, { OR: [{ createdAt: { lt: new Date(keyset.t) } }, { createdAt: new Date(keyset.t), id: { lt: keyset.id } }] }] }
        : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    return { posts: await toFeedPosts(page, q.viewer), next: rows.length > limit && last ? encodeCursor({ t: last.createdAt.getTime(), id: last.id }) : null }
  }

  const offset = cursor && 'o' in cursor ? cursor.o : 0
  if (sort === 'top') {
    const span = WINDOW_MS[q.window ?? 'week'] ?? null
    const rows = await prisma.chartPost.findMany({
      where: span ? { AND: [where, { createdAt: { gte: new Date(now - span) } }] } : where,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
    })
    const page = rows.slice(0, limit)
    return { posts: await toFeedPosts(page, q.viewer), next: rows.length > limit ? encodeCursor({ o: offset + limit }) : null }
  }

  // hot: a bounded recent window, ranked in memory.
  const rows = await prisma.chartPost.findMany({
    where: { AND: [where, { createdAt: { gte: new Date(now - HOT_WINDOW_MS) } }] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: HOT_SCAN,
  })
  const ranked = rows
    .map((r) => ({ r, h: hotRank(r.score ?? 0, r.createdAt.getTime()) }))
    .sort((a, b) => b.h - a.h || (a.r.id < b.r.id ? 1 : -1))
    .map((x) => x.r)
  const page = ranked.slice(offset, offset + limit)
  return { posts: await toFeedPosts(page, q.viewer), next: ranked.length > offset + limit ? encodeCursor({ o: offset + limit }) : null }
}

export async function getFeedPost(id: string, viewer?: MemberKey | null): Promise<FeedPost | null> {
  if (typeof id !== 'string' || !/^[a-z0-9]{6,16}$/.test(id)) return null
  const row = await prisma.chartPost.findUnique({ where: { id } })
  if (!row) return null
  const [post] = await toFeedPosts([row], viewer)
  return post ?? null
}

/** S3: the FIRST statement of every transaction that writes a post's votes.
 *  Under READ COMMITTED a statement's snapshot predates its wait for a row
 *  lock, so without this two overlapping votes each summed without the other
 *  and the last writer won (25 votes left score 1). Holding the post row
 *  first serializes them: each later statement sees every earlier commit. */
export async function lockPostRow(tx: Prisma.TransactionClient, postId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM chart_posts WHERE id = ${postId} FOR UPDATE`
}

/** score = the sum of the post's votes, recomputed inside the vote's transaction (after lockPostRow). */
async function recomputeScore(tx: Prisma.TransactionClient, postId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ score: number }[]>`
    UPDATE chart_posts SET score = COALESCE((SELECT SUM(value) FROM post_votes WHERE post_id = ${postId}), 0)::int
    WHERE id = ${postId}
    RETURNING score
  `
  return Number(rows[0]?.score ?? 0)
}

/** value 0 clears the vote. Returns the post's new score.
 *  `opts.isInternal`: the caller is an internal run (only it may vote on an internal post). */
export async function castVote(postId: string, voter: MemberKey, value: 1 | 0 | -1, opts: { isInternal?: boolean } = {}): Promise<{ ok: true; score: number; myVote: 1 | 0 | -1 } | StoreRefusal> {
  if (!isMemberKey(voter)) return refuse(401, 'Sign in or open this from Telegram or Discord to vote.')
  if (value !== 1 && value !== 0 && value !== -1) return refuse(400, 'value must be 1, 0 or -1.')
  if (typeof postId !== 'string' || !/^[a-z0-9]{6,16}$/.test(postId)) return refuse(404, 'No such post.')
  const post = await prisma.chartPost.findUnique({ where: { id: postId }, select: { id: true, isInternal: true } })
  if (!post || (post.isInternal && !opts.isInternal)) return refuse(404, 'No such post.')
  const score = await prisma.$transaction(async (tx) => {
    await lockPostRow(tx, postId)
    if (value === 0) await tx.postVote.deleteMany({ where: { postId, voterKey: voter } })
    else
      await tx.postVote.upsert({
        where: { postId_voterKey: { postId, voterKey: voter } },
        create: { postId, voterKey: voter, value },
        update: { value },
      })
    return recomputeScore(tx, postId)
  })
  return { ok: true, score, myVote: value }
}

// ── linked chats ─────────────────────────────────────────────────────────

/** Owner / mod only. Single use, 15 minutes (spec LINK_CODE_TTL_MS). */
export async function mintLinkCode(slug: string, by: MemberKey, platform: ChannelPlatform): Promise<{ ok: true; code: string; expiresAt: number } | StoreRefusal> {
  const s = normSlug(slug)
  if (platform !== 'telegram' && platform !== 'discord') return refuse(400, 'platform must be telegram or discord.')
  if (!(await prisma.community.findUnique({ where: { slug: COMMUNITY_SLUG_RE.test(s) ? s : '-' }, select: { slug: true } }))) return refuse(404, 'No such room.')
  if (!canManage(await roleOf(s, by))) return refuse(403, 'Only the owner or a mod can link a chat.')
  // S8: expired codes go when a new one is minted (a spent code is deleted on use).
  await prisma.channelLinkCode.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - LINK_CODE_TTL_MS) } } }).catch(() => null)
  const code = randomBytes(8).toString('hex')
  const row = await prisma.channelLinkCode.create({ data: { code, communitySlug: s, platform, createdBy: by } })
  return { ok: true, code, expiresAt: row.createdAt.getTime() + LINK_CODE_TTL_MS }
}

const cleanTitle = (t: string | null | undefined) => (typeof t === 'string' ? t.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 128) || null : null)

/** S8: at most this many linked chats a room (each one hears every announced post). */
export const ROOM_CHANNELS_MAX = 5
const TOO_MANY_CHANNELS = `A room can link at most ${ROOM_CHANNELS_MAX} chats. Unlink one first.`

/** true = linking this chat would be the room's sixth (re-linking one it already has is fine). */
async function channelCapReached(slug: string, platform: ChannelPlatform, externalId: string): Promise<boolean> {
  const rows = await prisma.communityChannel.findMany({ where: { communitySlug: slug }, select: { platform: true, externalId: true } })
  if (rows.some((r) => r.platform === platform && r.externalId === externalId)) return false
  return rows.length >= ROOM_CHANNELS_MAX
}

/** T2: the refusal when this chat is already linked to a DIFFERENT room (null = free, or the same room).
 *  Names the room by its slug only ([a-z0-9-]: nothing a chat client would link). */
async function linkedElsewhere(slug: string, platform: ChannelPlatform, externalId: string): Promise<string | null> {
  const row = await prisma.communityChannel.findUnique({ where: { platform_externalId: { platform, externalId } }, select: { communitySlug: true } })
  if (!row || row.communitySlug === slug) return null
  return `This chat is already linked to the room "${row.communitySlug}". Unlink it on that room's page, or remove the bot and add it again.`
}

async function upsertChannel(slug: string, platform: ChannelPlatform, linkedBy: string, chat: { externalId: string; title?: string | null; secret?: string | null }) {
  const externalId = String(chat.externalId).slice(0, 128)
  await prisma.communityChannel.upsert({
    where: { platform_externalId: { platform, externalId } },
    create: { communitySlug: slug, platform, externalId, title: cleanTitle(chat.title), secret: chat.secret ?? null, linkedBy },
    update: { communitySlug: slug, title: cleanTitle(chat.title), secret: chat.secret ?? null, linkedBy, announce: true },
  })
}

/** Spend a link code from inside the chat. The CALLER has already proved the sender administers that chat. */
export async function redeemLinkCode(code: string, platform: ChannelPlatform, chat: { externalId: string; title?: string | null; secret?: string | null }): Promise<{ ok: true; community: PublicCommunity } | StoreRefusal> {
  const c = typeof code === 'string' ? code.trim().toLowerCase() : ''
  if (!LINK_CODE_RE.test(c)) return refuse(400, 'That is not a link code. Copy it from the room page.')
  if (!chat || !String(chat.externalId ?? '')) return refuse(400, 'No chat to link.')
  const row = await prisma.channelLinkCode.findUnique({ where: { code: c } })
  if (!row || row.platform !== platform) return refuse(404, 'That link code is not known. Mint a new one on the room page.')
  if (Date.now() - row.createdAt.getTime() > LINK_CODE_TTL_MS) {
    await prisma.channelLinkCode.deleteMany({ where: { code: c } }).catch(() => null)
    return refuse(410, 'That link code expired. Mint a new one on the room page.')
  }
  // T2: a chat linked to ANOTHER room is never re-pointed (the code is not spent).
  const elsewhere = await linkedElsewhere(row.communitySlug, platform, String(chat.externalId).slice(0, 128))
  if (elsewhere) return refuse(409, elsewhere)
  // Single use: whoever deletes the row spends it.
  const spent = await prisma.channelLinkCode.deleteMany({ where: { code: c } })
  if (!spent.count) return refuse(404, 'That link code was already used.')
  const community = await getCommunity(row.communitySlug)
  if (!community) return refuse(404, 'That room no longer exists.')
  if (await channelCapReached(row.communitySlug, platform, String(chat.externalId).slice(0, 128))) return refuse(409, TOO_MANY_CHANNELS)
  await upsertChannel(row.communitySlug, platform, row.createdBy, chat)
  return { ok: true, community: (await getCommunity(row.communitySlug)) ?? community }
}

/** Link directly (the owner pasted a Discord webhook URL on the room page). */
export async function linkChannel(slug: string, by: MemberKey, platform: ChannelPlatform, chat: { externalId: string; title?: string | null; secret?: string | null }): Promise<{ ok: true } | StoreRefusal> {
  const s = normSlug(slug)
  if (platform !== 'telegram' && platform !== 'discord') return refuse(400, 'platform must be telegram or discord.')
  if (!(await prisma.community.findUnique({ where: { slug: COMMUNITY_SLUG_RE.test(s) ? s : '-' }, select: { slug: true } }))) return refuse(404, 'No such room.')
  if (!canManage(await roleOf(s, by))) return refuse(403, 'Only the owner or a mod can link a chat.')
  if (!chat || !String(chat.externalId ?? '')) return refuse(400, 'No chat to link.')
  const elsewhere = await linkedElsewhere(s, platform, String(chat.externalId).slice(0, 128))
  if (elsewhere) return refuse(409, elsewhere)
  if (await channelCapReached(s, platform, String(chat.externalId).slice(0, 128))) return refuse(409, TOO_MANY_CHANNELS)
  await upsertChannel(s, platform, by, chat)
  return { ok: true }
}

export async function unlinkChannel(platform: ChannelPlatform, externalId: string, by?: MemberKey): Promise<boolean> {
  const row = await prisma.communityChannel.findUnique({ where: { platform_externalId: { platform, externalId: String(externalId) } } })
  if (!row) return false
  if (by !== undefined && !canManage(await roleOf(row.communitySlug, by))) return false
  const del = await prisma.communityChannel.deleteMany({ where: { id: row.id } })
  return del.count > 0
}

/** The room's linked chats (server-only, for an owner's unlink-all / settings). */
export async function channelsOf(slug: string): Promise<DeliveryChannel[]> {
  const rows = await prisma.communityChannel.findMany({ where: { communitySlug: normSlug(slug) } })
  return rows.map((r) => ({ id: r.id, platform: r.platform === 'discord' ? 'discord' : 'telegram', externalId: r.externalId, secret: r.secret }))
}

/** The room a chat is linked to (the bots' first read on every command). */
export async function communityOfChannel(platform: ChannelPlatform, externalId: string): Promise<PublicCommunity | null> {
  const row = await prisma.communityChannel.findUnique({ where: { platform_externalId: { platform, externalId: String(externalId) } }, select: { communitySlug: true } }).catch(() => null)
  return row ? getCommunity(row.communitySlug) : null
}

/** Server-only rows for delivery: ids and secrets included. Never serialize. */
export interface DeliveryChannel {
  id: string
  platform: ChannelPlatform
  externalId: string
  secret: string | null
}
/** The channels that should hear a post now (announce on, under ANNOUNCE_HOURLY_CAP); stamps last_post_at. */
export async function channelsToAnnounce(slug: string): Promise<DeliveryChannel[]> {
  const rows = await prisma.communityChannel.findMany({ where: { communitySlug: normSlug(slug), announce: true } })
  if (!rows.length) return []
  let counts: Map<string, number>
  try {
    const keys = rows.map((r) => `ch:${r.id}`)
    const windowStart = hourStartUTC()
    const bumped = await prisma.$queryRaw<{ key: string; count: number }[]>`
      INSERT INTO unsigned_turn_windows (key, window_start, count)
      SELECT unnest(${keys}::text[]), ${windowStart}, 1
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = unsigned_turn_windows.count + 1
      RETURNING key, count
    `
    counts = new Map(bumped.map((b) => [b.key, Number(b.count)]))
  } catch {
    counts = new Map() // fail open, like every other window
  }
  const out = rows.filter((r) => (counts.get(`ch:${r.id}`) ?? 1) <= ANNOUNCE_HOURLY_CAP)
  if (out.length) await prisma.communityChannel.updateMany({ where: { id: { in: out.map((r) => r.id) } }, data: { lastPostAt: new Date() } }).catch(() => null)
  return out.map((r) => ({ id: r.id, platform: r.platform === 'discord' ? 'discord' : 'telegram', externalId: r.externalId, secret: r.secret }))
}

// ── S10: the owner's brakes ────────────────────────────────────────────────

/** Whose posts this room announces (S10). null = no such room. */
export async function roomAnnounceFrom(slug: string): Promise<AnnounceFrom | null> {
  const s = normSlug(slug)
  if (!COMMUNITY_SLUG_RE.test(s)) return null
  const row = await prisma.community.findUnique({ where: { slug: s }, select: { announceFrom: true } })
  return row ? (row.announceFrom === 'members' ? 'members' : 'mods') : null
}

/** Pure: does this post go to the room's linked chats? Members' posts only when the owner widened it. */
export function shouldAnnounce(announceFrom: AnnounceFrom | null, authorRole: CommunityRole | null): boolean {
  if (!authorRole) return false
  return announceFrom === 'members' || canManage(authorRole)
}

/** An opaque, room-scoped handle for a seat: never the key itself. */
export function memberRef(slug: string, key: string): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 16) throw new Error('SESSION_SECRET must be set (≥16 chars).')
  return createHmac('sha256', secret).update(`community-member:${slug}:${key}`).digest('base64url').slice(0, 22)
}

const sameRef = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Owner / mod removes a seat named by its ref. The owner's seat never goes;
 *  a mod removes members only. */
export async function removeMember(slug: string, by: MemberKey, ref: unknown): Promise<{ ok: true; removed: boolean } | StoreRefusal> {
  const s = normSlug(slug)
  const room = COMMUNITY_SLUG_RE.test(s) ? await prisma.community.findUnique({ where: { slug: s }, select: { isInternal: true } }) : null
  if (!room) return refuse(404, 'No such room.')
  const myRole = await roleOf(s, by)
  if (!canManage(myRole)) return refuse(403, 'Only the owner or a mod can remove a member.')
  if (typeof ref !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(ref)) return refuse(400, 'ref is required (from the members list).')
  const seats = await prisma.communityMember.findMany({ where: { communitySlug: s }, select: { id: true, memberKey: true, role: true, isInternal: true }, take: 5000 })
  const seat = seats.find((m) => sameRef(memberRef(s, m.memberKey), ref))
  if (!seat) return refuse(404, 'That member is not in this room.')
  if (seat.role === 'owner') return refuse(403, 'The owner cannot be removed.')
  if (seat.memberKey === by) return refuse(409, 'Leave the room instead.')
  if (myRole === 'mod' && seat.role !== 'member') return refuse(403, 'A mod can remove members only.')
  const removed = await prisma.$transaction(async (tx) => {
    const del = await tx.communityMember.deleteMany({ where: { id: seat.id } })
    if (del.count && counts(seat.isInternal, room.isInternal)) await tx.community.update({ where: { slug: s }, data: { memberCount: { decrement: 1 } } })
    return del.count > 0
  })
  return { ok: true, removed }
}

/** The post's author, or an owner / mod of the room it sits in, deletes it:
 *  the post, its votes and its comments in one transaction. */
export async function deletePost(id: string, by: string, opts: { isInternal?: boolean } = {}): Promise<{ ok: true } | StoreRefusal> {
  if (typeof id !== 'string' || !/^[a-z0-9]{6,16}$/.test(id) || !/^0x[a-fA-F0-9]{40}$/.test(by)) return refuse(404, 'No such post.')
  const post = await prisma.chartPost.findUnique({ where: { id }, select: { id: true, author: true, communitySlug: true, isInternal: true } })
  if (!post || (post.isInternal && !opts.isInternal)) return refuse(404, 'No such post.')
  const w = by.toLowerCase()
  const mine = post.author === w
  const manager = !mine && post.communitySlug ? canManage(await roleOf(post.communitySlug, walletKey(w))) : false
  if (!mine && !manager) return refuse(403, 'Only the author or the room owner or a mod can remove this post.')
  await prisma.$transaction(async (tx) => {
    await lockPostRow(tx, id)
    await tx.postVote.deleteMany({ where: { postId: id } })
    await tx.chartPostComment.deleteMany({ where: { postId: id } })
    await tx.chartPost.deleteMany({ where: { id } })
  })
  return { ok: true }
}
