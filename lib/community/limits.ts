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
/** S4: a speed bump on cheap identities, generous for a person. */
export const JOINS_IP_HOURLY_CAP = 30
export const ROOMS_IP_DAILY_CAP = 5
/** S8: link attempts (each one may send our server to Discord / Telegram). */
export const LINK_HOURLY_CAP = 10

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

/** Which fence a room creation tripped (null = go). The wallet cap and, S4,
 *  a per-IP daily cap (wallets are free; a machine is not). */
export async function roomCreateTripped(ip: string | null, wallet: string): Promise<'ip' | 'wallet' | null> {
  if (!ip) return null
  const key = `cg:w:${wallet.toLowerCase()}`
  const ipKey = `cg:i:${hashIp(ip)}`
  const counts = await bump([key, ipKey], dayStartUTC())
  if ((counts?.get(ipKey) ?? 0) > ROOMS_IP_DAILY_CAP) return 'ip'
  return (counts?.get(key) ?? 0) > ROOMS_WALLET_DAILY_CAP ? 'wallet' : null
}

/** S4: joins per IP per hour. true = over the cap (refuse). */
export async function joinTripped(ip: string | null): Promise<boolean> {
  if (!ip) return false
  const key = `cj:i:${hashIp(ip)}`
  const counts = await bump([key], hourStartUTC())
  return (counts?.get(key) ?? 0) > JOINS_IP_HOURLY_CAP
}

/** S4: may this join credit an inviter? At most once per IP per room per day
 *  (the seat is still made; only the credit is withheld). Loopback: yes. */
export async function inviteCreditAllowed(ip: string | null, slug: string): Promise<boolean> {
  if (!ip) return true
  const key = `ci:i:${hashIp(ip)}:${slug}`
  const counts = await bump([key], dayStartUTC())
  return (counts?.get(key) ?? 1) <= 1
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

/** S8: a room's link route (Discord webhook check / code mint, the Telegram
 *  twin), per acting wallet + per IP per hour. Loopback skips (module contract). */
export async function linkTripped(ip: string | null, actorKey: string, platform: 'discord' | 'telegram'): Promise<'ip' | 'actor' | null> {
  if (!ip) return null
  const ipKey = `cl:${platform}:i:${hashIp(ip)}`
  const actor = `cl:${platform}:a:${actorKey}`
  const counts = await bump([ipKey, actor], hourStartUTC())
  if (!counts) return null
  if ((counts.get(ipKey) ?? 0) > LINK_HOURLY_CAP) return 'ip'
  if ((counts.get(actor) ?? 0) > LINK_HOURLY_CAP) return 'actor'
  return null
}
