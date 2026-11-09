// COMMUNITY RULES — the pure decisions under lib/community/store (lane CORE).
// No I/O (it imports lib/chart-posts' pure helpers, so it is server-side by
// import, never by behaviour). Pinned by scripts/community-core-pins.ts.

import { chartPairFor } from '@/lib/charts'
import { authorLabel, cleanText } from '@/lib/chart-posts'
import {
  COMMUNITY_ABOUT_MAX,
  COMMUNITY_NAME_MAX,
  COMMUNITY_SLUG_RE,
  COMMUNITY_SYMBOLS_MAX,
  RESERVED_COMMUNITY_SLUGS,
  type CommunityRole,
  type MemberSource,
} from './spec'

export type Verdict<T> = { ok: true; value: T } | { ok: false; reason: string }

/** A slug as typed → the stored slug, or why not. */
export function checkSlug(raw: unknown): Verdict<string> {
  if (typeof raw !== 'string') return { ok: false, reason: 'slug is required (3 to 32 letters, digits or dashes).' }
  const s = raw.trim().toLowerCase()
  if (!COMMUNITY_SLUG_RE.test(s)) return { ok: false, reason: 'slug must be 3 to 32 lowercase letters, digits or dashes, starting and ending with a letter or digit.' }
  if (s.includes('--')) return { ok: false, reason: 'slug cannot hold two dashes in a row.' }
  if (RESERVED_COMMUNITY_SLUGS.has(s)) return { ok: false, reason: `"${s}" is reserved. Pick another slug.` }
  return { ok: true, value: s }
}

export function checkName(raw: unknown): Verdict<string> {
  if (typeof raw !== 'string') return { ok: false, reason: `name is required (2 to ${COMMUNITY_NAME_MAX} characters).` }
  if (raw.length > COMMUNITY_NAME_MAX * 2) return { ok: false, reason: `name is over ${COMMUNITY_NAME_MAX} characters.` }
  const s = cleanText(raw, COMMUNITY_NAME_MAX).replace(/\s+/g, ' ')
  if (s.length < 2) return { ok: false, reason: `name is required (2 to ${COMMUNITY_NAME_MAX} characters).` }
  return { ok: true, value: s }
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

/** A member's public label: claimed @handle → short wallet → the provider's
 *  display name → a generic word. NEVER a raw Telegram / Discord id. */
export function memberLabel(m: { wallet: string | null; handle?: string | null; displayName?: string | null; source: string }): string {
  if (m.wallet) return authorLabel(m.wallet, m.handle ?? null)
  const name = m.displayName ? cleanText(m.displayName, 64).replace(/\s+/g, ' ') : ''
  // A provider name that is only digits could be someone's id: never shown.
  if (name && !/^\d+$/.test(name)) return name
  return m.source === 'telegram' ? 'A Telegram member' : m.source === 'discord' ? 'A Discord member' : 'A member'
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
export function decodeCursor(raw: unknown): FeedCursor | null {
  if (typeof raw !== 'string' || !raw || raw.length > 200) return null
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof v.o === 'number' && Number.isInteger(v.o) && v.o >= 0 && v.o <= 10_000) return { o: v.o }
    if (typeof v.t === 'number' && Number.isFinite(v.t) && typeof v.id === 'string' && /^[a-z0-9]{6,16}$/.test(v.id)) return { t: v.t, id: v.id }
    return null
  } catch {
    return null
  }
}

export const WINDOW_MS = { day: 86_400_000, week: 7 * 86_400_000, all: null } as const
export const HOT_WINDOW_MS = 14 * 86_400_000
export const HOT_SCAN = 400
