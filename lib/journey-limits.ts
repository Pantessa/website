// lib/journey-limits.ts — the abuse fence in front of /api/journey.
//
// The endpoint has to be public and unauthenticated (its whole subject is
// people who have not signed in), so one machine must not be able to fill the
// table. Same hourly-window table and fail-open contract as lib/turn-limits;
// its own bucket (`j:<hash>`), counted in EVENTS so batching can't dodge it.

import { hashIp, hourStartUTC } from '@/lib/turn-limits'

/** A busy human session is a few hundred events an hour. */
export const JOURNEY_IP_HOURLY_CAP = 2_000

/** Pure: did this count cross the cap? */
export function journeyLimited(count: number): boolean {
  return count > JOURNEY_IP_HOURLY_CAP
}

/** Bump this IP's event window. True = refuse the batch. Loopback (no
 *  platform IP) and any store hiccup read as false. */
export async function bumpAndCheckJourney(ip: string | null, events: number): Promise<boolean> {
  if (!ip || events <= 0) return false
  try {
    const { default: prisma } = await import('@/lib/db')
    const key = `j:${hashIp(ip)}`
    const windowStart = hourStartUTC()
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO unsigned_turn_windows (key, window_start, count)
      VALUES (${key}, ${windowStart}, ${events})
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = unsigned_turn_windows.count + ${events}
      RETURNING count
    `
    return journeyLimited(Number(rows[0]?.count ?? 0))
  } catch {
    return false
  }
}
