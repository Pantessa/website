// COMMUNITY RULES — the pure decisions under lib/community/store (lane CORE).
// No I/O (it imports lib/chart-posts' pure helpers, so it is server-side by
// import, never by behaviour). Pinned by scripts/community-core-pins.ts.

import { chartPairFor } from '@/lib/charts'
import { INVISIBLE_RE, authorLabel, cleanText } from '@/lib/chart-posts'
import {
  COMMUNITY_ABOUT_MAX,
  COMMUNITY_NAME_MAX,
  COMMUNITY_SLUG_RE,
  COMMUNITY_SYMBOLS_MAX,
  RESERVED_COMMUNITY_SLUGS,
  hotRank,
  type CommunityRole,
  type MemberSource,
} from './spec'

export type Verdict<T> = { ok: true; value: T } | { ok: false; reason: string }

// ── S5: names and addresses that pose as ours ─────────────────────────────

/** Brand names: refused ANYWHERE inside a slug or a name (askpantessa, pantessahq). */
export const BRAND_WORDS = ['pantessa', 'yeetful', 'metamask', 'coinbase', 'uniswap', 'hyperliquid', 'telegram', 'discord'] as const
/** Authority words: refused as a whole word, or glued to the front or back of one
 *  (supportdesk, verified, helpdesk-pro), never in the middle (badminton). */
export const AUTHORITY_WORDS = ['official', 'support', 'helpdesk', 'security', 'verif', 'admin', 'staff'] as const
/** Short authority words: refused only as a WHOLE word, so ordinary words that
 *  contain them pass (modern, teamwork). */
export const AUTHORITY_EXACT = ['mod', 'mods', 'team', 'staff', 'admin', 'owner', 'moderator', 'moderators'] as const
/** R5: authority phrases refused anywhere once separators are dropped ("help-desk", "Customer Service"). */
export const AUTHORITY_SQUASHED = ['helpdesk', 'customerservice', 'customersupport', 'customercare'] as const
/** R5: leet digits, for the comparison only. "1" reads as both i and l. */
const LEET: Record<string, string> = { '4': 'a', '3': 'e', '0': 'o', '5': 's', '7': 't' }

/** Common Cyrillic / Greek lookalikes → Latin, so "Pаntessa" (Cyrillic а) reads as the brand. */
const CONFUSABLE: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'т': 't', 'к': 'k', 'м': 'm', 'н': 'h', 'в': 'b', 'ԁ': 'd', 'ӏ': 'l', 'ո': 'n', 'ս': 'u',
  'α': 'a', 'ε': 'e', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'ν': 'v', 'κ': 'k', 'ι': 'i', 'χ': 'x', 'η': 'n', 'ѵ': 'v',
  // R5: Latin lookalikes NFKD does not fold.
  'ɑ': 'a', 'ı': 'i', 'ƥ': 'p', 'ɩ': 'i', 'ɡ': 'g',
}
/** NFKC, marks dropped (R5: "Pantessá" → "pantessa"), lowercase, lookalikes folded, invisible characters gone. */
export function foldForBrand(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(INVISIBLE_RE, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/./gu, (c) => CONFUSABLE[c] ?? c)
}

/** R5 (pure): the folded text plus its leet readings (1 → i, and 1 → l). */
export function brandReadings(raw: string): string[] {
  const t = foldForBrand(raw)
  if (!/[0-9]/.test(t)) return [t]
  const base = t.replace(/[0-9]/g, (d) => LEET[d] ?? d)
  return [...new Set([t, base.replace(/1/g, 'i'), base.replace(/1/g, 'l')])]
}

/** The word in `text` that poses as ours, or null. `text` is folded first;
 *  words are runs of letters and digits. Also catches a brand spelled out
 *  across separators ("pan-tessa", "P a n t e s s a"). */
export function impostorWord(text: string): string | null {
  for (const t of brandReadings(text)) {
    const squashed = t.replace(/[^a-z0-9]/g, '')
    for (const b of BRAND_WORDS) if (squashed.includes(b)) return b
    for (const a of AUTHORITY_SQUASHED) if (squashed.includes(a)) return a
    const words = t.split(/[^a-z0-9]+/).filter(Boolean)
    for (const w of words) {
      for (const a of AUTHORITY_EXACT) if (w === a) return a
      for (const a of AUTHORITY_WORDS) if (w.startsWith(a) || w.endsWith(a)) return a
    }
  }
  return null
}

