// ROOM LOGIC — the pure rules behind /g (squad community, lane GROUP).
// Client-safe and server-safe: no React, no fetch, no storage access. The
// components read sessionStorage and hand the raw string in; the pins
// (scripts/community-group-pins.ts) hold every rule here.

import {
  COMMUNITY_ABOUT_MAX,
  COMMUNITY_NAME_MAX,
  COMMUNITY_SLUG_RE,
  COMMUNITY_SYMBOLS_MAX,
  INVITE_CODE_RE,
  RESERVED_COMMUNITY_SLUGS,
  communityPath,
  invitePath,
  joinPayload,
  type MyMembership,
  type PublicCommunity,
  type PublicMember,
} from '@/lib/community/spec'

// ── the slug a name suggests ───────────────────────────────────────────────

const SLUG_MAX = 32

/** "ETH Swing Traders!" → "eth-swing-traders". Lowercase, hyphens, 3 to 32
 *  characters, never a reserved word. '' when the name cannot make one yet
 *  (too short); the form then asks for an address by hand. */
export function suggestSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
  if (!base) return ''
  if (RESERVED_COMMUNITY_SLUGS.has(base)) {
    const padded = `${base}-room`
    return COMMUNITY_SLUG_RE.test(padded) ? padded : ''
  }
  return COMMUNITY_SLUG_RE.test(base) ? base : ''
}

/** Why a typed address cannot be used, in the form's words. null = usable. */
export function slugProblem(slug: string): string | null {
  if (!slug) return 'Pick an address for the room.'
  if (slug.length < 3) return 'Use at least 3 characters.'
  if (slug.length > SLUG_MAX) return `Use at most ${SLUG_MAX} characters.`
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Use lowercase letters, numbers and hyphens.'
  if (!COMMUNITY_SLUG_RE.test(slug)) return 'Start and end with a letter or a number.'
  if (RESERVED_COMMUNITY_SLUGS.has(slug)) return 'That address is reserved. Pick another.'
  return null
}

/** What a typed address is allowed to hold while it is being typed. */
export function cleanSlugInput(raw: string): string {
  return raw.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, SLUG_MAX)
}

/** "eth, $hype  AAPL" → ["ETH", "HYPE", "AAPL"]. Deduped, capped. The API
 *  decides whether a ticker is a market; this only shapes the list. */
export function parseSymbols(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[\s,;]+/)) {
    const s = raw.replace(/^\$/, '').toUpperCase()
    if (!/^[A-Z0-9]{1,10}$/.test(s) || out.includes(s)) continue
    out.push(s)
    if (out.length >= COMMUNITY_SYMBOLS_MAX) break
  }
  return out
}

export interface RoomDraft {
  name: string
  slug: string
  about: string
  symbols: string
  /** The address was typed by hand: the name stops suggesting one. */
  slugTouched: boolean
}

export const ROOM_DRAFT_KEY = 'pantessa.community.draft'
export const EMPTY_DRAFT: RoomDraft = { name: '', slug: '', about: '', symbols: '', slugTouched: false }

/** The draft a stored string names. Anything malformed is an empty form. */
export function readDraft(raw: string | null): RoomDraft {
  if (!raw) return EMPTY_DRAFT
  try {
    const d = JSON.parse(raw) as Partial<RoomDraft> | null
    if (!d || typeof d !== 'object') return EMPTY_DRAFT
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
    return {
      name: str(d.name, COMMUNITY_NAME_MAX),
      slug: cleanSlugInput(str(d.slug, SLUG_MAX)),
      about: str(d.about, COMMUNITY_ABOUT_MAX),
      symbols: str(d.symbols, 200),
      slugTouched: d.slugTouched === true,
    }
  } catch {
    return EMPTY_DRAFT
  }
}

/** Why the form cannot be sent yet. null = ready. */
export function draftProblem(d: RoomDraft): string | null {
  const name = d.name.trim()
  if (name.length < 3) return 'Give the room a name.'
  if (name.length > COMMUNITY_NAME_MAX) return `Keep the name under ${COMMUNITY_NAME_MAX} characters.`
  return slugProblem(d.slug)
}

// ── the held join ──────────────────────────────────────────────────────────
// A stranger who taps Join is sent to a sign-in. The join waits in this tab
// (sessionStorage) and runs by itself when an identity lands, whichever lane
// brought it. Nothing here is ever signed.

export const HELD_JOIN_KEY = 'pantessa.community.join'
export const HELD_JOIN_TTL_MS = 30 * 60_000

