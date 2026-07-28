// Unsigned-turn rate limiting — the #553 connect-to-act follow-up.
//
// /i, /chat and /embed run turns on wallet connect alone; house billing
// meters per WALLET (session ?? walletAddress), so a cycling burner mints a
// fresh free allowance per wallet, and anonymous native-build turns (quotes,
// funding scans) never touch billing at all. This is the abuse fence in
// front of PUBLIC link traffic: every unsigned, non-embed turn bumps an
// hourly window per client IP (hashed) and per wallet; either cap refuses
// the turn with a polite sign-in wall. Signed sessions and embed-key turns
// are exempt — their own plan gates already meter them.
//
// Trust boundary: the IP comes from platform-stamped headers (x-real-ip /
// x-forwarded-for on Vercel). Direct loopback traffic carries neither —
// that's local dev and the API harness — and skips the fence entirely; in
// production the proxy always stamps the header, so there is no unstamped
// path to the origin.
//
// Like lib/billing, every DB touch FAILS OPEN — a limiter hiccup must never
// take chat down.

import { createHash } from 'node:crypto'

/** Generous for a human on a spree; a wall for a script. Signed users are
 *  never touched by these — signing in IS the escape hatch. */
export const UNSIGNED_WALLET_HOURLY_CAP = 60
/** Higher than the wallet tier — one NAT/classroom IP covers many humans —
 *  but a hard stop for one machine cycling burner wallets. */
export const UNSIGNED_IP_HOURLY_CAP = 150

export function hourStartUTC(now = new Date()): Date {
  const d = new Date(now)
  d.setUTCMinutes(0, 0, 0)
  return d
}

/** Addresses that mean "this request never crossed the platform proxy" —
 *  `next start` stamps x-forwarded-for with the SOCKET address on direct
 *  connections, so loopback arrives as a header value, not an absent one.
 *  Live 2026-07-28: two same-hour harness runs walled their own tails —
 *  ::1 had quietly become a 169-count fence bucket in Neon. */
const LOOPBACK_IPS = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1'])

/** The platform-stamped client IP, or null for direct (loopback) traffic. */
export function clientIpFrom(headers: Headers): string | null {
  const real = headers.get('x-real-ip')?.trim()
  const fwd = headers.get('x-forwarded-for')
  const first = real || fwd?.split(',')[0]?.trim() || null
  return first && !LOOPBACK_IPS.has(first) ? first : null
}

/** Raw IPs never land in the DB — a salted hash prefix is the key. */
export function hashIp(ip: string): string {
  const salt = process.env.SESSION_SECRET ?? 'yf-turn-limits'
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 16)
}

/** Window keys for an unsigned turn: `i:<hash>` and/or `w:<address>`. */
export function limitKeysFor(ipHash: string | null, wallet: string | null | undefined): string[] {
  const keys: string[] = []
  if (ipHash) keys.push(`i:${ipHash}`)
  if (wallet) keys.push(`w:${wallet.toLowerCase()}`)
  return keys
}

/** Pure decision over post-increment counts: which tier tripped, if any.
 *  The IP tier outranks the wallet tier in the answer (it names the machine,
 *  not the wallet) when both trip at once. */
export function decideTurnLimit(counts: { key: string; count: number }[]): 'ip' | 'wallet' | null {
  let tripped: 'ip' | 'wallet' | null = null
  for (const { key, count } of counts) {
    if (key.startsWith('i:') && count > UNSIGNED_IP_HOURLY_CAP) return 'ip'
    if (key.startsWith('w:') && count > UNSIGNED_WALLET_HOURLY_CAP) tripped = 'wallet'
  }
  return tripped
}

/**
 * Bump this turn's windows and decide. Call ONLY for unsigned, non-embed
 * turns. Returns the tripped tier or null; null on any store hiccup (open).
 */
export async function bumpAndCheckUnsignedTurn(
  ip: string | null,
  wallet: string | null | undefined,
): Promise<'ip' | 'wallet' | null> {
  // Direct traffic (no platform-stamped IP) skips the fence ENTIRELY — the
  // module contract above: that's local dev and the API harness, and in
  // prod there is no unstamped path to the origin. Counting only the wallet
  // tier here made harness dummy wallets accumulate walls across runs in
  // the shared DB (live 2026-07-28).
  if (!ip) return null
  const keys = limitKeysFor(hashIp(ip), wallet)
  if (keys.length === 0) return null
  try {
    // Lazy so the module stays import-safe for the pure helpers (the API
    // harness imports them without a DATABASE_URL in its process).
    const { default: prisma } = await import('@/lib/db')
    const windowStart = hourStartUTC()
    const counts = await prisma.$queryRaw<{ key: string; count: number }[]>`
      INSERT INTO unsigned_turn_windows (key, window_start, count)
      SELECT unnest(${keys}::text[]), ${windowStart}, 1
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = unsigned_turn_windows.count + 1
      RETURNING key, count
    `
    // Lazy sweep: old windows are dead weight; clear them occasionally,
    // fire-and-forget.
    if (Math.random() < 0.02) {
      void prisma
        .$executeRaw`DELETE FROM unsigned_turn_windows WHERE window_start < now() - interval '3 hours'`.catch(
        () => {},
      )
    }
    return decideTurnLimit(counts.map((c) => ({ key: c.key, count: Number(c.count) })))
  } catch {
    return null
  }
}

/** The polite wall — a reply, never a bare 429. Signing in lifts the guest
 *  caps (a signed session rides its own plan limits), which also feeds the
 *  keep-this-thread loop. */
export function turnLimitReply(scope: 'ip' | 'wallet'): string {
  return scope === 'wallet'
    ? `🚦 That's a lot of turns for an unsigned wallet in one hour. **Sign in** (one free signature) and your own plan takes over — no hourly guest cap. Anything already signed, plus standing jobs and receipts, keeps running. Otherwise the guest lane reopens within the hour.`
    : `🚦 This connection has hit the hourly guest cap. **Sign in** (one free signature) and your own plan takes over — no guest caps. Anything already signed, plus standing jobs and receipts, keeps running. Otherwise the guest lane reopens within the hour.`
}
