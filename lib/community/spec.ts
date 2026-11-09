// ─────────────────────────────────────────────────────────────────────────
//  COMMUNITY — the squad's shared contract (squad community, 2026-11-09).
//
//  Pure + client-safe: types, constants and the few rules more than one lane
//  needs. No prisma, no next/headers, no fetch. The blackboard README
//  (squad-community-2026-11-09/README.md, outside the repo) carries the HTTP
//  contract; this file carries its shapes.
//
//  The product in one paragraph: a COMMUNITY is a room at /g/<slug>. Joining
//  is one tap for a proven identity (a wallet session, or Telegram's /
//  Discord's own signature) and never needs a wallet. Its feed holds chart
//  ideas (a stamped call), links, videos, and TRADES WITH PROOF (the
//  author's own receipt-verified fill, re-derived on the server). Posts are
//  voted on and ranked hot / new / top. A linked Telegram chat or Discord
//  channel hears every new post and can bring its whole group in through
//  one pinned button.
// ─────────────────────────────────────────────────────────────────────────

import type { PublicPost } from '@/lib/chart-posts'

// ── identity ───────────────────────────────────────────────────────────────

export type IdentityProvider = 'tg' | 'dc'
/** `w:<lowercased wallet>` | `tg:<numeric id>` | `dc:<snowflake>`. */
export type MemberKey = `w:${string}` | `tg:${string}` | `dc:${string}`

export const MEMBER_KEY_RE = /^(w:0x[a-f0-9]{40}|tg:\d{1,20}|dc:\d{5,22})$/

export function walletKey(address: string): MemberKey {
  return `w:${address.toLowerCase()}` as MemberKey
}
export function providerKey(provider: IdentityProvider, id: string | number): MemberKey {
  return `${provider}:${String(id)}` as MemberKey
}
export function isMemberKey(v: unknown): v is MemberKey {
  return typeof v === 'string' && MEMBER_KEY_RE.test(v)
}
export function walletOfKey(key: string): string | null {
  return key.startsWith('w:') && MEMBER_KEY_RE.test(key) ? key.slice(2) : null
}

/** Who is acting, as the SERVER proved it (lib/community/identity getActor). */
export interface Actor {
  key: MemberKey
  /** The SIWE wallet, when the session carries one (or an identity link names one). */
  wallet: string | null
  /** The provider identity, when the identity cookie carries one. */
  provider: { p: IdentityProvider; id: string; name: string | null; username: string | null } | null
}

// ── communities ────────────────────────────────────────────────────────────

export const COMMUNITY_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/
export const COMMUNITY_NAME_MAX = 48
export const COMMUNITY_ABOUT_MAX = 500
export const COMMUNITY_SYMBOLS_MAX = 12
/** Slugs a community may never take (routes, brands, words that read as ours). */
export const RESERVED_COMMUNITY_SLUGS = new Set(['new', 'all', 'popular', 'pantessa', 'yeetful', 'admin', 'official', 'support', 'help', 'api', 'join', 'invite', 'settings', 'telegram', 'discord'])

export type CommunityRole = 'owner' | 'mod' | 'member'
export type MemberSource = 'site' | 'telegram' | 'discord'
export type ChannelPlatform = 'telegram' | 'discord'

export interface PublicCommunity {
  slug: string
  name: string
  about: string
  symbols: string[]
  members: number
  /** Posts in the last 7 days (public rows only). */
  postsWeek: number
  /** Linked chats, by platform + title only. Never an id, never a secret. */
  channels: { platform: ChannelPlatform; title: string | null }[]
  ownerLabel: string
  createdAt: number
}

export interface PublicMember {
  /** A claimed @handle, a short wallet, or the provider's display name. Never a raw id. */
  label: string
  role: CommunityRole
  source: MemberSource
  /** Members this one brought in (joins that carried their invite code). */
  invited: number
  /** Receipt-verified fills by this member's wallet in the window (0 for a wallet-less member). */
  verifiedTrades: number
  joinedAt: number
  /** S10: an opaque handle for this seat (an HMAC of the member key under
   *  SESSION_SECRET, scoped to the room), present ONLY on an owner / mod's
   *  `?manage=1` read — what `POST …/members/remove { ref }` takes. Never a key. */
  ref?: string
}

