// Daily fuses for house inference (pricing v2) — the WORST-CASE bound.
//
// Pricing bounds the expected bill; these bound what a bug or a botnet can
// do to it. One counter per (fuse, UTC day) in `unsigned_turn_windows` (the
// limiter table already there: key + window_start + count, upserted in one
// statement). Every fuse is env-overridable and clamped so a typo can never
// zero out a surface.
//
// THE LANE RULE (why there are several fuses, not one): before v2 a single
// 2,000-turn cap gated everyone, so a bot that filled it walled every real
// user for the rest of the day — the attack was the outage, not the bill.
// Now the FREE taste lane has its own fuse. A flood can only ever exhaust
// the taste; answers a user earned by trading, bought, or gets with Plus
// draw on the paid fuse, which a stranger cannot touch. BYOK draws on none.
//
// Pure decisions + constants up top (the harness pins them without a DB);
// every store touch FAILS OPEN, like lib/billing and lib/turn-limits.

const clampInt = (raw: string | undefined, dflt: number, lo: number, hi: number): number => {
  const n = Number(raw)
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt
}

export type FuseId =
  | 'taste' // free daily-taste chat answers, all visitors combined
  | 'paid' // plan + bank chat answers, all accounts combined
  | 'markets-brief'
  | 'markets-tape'
  | 'markets-position'
  | 'markets-ask'
  | 'markets-explain'
  | 'mcp-lint'

/** Calls per UTC day. At ~$0.03 a chat answer and ~$0.005 a markets call the
 *  defaults bound a day at roughly $30 (taste) + $60 (paid, all of it
 *  pre-funded) + $25 (markets) + $5 (lint). */
export const FUSE_CAPS: Record<FuseId, number> = {
  taste: clampInt(process.env.TASTE_HOUSE_DAILY_CAP, 1000, 50, 1_000_000),
  paid: clampInt(process.env.HOUSE_DAILY_TURN_CAP, 2000, 100, 1_000_000),
  'markets-brief': clampInt(process.env.MARKETS_BRIEF_DAILY_CAP, 2000, 50, 1_000_000),
  'markets-tape': clampInt(process.env.MARKETS_TAPE_DAILY_CAP, 500, 20, 1_000_000),
  'markets-position': clampInt(process.env.MARKETS_POSITION_DAILY_CAP, 500, 20, 1_000_000),
  'markets-ask': clampInt(process.env.MARKETS_ASK_DAILY_CAP, 1000, 50, 1_000_000),
  'markets-explain': clampInt(process.env.MARKETS_EXPLAIN_DAILY_CAP, 1000, 50, 1_000_000),
  'mcp-lint': clampInt(process.env.MCP_LINT_DAILY_CAP, 60, 5, 100_000),
}

export function dayStartUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** Window key for a fuse. `f:` is its own namespace in the limiter table —
 *  the hourly sweeps skip it (a day window must live a day). */
export const fuseKey = (id: FuseId): string => `f:${id}`

/** Post-increment decision: the call that lands ON the cap still runs. */
export function fuseBlown(id: FuseId, countAfterBump: number): boolean {
  return countAfterBump > FUSE_CAPS[id]
}

/** Bump a fuse and report whether it has blown. `weight` lets one request
 *  that makes several model calls count honestly. Fails OPEN. */
export async function bumpFuse(id: FuseId, weight = 1): Promise<boolean> {
  try {
    const { default: prisma } = await import('@/lib/db')
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO unsigned_turn_windows (key, window_start, count)
      VALUES (${fuseKey(id)}, ${dayStartUTC()}, ${weight})
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = unsigned_turn_windows.count + ${weight}
      RETURNING count
    `
    return fuseBlown(id, Number(rows[0]?.count ?? 0))
  } catch {
    return false
  }
}

/** Read a fuse without bumping it (the admin page, the harness). */
export async function fuseCount(id: FuseId): Promise<number> {
  try {
    const { default: prisma } = await import('@/lib/db')
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count FROM unsigned_turn_windows WHERE key = ${fuseKey(id)} AND window_start = ${dayStartUTC()}
    `
    return Number(rows[0]?.count ?? 0)
  } catch {
    return 0
  }
}
