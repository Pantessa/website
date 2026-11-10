// ─────────────────────────────────────────────────────────────────────────
//  TELEGRAM'S TWO SIGNATURES — the only way a Telegram identity comes to
//  exist on the web (lane TELEGRAM, 2026-11-09). Pure: node:crypto only.
//
//  1. A Mini App's `initData` (the query string Telegram hands the webview):
//       secret = HMAC_SHA256(key = "WebAppData", msg = bot_token)
//       check  = hex(HMAC_SHA256(key = secret, msg = data_check_string))
//     where data_check_string is every received `key=value` pair except
//     `hash`, values URL-DECODED, sorted by key, joined with "\n".
//  2. The Login Widget's fields (id, first_name, …, auth_date, hash):
//       secret = SHA256(bot_token)
//       check  = hex(HMAC_SHA256(key = secret, msg = data_check_string))
//     over the same sorted `key=value` lines minus `hash`.
//
//  Both are compared in constant time, and both are FRESH or refused:
//  `auth_date` no older than 24 hours, and no more than 5 minutes ahead of
//  our clock (a signature from the future is a replay being staged, or a
//  clock we should not trust either way).
//
//  A verified result carries only what Telegram signed. Nothing else in the
//  request is read.
// ─────────────────────────────────────────────────────────────────────────

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const TG_AUTH_MAX_AGE_SEC = 24 * 60 * 60
/** A Mini App's launch data is minted at launch and used at once: the auth
 *  ROUTE accepts it for ten minutes, not a day (QA-SECURITY-2 T1 — a day-old
 *  launch string is a credential someone can paste into a link). */
export const TG_MINI_APP_MAX_AGE_SEC = 10 * 60
export const TG_AUTH_FUTURE_SKEW_SEC = 5 * 60
/** initData with a photo URL and a long name stays well under this. */
export const TG_INIT_DATA_MAX = 8 * 1024

export interface TelegramUser {
  /** Telegram's numeric user id, as a decimal string. */
  id: string
  name: string | null
  username: string | null
}

export type TelegramVerifyFailure = 'malformed' | 'bad-hash' | 'stale' | 'future' | 'no-user'
export type TelegramVerdict =
  | { ok: true; user: TelegramUser; authDate: number; /** Mini App only: the signed start parameter. */ startParam: string | null }
  | { ok: false; reason: TelegramVerifyFailure }

const HEX64 = /^[a-f0-9]{64}$/
const USER_ID = /^[1-9]\d{0,19}$/

function hexEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex')
  const b = Buffer.from(bHex, 'hex')
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b)
}