/** Whose posts a room announces to its linked chats (S10). */
export type AnnounceFrom = 'mods' | 'members'

export interface MyMembership {
  key: MemberKey
  role: CommunityRole
  invite: { code: string; url: string; uses: number }
  /** Present ONLY for the owner (the setting they may change). */
  announceFrom?: AnnounceFrom
}

export const communityPath = (slug: string) => `/g/${slug}`
/** The link a member shares: the room, carrying their invite code. */
export const invitePath = (slug: string, code?: string | null) => (code ? `/g/${slug}?via=${encodeURIComponent(code)}` : `/g/${slug}`)
export const INVITE_CODE_RE = /^[a-z0-9]{6,12}$/

// ── posts in the feed ──────────────────────────────────────────────────────

export type FeedKind = 'idea' | 'link' | 'video' | 'trade'
export type FeedSort = 'hot' | 'new' | 'top'
export type FeedWindow = 'day' | 'week' | 'all'
export const FEED_SORTS: FeedSort[] = ['hot', 'new', 'top']
export const FEED_PAGE = 25

/** A fill the SERVER re-derived from the author's own verified receipt row
 *  AND read back from the chain at post time (QA-SECURITY S1, S2).
 *  CHAIN-CONFIRMED: `chainId`, `txHash`, `chain`, `txUrl`, `sizeUsd` (the
 *  transaction's own transfers, clamped to the recorded size). `sizeUsd` is
 *  null when the author chose to hide the size (the proof still stands: the
 *  tx is public). Print them with lib/community/proof-words. */
export interface TradeProof {
  turnId: string
  /** The registry chain the transaction was read on. */
  chainId: number
  /** The transaction hash (0x + 64 hex, lowercase). */
  txHash: string
  /** NOT chain-confirmed: the author's own tag as the app recorded it at
   *  signing, e.g. ["buy:ETH"]. Print it as the author's words
   *  ("Tagged by the author: bought ETH"), never under the verified mark. */
  symbols: string[]
  /** NOT chain-confirmed: read from the author's tag (see `symbols`). */
  side: 'buy' | 'sell' | 'long' | 'short' | null
  sizeUsd: number | null
  /** The registry's name for `chainId` (never the beacon's label). */
  chain: string
  /** REBUILT from the registry's explorer + `txHash`; never a stored string. */
  txUrl: string
  /** When the fill was signed (unix ms) — the receipt row's own clock. */
  signedAt: number
  /** Always literal: the chain confirmed the tx, its sender and its target. */
  verification: 'verified'
}

export interface FeedPost extends Omit<PublicPost, 'kind'> {
  kind: FeedKind
  community: { slug: string; name: string } | null
  mediaUrl: string | null
  video: VideoRef | null
  proof: TradeProof | null
  score: number
  /** The caller's own vote, when the request proved an identity. */
  myVote: 1 | -1 | 0
}

/** Reddit's hot rank: votes count on a log scale, newer posts start ahead.
 *  `createdAtMs` is the server's own stamp. Pure; pinned. */
export function hotRank(score: number, createdAtMs: number): number {
  const s = Math.max(-1e6, Math.min(1e6, Math.trunc(score)))
  const order = Math.log10(Math.max(Math.abs(s), 1))
  const sign = s > 0 ? 1 : s < 0 ? -1 : 0
  const seconds = createdAtMs / 1000 - 1_760_000_000 // an epoch near the launch
  return Number((sign * order + seconds / 45_000).toFixed(7))
}

// ── video ──────────────────────────────────────────────────────────────────

export type VideoHost = 'youtube' | 'vimeo' | 'loom' | 'x'
export interface VideoRef {
  host: VideoHost
  id: string
  /** The canonical watch URL (what is stored). */
  url: string
  /** A sandboxable player URL, or null when the host has no iframe player we use (X: link out). */
  embedUrl: string | null
  /** A static poster image when the host serves one keylessly. */
  poster: string | null
}

