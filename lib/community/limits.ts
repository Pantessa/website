// Write fences for the community layer (lane CORE): rooms per wallet per day,
// votes per actor + per IP per hour. The unsigned_turn_windows bucket idiom
// (lib/turn-limits, lib/chart-posts bumpAndCheckPostWrite): bump, read the
// post-increment counts, decide. Loopback (no platform IP) skips, the module
// contract; a DB error fails open.

import prisma from '@/lib/db'
import { hashIp, hourStartUTC } from '@/lib/turn-limits'

export const ROOMS_WALLET_DAILY_CAP = 3
export const VOTES_ACTOR_HOURLY_CAP = 120
export const VOTES_IP_HOURLY_CAP = 400

export function dayStartUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

async function bump(keys: string[], windowStart: Date): Promise<Map<string, number> | null> {
  try {
    const rows = await prisma.$queryRaw<{ key: string; count: number }[]>`
      INSERT INTO unsigned_turn_windows (key, window_start, count)
      SELECT unnest(${keys}::text[]), ${windowStart}, 1
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = unsigned_turn_windows.count + 1
      RETURNING key, count
    `
    return new Map(rows.map((r) => [r.key, Number(r.count)]))
  } catch {
    return null
  }
}

/** true = over the cap (refuse). */
export async function roomCreateTripped(ip: string | null, wallet: string): Promise<boolean> {
  if (!ip) return false
  const key = `cg:w:${wallet.toLowerCase()}`
  const counts = await bump([key], dayStartUTC())
  return (counts?.get(key) ?? 0) > ROOMS_WALLET_DAILY_CAP
}

export async function voteTripped(ip: string | null, actorKey: string): Promise<'ip' | 'actor' | null> {
  if (!ip) return null
  const ipKey = `cv:i:${hashIp(ip)}`
  const actor = `cv:a:${actorKey}`
  const counts = await bump([ipKey, actor], hourStartUTC())
  if (!counts) return null
  if ((counts.get(ipKey) ?? 0) > VOTES_IP_HOURLY_CAP) return 'ip'
  if ((counts.get(actor) ?? 0) > VOTES_ACTOR_HOURLY_CAP) return 'actor'
  return null
}
