// lib/house-spend.ts — the HOUSE wallet's own daily x402 ceiling.
//
// Burner-mode turns (guest lane, embeds, any turn without a signed session)
// pay their x402 calls from the house PRIVATE_KEY. Per-call bounds live in
// lib/x402 (listed price + tolerance + absolute ceiling); this is the SECOND
// fence — the total the house will authorize in one UTC day, whoever asked.
// A stranger cycling burner wallets through paid directory services once
// had nothing between them and the burner's whole balance except the
// hourly turn count (SECURITY-AUDIT-2026-09-08 §B1 / §E1).
//
// Store: one row per UTC day, `house_spend_days(day date PK, spent_micro
// bigint)`, reserved ATOMICALLY (increment guarded by the ceiling in the same
// statement) before a signature exists. The table is created lazily
// (additive DDL, CREATE TABLE IF NOT EXISTS) so a deploy never depends on an
// owner running SQL first. FAIL CLOSED: a store hiccup refuses the payment —
// this guards money leaving the house, not a convenience.

import prisma from '@/lib/db'

/** Default daily ceiling, USD. Override with HOUSE_X402_DAILY_CEILING_USD. */
export const HOUSE_X402_DAILY_CEILING_DEFAULT_USD = 10

export function houseDailyCeilingUsd(): number {
  const raw = Number(process.env.HOUSE_X402_DAILY_CEILING_USD)
  return Number.isFinite(raw) && raw >= 0 ? raw : HOUSE_X402_DAILY_CEILING_DEFAULT_USD
}

const fmt = (n: number) => `$${n.toFixed(2)}`

/** The user-facing refusal when the house has spent its day. */
export function houseCeilingReply(ceilingUsd: number): string {
  return `The house wallet has reached its daily paid-services ceiling (${fmt(ceilingUsd)} in x402 calls per UTC day) — paid directory services pause until tomorrow. Free MCPs and every native build still work; sign in and pay per call from your own wallet to keep going now.`
}

/** Pure decision: does reserving `amountUsd` fit under the ceiling given
 *  what's already spent today? (Exported for the harness.) */
export function fitsHouseCeiling(spentTodayUsd: number, amountUsd: number, ceilingUsd = houseDailyCeilingUsd()): boolean {
  return spentTodayUsd + amountUsd <= ceilingUsd + 1e-9
}

let ensured: Promise<void> | null = null
async function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = prisma
      .$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS house_spend_days (day date PRIMARY KEY, spent_micro bigint NOT NULL DEFAULT 0)`,
      )
      .then(() => undefined)
      .catch((e) => {
        ensured = null
        throw e
      })
  }
  await ensured
}

const toMicro = (usd: number) => BigInt(Math.ceil(Math.max(0, usd) * 1_000_000 - 1e-9))

/** USD the house has authorized so far today (UTC). Throws on store errors. */
export async function houseSpentTodayUsd(): Promise<number> {
  await ensureTable()
  const rows = await prisma.$queryRaw<{ spent_micro: bigint | number | string }[]>`
    SELECT spent_micro FROM house_spend_days WHERE day = (now() AT TIME ZONE 'utc')::date
  `
  const micro = rows[0]?.spent_micro
  return micro == null ? 0 : Number(micro) / 1_000_000
}

/**
 * Reserve `amountUsd` against today's ceiling. Returns null when reserved,
 * or the user-facing refusal. The increment and the ceiling check are ONE
 * statement, so concurrent turns can't both squeeze under the line.
 */
export async function reserveHouseSpend(amountUsd: number): Promise<string | null> {
  const ceiling = houseDailyCeilingUsd()
  if (!Number.isFinite(amountUsd) || amountUsd < 0) return 'The payment amount could not be read — refused; nothing was signed.'
  if (amountUsd > ceiling) return houseCeilingReply(ceiling)
  try {
    await ensureTable()
    const amt = toMicro(amountUsd)
    const cap = toMicro(ceiling)
    const rows = await prisma.$queryRaw<{ spent_micro: bigint | number | string }[]>`
      INSERT INTO house_spend_days (day, spent_micro)
      VALUES ((now() AT TIME ZONE 'utc')::date, ${amt})
      ON CONFLICT (day) DO UPDATE
        SET spent_micro = house_spend_days.spent_micro + EXCLUDED.spent_micro
        WHERE house_spend_days.spent_micro + EXCLUDED.spent_micro <= ${cap}
      RETURNING spent_micro
    `
    return rows.length === 1 ? null : houseCeilingReply(ceiling)
  } catch (e) {
    console.warn('[house-spend] reservation failed (refusing the payment, fail closed):', e instanceof Error ? e.message : e)
    return 'The house spend ledger is unavailable right now, so Pantessa refused to pay for this call (nothing was signed). Try again in a minute, or sign in and pay from your own wallet.'
  }
}