export interface HeldJoin {
  slug: string
  via: string | null
}

/** The record a Join tap leaves. null for a slug that is not a room address. */
export function heldJoinRecord(slug: string, via: string | null | undefined, now: number): string | null {
  if (!COMMUNITY_SLUG_RE.test(slug)) return null
  return JSON.stringify({ slug, via: via && INVITE_CODE_RE.test(via) ? via : null, at: now })
}

/** The join a stored record names: well formed and under 30 minutes old. */
export function readHeldJoin(raw: string | null, now: number): HeldJoin | null {
  if (!raw) return null
  let rec: unknown
  try {
    rec = JSON.parse(raw)
  } catch {
    return null
  }
  const { slug, via, at } = (rec ?? {}) as { slug?: unknown; via?: unknown; at?: unknown }
  if (typeof slug !== 'string' || !COMMUNITY_SLUG_RE.test(slug)) return null
  if (typeof at !== 'number' || !Number.isFinite(at) || at > now || now - at > HELD_JOIN_TTL_MS) return null
  return { slug, via: typeof via === 'string' && INVITE_CODE_RE.test(via) ? via : null }
}

// ── the invite a page was opened with ──────────────────────────────────────
// /g/<slug>?via=<code> is an invite link. The code is moved into this tab's
// storage on arrival and the address bar goes back to the bare room: a
// sign-in then lands on /g/<slug>, a copied address never re-shares somebody
// else's code, and no later navigation to the bare room comes back wearing a
// stale query (the Next route-cache rule in CLAUDE.md).

export const VIA_KEY = 'pantessa.community.via'
export const VIA_TTL_MS = 24 * 60 * 60_000

/** A `via` value that is shaped like an invite code, else null. */
export function cleanVia(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' && INVITE_CODE_RE.test(v) ? v : null
}

export function viaRecord(slug: string, code: string | null, now: number): string | null {
  if (!COMMUNITY_SLUG_RE.test(slug) || !code || !INVITE_CODE_RE.test(code)) return null
  return JSON.stringify({ slug, code, at: now })
}

/** The invite code remembered for THIS room, or null. */
export function readVia(raw: string | null, slug: string, now: number): string | null {
  if (!raw) return null
  try {
    const { slug: s, code, at } = JSON.parse(raw) as { slug?: unknown; code?: unknown; at?: unknown }
    if (s !== slug || typeof code !== 'string' || !INVITE_CODE_RE.test(code)) return null
    if (typeof at !== 'number' || !Number.isFinite(at) || at > now || now - at > VIA_TTL_MS) return null
    return code
  } catch {
    return null
  }
}

/** The same in-app address without its `via`. Everything else is kept. */
export function stripVia(href: string): string {
  const [rest, hash = ''] = href.split('#')
  const [path, query = ''] = rest.split('?')
  const params = new URLSearchParams(query)
  params.delete('via')
  const q = params.toString()
  return `${path}${q ? `?${q}` : ''}${hash ? `#${hash}` : ''}`
}

// ── the member's own link ──────────────────────────────────────────────────

/** The absolute link a member shares. The API's own url wins when it is
 *  absolute; a path (or nothing) is rebuilt from the code on `origin`. */
