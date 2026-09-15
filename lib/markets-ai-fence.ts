// MK2/AI — the per-IP fence on the two model routes. Same bucket table and
// discipline as lib/turn-limits' broker / on-ramp / wallet-send fences
// (own key prefix `a:`, hashed IP, loopback exempt, fail-open), so a loop
// on a public page cannot burn model quota. The cap counts MODEL CALLS,
// not requests: a cached brief costs nothing and is not counted. The
// harness sets `MARKETS_AI_IP_HOURLY_CAP` low on its own server to trip it
// — the same env is how prod would tighten it.

import { clientIpFrom, hashIp, hourStartUTC } from './turn-limits'
import { isInternalRun } from './internal-run'

export const MARKETS_AI_IP_HOURLY_CAP_DEFAULT = 60

export function marketsAiCap(): number {
  const n = Number(process.env.MARKETS_AI_IP_HOURLY_CAP)
  return Number.isFinite(n) && n > 0 ? n : MARKETS_AI_IP_HOURLY_CAP_DEFAULT
}

/** Bump this request's window and report whether it tripped the cap.
 *  Internal runs (the harness stamps `x-yf-internal-run`) still count —
 *  the fence pin needs them to — but loopback traffic with no platform IP
 *  is exempt exactly like every other fence. */
export async function bumpAndCheckMarketsAi(headers: Headers, body?: unknown): Promise<boolean> {
  const ip = clientIpFrom(headers)
  if (!ip) return false
  void isInternalRun(headers, body)
  const key = `a:${hashIp(ip)}`
  try {
    const { default: prisma } = await import('@/lib/db')
    const windowStart = hourStartUTC()
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO unsigned_turn_windows (key, window_start, count)
      VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = unsigned_turn_windows.count + 1
      RETURNING count
    `
    return Number(rows[0]?.count ?? 0) > marketsAiCap()
  } catch {
    return false
  }
}

/** The polite wall, as JSON — never a bare 429 body. */
export const MARKETS_AI_WALL = 'This connection has asked the model a lot this hour. The brief and the chart still work; the model reopens within the hour.'