/** A slug as typed → the stored slug, or why not. */
export function checkSlug(raw: unknown): Verdict<string> {
  if (typeof raw !== 'string') return { ok: false, reason: 'slug is required (3 to 32 letters, digits or dashes).' }
  const s = raw.trim().toLowerCase()
  if (!COMMUNITY_SLUG_RE.test(s)) return { ok: false, reason: 'slug must be 3 to 32 lowercase letters, digits or dashes, starting and ending with a letter or digit.' }
  if (s.includes('--')) return { ok: false, reason: 'slug cannot hold two dashes in a row.' }
  if (RESERVED_COMMUNITY_SLUGS.has(s)) return { ok: false, reason: `"${s}" is reserved. Pick another slug.` }
  const word = impostorWord(s)
  if (word) return { ok: false, reason: `A room address cannot use "${word}": it reads as an official or brand account. Pick another slug.` }
  return { ok: true, value: s }
}

/** Check marks and badge glyphs a name could wear to look verified. */
// R5: + the coloured circles / diamonds / stars a verified look borrows (🔵 🟢 💠 ⭐ 🌟 💎 ✪ 🗸).
// Tested on the RAW name too: NFKC turns ™ and Ⓜ into letters before the cleaned test.
const BADGE_RE = /[\u2611\u2705\u2713\u2714\u2611\u{1F6E1}\u{1F396}\u{1F3C5}\u{1F530}\u{1F4DB}\u269C\u{1F947}-\u{1F949}\u2122\u00ae\u24c2\u{1F512}\u{1F510}\u{1F534}\u{1F535}\u{1F7E0}-\u{1F7E2}\u{1F7E3}\u{1F7E4}\u{1F4A0}\u{1F48E}\u2B50\u{1F31F}\u272A\u{1F5F8}\u2606\u2605]/u

export function checkName(raw: unknown): Verdict<string> {
  if (typeof raw !== 'string') return { ok: false, reason: `name is required (2 to ${COMMUNITY_NAME_MAX} characters).` }
  if (raw.length > COMMUNITY_NAME_MAX * 2) return { ok: false, reason: `name is over ${COMMUNITY_NAME_MAX} characters.` }
  const s = cleanText(raw.normalize('NFKC'), COMMUNITY_NAME_MAX).replace(/\s+/g, ' ')
  if ([...s.replace(/\s/g, '')].length < 2) return { ok: false, reason: `name is required (2 to ${COMMUNITY_NAME_MAX} characters).` }
  if (BADGE_RE.test(s) || BADGE_RE.test(raw)) return { ok: false, reason: 'A room name cannot wear a check mark or a badge.' }
  const word = impostorWord(s)
  if (word) return { ok: false, reason: `A room name cannot use "${word}": it reads as an official or brand account.` }
  return { ok: true, value: s }
}

/** S17: the neutral title a linked Discord channel wears when its webhook's name fails the room-name rule. */
export const DISCORD_CHANNEL_FALLBACK_TITLE = 'Discord channel'

/** S17 (pure): a Discord webhook's `name` is whatever its creator typed, and it
 *  shows on the room. It passes the room-name rule (brand / authority words,
 *  badge glyphs, bidi and invisibles) or it is stored as the neutral title. */
export function discordChannelTitle(raw: unknown): string {
  const v = checkName(raw)
  return v.ok ? v.value : DISCORD_CHANNEL_FALLBACK_TITLE
}

export function checkAbout(raw: unknown): Verdict<string> {
  if (raw === undefined || raw === null) return { ok: true, value: '' }
  if (typeof raw !== 'string') return { ok: false, reason: 'about must be plain text.' }
  if (raw.length > COMMUNITY_ABOUT_MAX) return { ok: false, reason: `about is over ${COMMUNITY_ABOUT_MAX} characters.` }
  return { ok: true, value: cleanText(raw, COMMUNITY_ABOUT_MAX) }
}

/** Tickers a room follows: each one charted (fail closed), deduped, capped. */
export function checkSymbols(raw: unknown): Verdict<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] }
  if (!Array.isArray(raw)) return { ok: false, reason: 'symbols must be a list of tickers.' }
  if (raw.length > COMMUNITY_SYMBOLS_MAX) return { ok: false, reason: `A room follows at most ${COMMUNITY_SYMBOLS_MAX} markets.` }
  const out: string[] = []
  for (const s of raw) {
    const pair = typeof s === 'string' ? chartPairFor(s) : null
    if (!pair) return { ok: false, reason: `${typeof s === 'string' ? s.slice(0, 16) : 'That'} is not a charted ticker.` }
    if (!out.includes(pair.symbol)) out.push(pair.symbol)
  }
  return { ok: true, value: out }
}

const ROLE_RANK: Record<CommunityRole, number> = { member: 0, mod: 1, owner: 2 }
export function higherRole(a: string, b: string): CommunityRole {
  const ra = ROLE_RANK[a as CommunityRole] ?? 0
  const rb = ROLE_RANK[b as CommunityRole] ?? 0
  return (ra >= rb ? a : b) as CommunityRole
}
export const asRole = (r: string): CommunityRole => (r === 'owner' || r === 'mod' ? r : 'member')
export const asSource = (s: string): MemberSource => (s === 'telegram' || s === 'discord' ? s : 'site')
export const canManage = (role: CommunityRole | null): boolean => role === 'owner' || role === 'mod'