function freshness(authDateRaw: string | undefined, nowSec: number, maxAgeSec = TG_AUTH_MAX_AGE_SEC): { ok: true; authDate: number } | { ok: false; reason: 'malformed' | 'stale' | 'future' } {
  if (!authDateRaw || !/^\d{9,11}$/.test(authDateRaw)) return { ok: false, reason: 'malformed' }
  const authDate = Number(authDateRaw)
  if (nowSec - authDate > maxAgeSec) return { ok: false, reason: 'stale' }
  if (authDate - nowSec > TG_AUTH_FUTURE_SKEW_SEC) return { ok: false, reason: 'future' }
  return { ok: true, authDate }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function userOf(raw: { id?: unknown; first_name?: unknown; last_name?: unknown; username?: unknown; is_bot?: unknown }): TelegramUser | null {
  const id = typeof raw.id === 'number' && Number.isSafeInteger(raw.id) ? String(raw.id) : typeof raw.id === 'string' ? raw.id : ''
  if (!USER_ID.test(id) || raw.is_bot === true) return null
  const name = [str(raw.first_name), str(raw.last_name)].filter(Boolean).join(' ') || null
  return { id, name, username: str(raw.username) }
}

/** The lines Telegram signed: `key=value`, sorted by key, "\n"-joined. */
export function dataCheckString(pairs: ReadonlyMap<string, string>): string {
  return [...pairs.keys()]
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${pairs.get(k)}`)
    .join('\n')
}

/** What a Mini App's initData should hash to. Exported for the pins and the
 *  setup script's self-test; never used to MINT anything in the app. */
export function initDataHash(pairs: ReadonlyMap<string, string>, botToken: string): string {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  return createHmac('sha256', secret).update(dataCheckString(pairs)).digest('hex')
}

export function loginWidgetHash(pairs: ReadonlyMap<string, string>, botToken: string): string {
  const secret = createHash('sha256').update(botToken).digest()
  return createHmac('sha256', secret).update(dataCheckString(pairs)).digest('hex')
}

/** Verify a Mini App's `initData`. `nowSec` is the server's clock; `maxAgeSec`
 *  is how old the launch may be (the route passes TG_MINI_APP_MAX_AGE_SEC). */
export function verifyInitData(initData: unknown, botToken: string, nowSec: number, maxAgeSec = TG_AUTH_MAX_AGE_SEC): TelegramVerdict {
  if (typeof initData !== 'string' || !initData || initData.length > TG_INIT_DATA_MAX || !botToken) return { ok: false, reason: 'malformed' }
  const pairs = new Map<string, string>()
  let params: URLSearchParams
  try {
    params = new URLSearchParams(initData)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  for (const [k, v] of params) {
    // A repeated key has no single signed meaning. Refuse, never pick one.
    if (!k || pairs.has(k)) return { ok: false, reason: 'malformed' }
    pairs.set(k, v)
  }
  const hash = pairs.get('hash') ?? ''
  if (!HEX64.test(hash)) return { ok: false, reason: 'malformed' }
  if (!hexEqual(hash, initDataHash(pairs, botToken))) return { ok: false, reason: 'bad-hash' }
  // Only now is anything inside worth reading.
  const fresh = freshness(pairs.get('auth_date'), nowSec, maxAgeSec)
  if (!fresh.ok) return fresh
  let user: TelegramUser | null = null
  try {
    const raw = JSON.parse(pairs.get('user') ?? 'null') as unknown
    if (raw && typeof raw === 'object') user = userOf(raw as Record<string, unknown>)
  } catch {
    user = null
  }
  if (!user) return { ok: false, reason: 'no-user' }
  const start = pairs.get('start_param') ?? null
  return { ok: true, user, authDate: fresh.authDate, startParam: start && /^[A-Za-z0-9_-]{1,64}$/.test(start) ? start : null }
}

const WIDGET_KEY = /^[a-z_]{1,32}$/
const WIDGET_MAX_FIELDS = 12
const WIDGET_VALUE_MAX = 512

/** Verify the Login Widget's fields (the object its callback hands the page,
 *  posted as JSON). Every scalar field except `hash` is part of what Telegram
 *  signed, so every one of them goes into the check string as received. */
export function verifyLoginWidget(fields: unknown, botToken: string, nowSec: number): TelegramVerdict {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !botToken) return { ok: false, reason: 'malformed' }
  const entries = Object.entries(fields as Record<string, unknown>)
  if (entries.length === 0 || entries.length > WIDGET_MAX_FIELDS) return { ok: false, reason: 'malformed' }
  const pairs = new Map<string, string>()
  for (const [k, v] of entries) {
    if (!WIDGET_KEY.test(k)) return { ok: false, reason: 'malformed' }
    const s = typeof v === 'string' ? v : typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : null
    if (s === null || s.length > WIDGET_VALUE_MAX) return { ok: false, reason: 'malformed' }
    pairs.set(k, s)
  }
  const hash = pairs.get('hash') ?? ''
  if (!HEX64.test(hash)) return { ok: false, reason: 'malformed' }
  if (!hexEqual(hash, loginWidgetHash(pairs, botToken))) return { ok: false, reason: 'bad-hash' }
  const fresh = freshness(pairs.get('auth_date'), nowSec)
  if (!fresh.ok) return fresh
  const user = userOf({ id: pairs.get('id'), first_name: pairs.get('first_name'), last_name: pairs.get('last_name'), username: pairs.get('username') })
  if (!user) return { ok: false, reason: 'no-user' }
  return { ok: true, user, authDate: fresh.authDate, startParam: null }
}

/** The one sentence a refused sign-in is told. Never the reason's internals. */
export function verifyFailureReply(reason: TelegramVerifyFailure): string {
  if (reason === 'stale') return 'This Telegram sign-in has expired. Open it again from Telegram.'
  if (reason === 'future') return 'This Telegram sign-in is dated in the future. Check the clock on this device and try again.'
  return 'Telegram did not sign this. Open it again from Telegram.'
}