export function inviteUrl(slug: string, invite: MyMembership['invite'] | null | undefined, origin: string): string {
  const base = origin.replace(/\/+$/, '')
  if (invite?.url && /^https?:\/\//.test(invite.url)) return invite.url
  if (invite?.url && invite.url.startsWith('/')) return `${base}${invite.url}`
  return `${base}${invitePath(slug, invite?.code ?? null)}`
}

/** One plain-ASCII line that reads on its own in a chat. */
export function inviteLine(name: string): string {
  const n = name.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim()
  return n ? `Join ${n} on Pantessa. Chart ideas, calls and trades with proof.` : 'Join this room on Pantessa. Chart ideas, calls and trades with proof.'
}

export const telegramShareHref = (url: string, text: string) => `https://t.me/share/url?${new URLSearchParams({ url, text }).toString()}`
export const xShareHref = (url: string, text: string) => `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url }).toString()}`

/** Where a member stands by people brought, from the public board alone:
 *  one more than the number of members who brought more. `capped` = the board
 *  was cut before it ran out of members ahead, so the place is "outside the
 *  top N". null when the member has brought nobody (there is no place yet). */
export function inviteRank(uses: number, board: Pick<PublicMember, 'invited'>[], boardLimit: number): { place: number; capped: boolean } | null {
  if (!(uses > 0)) return null
  const ahead = board.filter((m) => m.invited > uses).length
  const capped = board.length >= boardLimit && ahead >= board.length
  return { place: ahead + 1, capped }
}

export function ordinal(n: number): string {
  const v = Math.abs(Math.trunc(n))
  const tens = v % 100
  if (tens >= 11 && tens <= 13) return `${v}th`
  return `${v}${['th', 'st', 'nd', 'rd'][v % 10] ?? 'th'}`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

// ── Telegram: the join link ────────────────────────────────────────────────

export interface TelegramDoor {
  /** The bot's username (TELEGRAM_BOT_NAME), no @. */
  bot: string
  /** The Mini App's short name (TELEGRAM_APP_NAME), when there is one. */
  app?: string | null
}

/** A bot username / app short name as Telegram allows them, else null. */
export function telegramDoor(bot: string | undefined | null, app?: string | null): TelegramDoor | null {
  const b = (bot ?? '').replace(/^@/, '').trim()
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(b)) return null
  const a = (app ?? '').trim()
  return { bot: b, app: /^[A-Za-z0-9_]{3,30}$/.test(a) ? a : null }
}

/** The deep link that joins this room from Telegram, carrying the invite
 *  (lib/community/spec joinPayload). The Mini App when one is named, else
 *  the bot's /start. */
export function telegramJoinHref(door: TelegramDoor, slug: string, via?: string | null): string {
  const payload = joinPayload(slug, via && INVITE_CODE_RE.test(via) ? via : null)
  return door.app ? `https://t.me/${door.bot}/${door.app}?startapp=${payload}` : `https://t.me/${door.bot}?start=${payload}`
}

// ── the room's card and metadata ───────────────────────────────────────────

export const ROOM_DEFAULT_ABOUT = 'A room on Pantessa for chart ideas, links, videos and trades with proof. Joining takes one tap.'
const CARD_MARKETS = 5

export interface RoomCardText {
  name: string
  about: string
  members: string
  markets: string[]
  /** "+3" when the room follows more markets than the card shows. */
  moreMarkets: string | null
  url: string
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)
const oneLine = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim()

/** The words on the room's social card. A missing room gets an honest card. */
export function roomCardText(room: Pick<PublicCommunity, 'slug' | 'name' | 'about' | 'members' | 'symbols'> | null, host = 'pantessa.com'): RoomCardText {
  if (!room) return { name: 'A room on Pantessa', about: ROOM_DEFAULT_ABOUT, members: 'Join in one tap', markets: [], moreMarkets: null, url: `${host}/g` }
  const symbols = room.symbols.filter((s) => /^[A-Z0-9.:]{1,12}$/.test(s))
  return {
    name: clip(oneLine(room.name) || room.slug, 44),
    about: clip(oneLine(room.about) || ROOM_DEFAULT_ABOUT, 150),
    members: room.members > 0 ? plural(room.members, 'member') : 'New room',
    markets: symbols.slice(0, CARD_MARKETS),
    moreMarkets: symbols.length > CARD_MARKETS ? `+${symbols.length - CARD_MARKETS}` : null,
    url: `${host}${communityPath(room.slug)}`,
  }
}

/** A room made by a harness run. The public shape has no internal flag yet,
 *  so the test prefix is the fence: never indexed. */
export const isTestRoomSlug = (slug: string) => slug.startsWith('t-')

export function roomMeta(room: Pick<PublicCommunity, 'slug' | 'name' | 'about'> | null, slug: string): { title: string; description: string; noindex: boolean } {
  if (!room) return { title: 'Room on Pantessa', description: ROOM_DEFAULT_ABOUT, noindex: true }
  return {
    title: `${oneLine(room.name) || room.slug} on Pantessa`,
    description: clip(oneLine(room.about) || ROOM_DEFAULT_ABOUT, 200),
    noindex: isTestRoomSlug(slug),
  }
}

// ── the owner's first-run checklist ────────────────────────────────────────

export type ChecklistStep = 'invite' | 'telegram' | 'discord' | 'post'

/** Which steps are done, read from the room's real state and nothing else. */
export function checklistDone(room: Pick<PublicCommunity, 'members' | 'channels' | 'postsWeek'>): Record<ChecklistStep, boolean> {
  return {
    invite: room.members > 1,
    telegram: room.channels.some((c) => c.platform === 'telegram'),
    discord: room.channels.some((c) => c.platform === 'discord'),
    post: room.postsWeek > 0,
  }
}

export const checklistKey = (slug: string) => `pantessa.community.checklist.${slug}`