/** The generic word for a wallet-less member of a source. */
export function genericMemberWord(source: string): string {
  return source === 'telegram' ? 'Telegram member' : source === 'discord' ? 'Discord member' : 'A member'
}

/** A member's public label: claimed @handle → short wallet → the provider's
 *  display name → a generic word. NEVER a raw Telegram / Discord id.
 *  S6: a provider name is the provider's words, not a claim on this site — it
 *  may not pose as a claimed @handle, a wallet, or an official account. */
export function memberLabel(m: { wallet: string | null; handle?: string | null; displayName?: string | null; source: string }): string {
  if (m.wallet) return authorLabel(m.wallet, m.handle ?? null)
  const raw = m.displayName ? cleanText(m.displayName, 64).replace(/\s+/g, ' ').trim() : ''
  const claimsHandle = /^[\s@＠﹫]*[@＠﹫]/.test(raw.normalize('NFKC'))
  const name = raw.normalize('NFKC').replace(/^[\s@]+/, '').trim()
  const looksLikeWallet = /^0x[0-9a-f]/i.test(name) || /…|\.\.\./.test(name) && /[0-9a-f]{4}/i.test(name)
  // A provider name that is only digits could be someone's id: never shown.
  if (!name || claimsHandle || looksLikeWallet || /^\d+$/.test(name) || impostorWord(name)) return genericMemberWord(m.source)
  return name
}

/** S6: a label printed ALONE (the "invited by" line): a wallet-less member's
 *  name carries its source so it never reads as a site handle. */
export function labelWithSource(label: string, m: { wallet: string | null; source: string }): string {
  if (m.wallet || label === genericMemberWord(m.source)) return label
  return m.source === 'telegram' ? `${label} (Telegram)` : m.source === 'discord' ? `${label} (Discord)` : label
}

// ── votes ───────────────────────────────────────────────────────────────────

export function parseVote(raw: unknown): 1 | 0 | -1 | null {
  return raw === 1 || raw === 0 || raw === -1 ? raw : null
}
/** What a new vote does to the score, given the voter's previous vote. */
export function voteDelta(prev: 1 | 0 | -1, next: 1 | 0 | -1): number {
  return next - prev
}

// ── feed cursor ─────────────────────────────────────────────────────────────

/** `o` = an offset (hot / top); `t` + `id` = a keyset position (new). */
export type FeedCursor = { o: number } | { t: number; id: string }

export function encodeCursor(c: FeedCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}
/** S12: how far past now a keyset cursor's time may sit (clock skew). */
export const CURSOR_FUTURE_SLACK_MS = 86_400_000

export function decodeCursor(raw: unknown): FeedCursor | null {
  if (typeof raw !== 'string' || !raw || raw.length > 200) return null
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof v.o === 'number' && Number.isInteger(v.o) && v.o >= 0 && v.o <= 10_000) return { o: v.o }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    // S12: a keyset time must be a real date: integer ms, not before the
    // epoch, not past a day from now (a JS Date's range is ±8.64e15; 1e308 threw in Prisma).
    if (
      typeof v.t === 'number' && Number.isInteger(v.t) && v.t >= 0 && v.t <= Date.now() + CURSOR_FUTURE_SLACK_MS &&
      typeof v.id === 'string' && /^[a-z0-9]{6,16}$/.test(v.id)
    ) return { t: v.t, id: v.id }
    return null
  } catch {
    return null
  }
}

export const WINDOW_MS = { day: 86_400_000, week: 7 * 86_400_000, all: null } as const
export const HOT_WINDOW_MS = 14 * 86_400_000
export const HOT_SCAN = 400
/** S13: the top-scored posts in the hot window join the newest ones, so volume cannot evict quality. */
export const HOT_TOP_SCAN = 200

/** S13 (pure): the hot feed's candidates = the newest ∪ the top-scored (deduped
 *  by id), ranked by hotRank (ties: the larger id first). */
export function rankHot<T extends { id: string; score: number | null; createdAt: Date }>(newest: T[], topScored: T[]): T[] {
  const byId = new Map<string, T>()
  for (const r of [...newest, ...topScored]) if (!byId.has(r.id)) byId.set(r.id, r)
  return [...byId.values()]
    .map((r) => ({ r, h: hotRank(r.score ?? 0, r.createdAt.getTime()) }))
    .sort((a, b) => b.h - a.h || (a.r.id < b.r.id ? 1 : a.r.id > b.r.id ? -1 : 0))
    .map((x) => x.r)
}