/** A video is a WATCH URL on a host we know, reduced to its id and rebuilt
 *  from that id — a pasted URL is never stored or framed as typed. Anything
 *  else is not a video (post it as a link). Pure; pinned. */
export function parseVideoUrl(raw: unknown): VideoRef | null {
  if (typeof raw !== 'string' || raw.length > 300) return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '')
  const seg = u.pathname.split('/').filter(Boolean)
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let id = ''
    if (host === 'youtu.be') id = seg[0] ?? ''
    else if (seg[0] === 'watch') id = u.searchParams.get('v') ?? ''
    else if (seg[0] === 'shorts' || seg[0] === 'embed' || seg[0] === 'live') id = seg[1] ?? ''
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null
    return { host: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}`, embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = host === 'player.vimeo.com' ? (seg[1] ?? '') : (seg[0] ?? '')
    if (!/^\d{6,12}$/.test(id)) return null
    return { host: 'vimeo', id, url: `https://vimeo.com/${id}`, embedUrl: `https://player.vimeo.com/video/${id}`, poster: null }
  }
  if (host === 'loom.com') {
    if (seg[0] !== 'share' && seg[0] !== 'embed') return null
    const id = seg[1] ?? ''
    if (!/^[a-f0-9]{32}$/.test(id)) return null
    return { host: 'loom', id, url: `https://www.loom.com/share/${id}`, embedUrl: `https://www.loom.com/embed/${id}`, poster: null }
  }
  if (host === 'x.com' || host === 'twitter.com') {
    if (seg[1] !== 'status' || !/^[A-Za-z0-9_]{1,15}$/.test(seg[0] ?? '') || !/^\d{5,25}$/.test(seg[2] ?? '')) return null
    return { host: 'x', id: seg[2], url: `https://x.com/${seg[0]}/status/${seg[2]}`, embedUrl: null, poster: null }
  }
  return null
}

// ── bots: the words both bots share ────────────────────────────────────────

/** Commands a linked chat understands, in both bots. */
export const BOT_COMMANDS = [
  { name: 'chart', args: '<symbol>', does: 'The chart, the price and the chips for one market' },
  { name: 'calls', args: '', does: "The room's newest stamped calls" },
  { name: 'top', args: '', does: 'Who brought the most members and who traded with proof' },
  { name: 'invite', args: '', does: 'Your own invite link to this room' },
  { name: 'join', args: '', does: 'Join this room on Pantessa in one tap' },
  { name: 'link', args: '<code>', does: 'Admins: link this chat to a room (the code comes from the room page)' },
] as const
export type BotCommandName = (typeof BOT_COMMANDS)[number]['name']

/** A link code as the room page mints it (single use, 15 minutes). */
export const LINK_CODE_RE = /^[a-f0-9]{16}$/
export const LINK_CODE_TTL_MS = 15 * 60_000
/** A linked chat hears at most this many announcements an hour; the rest wait for the next post's digest line. */
export const ANNOUNCE_HOURLY_CAP = 12

/** Telegram deep-link payloads are [A-Za-z0-9_-]{1,64}. `g_<slug>` joins a
 *  room, `g_<slug>__<invite>` joins it crediting an inviter. Slugs use `-`,
 *  so the double underscore is unambiguous. */
export function joinPayload(slug: string, invite?: string | null): string {
  return invite ? `g_${slug}__${invite}` : `g_${slug}`
}
export function parseJoinPayload(raw: unknown): { slug: string; invite: string | null } | null {
  if (typeof raw !== 'string' || raw.length > 64 || !raw.startsWith('g_')) return null
  const [slug, invite] = raw.slice(2).split('__')
  if (!COMMUNITY_SLUG_RE.test(slug ?? '')) return null
  if (invite !== undefined && !INVITE_CODE_RE.test(invite)) return null
  return { slug, invite: invite ?? null }
}
