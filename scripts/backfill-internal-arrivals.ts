// scripts/backfill-internal-arrivals.ts — flag LEGACY harness rows on the
// arrival tables (and the #637 embed_turns backfill) as is_internal.
//
//   DATABASE_URL=… npx tsx scripts/backfill-internal-arrivals.ts           # DRY RUN — counts only
//   DATABASE_URL=… npx tsx scripts/backfill-internal-arrivals.ts --apply   # writes (OWNER-GATED)
//
// WHY: the 2026-08-17 audit found the GTM arc's DENOMINATOR was ~95% our own
// harness — 690 wallets minted 3,026 intent_links in 30d, 427 wrote
// wallet_working_sets, and the daily curve matched test:api run days exactly.
// The live fix stamps every new row at its write site (lib/internal-run.ts);
// this script materializes the SAME classification on the rows that predate
// the stamp, using the heuristics the audit itself used:
//
//   intent_links
//     H1  agent ILIKE 'harness%'                            (desk harness mints, creator NULL)
//     H2  ask LIKE 'DRILL %' OR ask ILIKE '%(admin drill)%'   (named drills)
//     H3  THROWAWAY CREATOR — every one of the creator's links is a harness
//         fixture ask, all minted inside one 15-minute burst, the creator is
//         not a TEST_WALLET, and the creator never signed real money
//         (embed_turns outcome='signed', not internal). All its links flag.
//   wallet_working_sets
//     W1  owner is an H3 throwaway creator
//     W2  service_ids = '{}' AND the owner has NO other footprint (chats,
//         embed_turns, intent_links, jobs, dca, guardian) AND created before
//         2026-07-23 — the pre-links-era harness probe (curve: 07-13..07-22,
//         zero after; the 4 later stragglers are left alone on purpose)
//   jobs
//     J1  origin_env = 'dev'   (a local machine — never a stranger)
//     J2  wallet in the fixture placeholder set (0x1111…, 0x2222…, 0x3333…, 0x4444…)
//   dca_schedules
//     D1  origin_env = 'dev'   (local machine)
//     D2  fixture placeholder wallets or H3 throwaway creators
//   broker_intents
//     B1  harness identities/bylines (the public /agents record excludes them)
//   ask_failures
//     A1  fixture/throwaway wallets or drill prompts (the admin feed hides stamped rows)
//   chats
//     C1  title = 'test:api receipts' (the one fixture the suite never cleaned)
//     C2  owner is an H3 throwaway creator or a W2 owner
//   embed_turns  — the #637 predicate verbatim (harness- session ids + the
//     internal-origin patterns), moves no public number (⊆ read filters)
//
// SAFETY: dry-run by default and prints per-heuristic counts + a sample; the
// wallet-level rules refuse TEST_WALLETS and any wallet that signed real
// money; every UPDATE is `WHERE NOT is_internal AND (…)`, so re-running is a
// no-op. Nothing here deletes.

import { PrismaClient, Prisma } from '@prisma/client'
import { TEST_WALLETS } from '../lib/admin'
import { INTERNAL_ORIGIN_SQL } from '../lib/value-origin'
import { agentHandleFor } from '../lib/agent-record'

const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient()

/** The exact asks the harness mints per throwaway wallet (scripts/test-api.ts +
 *  drill:kickback + fingerprint/preflight fixtures). A creator whose EVERY
 *  link is one of these, in one burst, is a throwaway by construction. */
export const HARNESS_FIXTURE_ASKS = [
  'Buy $9 of AAPL for the promo',
  'Buy $12 of AAPL',
  'Stake some ETH for me',
  'DCA $25 into ETH weekly',
  'Swap $5 of ETH to USDC',
  'Buy $10 of AAPL on ours',
  'Buy $5 of AAPL, planned by my agent',
  'Buy $12 of TSLA',
  'tile my wallet 60% ETH, 40% USDC on base',
  'tile my wallet 50% ETH, 50% USDC on base',
  'Buy $5 of AAPL, sent by a friend',
]

const FIXTURE_WALLETS = [
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
  '0x4444444444444444444444444444444444444444',
]

const testWallets = ['', ...Array.from(TEST_WALLETS).map((w) => w.toLowerCase())]

/** H3 — throwaway creators, as a reusable CTE body. */
const THROWAWAY_CREATORS = Prisma.sql`
  SELECT creator AS a FROM intent_links
  WHERE creator IS NOT NULL
  GROUP BY creator
  HAVING bool_and(ask = ANY(${HARNESS_FIXTURE_ASKS}) OR ask LIKE 'DRILL %' OR ask ILIKE '%(admin drill)%' OR coalesce(agent, '') ILIKE 'harness%')
     AND max(created_at) - min(created_at) < interval '15 minutes'
     AND creator <> ALL(${testWallets})
     AND NOT EXISTS (
       SELECT 1 FROM embed_turns t
       WHERE lower(t.wallet_address) = intent_links.creator AND t.outcome = 'signed' AND NOT ${Prisma.raw(INTERNAL_ORIGIN_SQL)}
     )
`

/** W2 — bare empty write-throughs from wallets with no other footprint. */
const BARE_WORKING_SETS = Prisma.sql`
  SELECT owner_address AS a FROM wallet_working_sets w
  WHERE w.service_ids = '{}' AND w.created_at < '2026-07-23'
    AND w.owner_address <> ALL(${testWallets})
    AND NOT EXISTS (SELECT 1 FROM chats c WHERE lower(c.owner_address) = w.owner_address)
    AND NOT EXISTS (SELECT 1 FROM embed_turns t WHERE lower(t.wallet_address) = w.owner_address OR lower(t.owner_address) = w.owner_address)
    AND NOT EXISTS (SELECT 1 FROM intent_links l WHERE l.creator = w.owner_address)
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE lower(j.wallet) = w.owner_address)
    AND NOT EXISTS (SELECT 1 FROM dca_schedules d WHERE lower(d.wallet) = w.owner_address)
    AND NOT EXISTS (SELECT 1 FROM hl_guardian_policies g WHERE lower(g.wallet) = w.owner_address)
`

interface Rule {
  table: string
  id: string
  note: string
  /** The predicate over unflagged rows of `table` (references bare columns). */
  where: Prisma.Sql
}

const RULES: Rule[] = [
  { table: 'intent_links', id: 'H1', note: "agent ILIKE 'harness%'", where: Prisma.sql`agent ILIKE 'harness%'` },
  { table: 'intent_links', id: 'H2', note: 'DRILL / (admin drill) asks', where: Prisma.sql`(ask LIKE 'DRILL %' OR ask ILIKE '%(admin drill)%')` },
  { table: 'intent_links', id: 'H3', note: 'throwaway creators (fixture-only asks, one burst, never signed real money)', where: Prisma.sql`creator IN (${THROWAWAY_CREATORS})` },
  { table: 'wallet_working_sets', id: 'W1', note: 'owner is an H3 throwaway creator', where: Prisma.sql`owner_address IN (${THROWAWAY_CREATORS})` },
  { table: 'wallet_working_sets', id: 'W2', note: 'bare {} write-through, no other footprint, pre-2026-07-23', where: Prisma.sql`owner_address IN (${BARE_WORKING_SETS})` },
  { table: 'jobs', id: 'J1', note: "origin_env = 'dev' (local machine)", where: Prisma.sql`origin_env = 'dev'` },
  { table: 'jobs', id: 'J2', note: 'fixture placeholder wallets', where: Prisma.sql`lower(wallet) = ANY(${FIXTURE_WALLETS})` },
  { table: 'dca_schedules', id: 'D1', note: "origin_env = 'dev' (local machine)", where: Prisma.sql`origin_env = 'dev'` },
  { table: 'dca_schedules', id: 'D2', note: 'fixture placeholder wallets or H3 throwaway creators', where: Prisma.sql`(lower(wallet) = ANY(${FIXTURE_WALLETS}) OR lower(wallet) IN (${THROWAWAY_CREATORS}))` },
  { table: 'broker_intents', id: 'B1', note: "harness identities/bylines (agent or agent_key LIKE 'harness%', 'Harness Agent')", where: Prisma.sql`(coalesce(agent, '') ILIKE 'harness%' OR coalesce(agent_key, '') ILIKE 'harness%' OR agent_key_hash = ${agentHandleFor('harness-desk-key')})` },
  { table: 'ask_failures', id: 'A1', note: 'fixture placeholder wallets or H3 throwaway creators, or [drill] prompts', where: Prisma.sql`(lower(coalesce(wallet, '')) = ANY(${FIXTURE_WALLETS}) OR lower(coalesce(wallet, '')) IN (${THROWAWAY_CREATORS}) OR prompt LIKE 'DRILL %' OR prompt ILIKE '%(stamped drill)%')` },
  { table: 'chats', id: 'C1', note: "title = 'test:api receipts'", where: Prisma.sql`title = 'test:api receipts'` },
  { table: 'chats', id: 'C2', note: 'owner is an H3 throwaway creator or a W2 owner', where: Prisma.sql`(lower(owner_address) IN (${THROWAWAY_CREATORS}) OR lower(owner_address) IN (${BARE_WORKING_SETS}))` },
  {
    table: 'embed_turns',
    id: 'E1',
    note: 'the #637 backfill predicate (harness- session ids + internal-origin patterns)',
    where: Prisma.sql`(session_id LIKE 'harness-%' OR ${Prisma.raw(INTERNAL_ORIGIN_SQL.replace(/^\(is_internal OR /, '('))})`,
  },
]

async function main() {
  console.log(`backfill-internal-arrivals — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (counts only; pass --apply to write)'}\n`)

  const totals = new Map<string, { before: number; flagged: number; would: number }>()
  for (const t of ['intent_links', 'wallet_working_sets', 'jobs', 'dca_schedules', 'broker_intents', 'ask_failures', 'chats', 'embed_turns']) {
    const [{ n, f }] = await prisma.$queryRaw<{ n: bigint; f: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS n, count(*) FILTER (WHERE is_internal)::bigint AS f FROM ${Prisma.raw(t)}`,
    )
    totals.set(t, { before: Number(n), flagged: Number(f), would: 0 })
  }

  // The union count per table (rules overlap; the UPDATE is one statement per
  // table over the OR of its rules, so report the union too).
  const perTable = new Map<string, Prisma.Sql[]>()
  for (const r of RULES) {
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS n FROM ${Prisma.raw(r.table)} WHERE NOT is_internal AND ${r.where}`,
    )
    console.log(`  ${r.table.padEnd(20)} ${r.id}  ${String(n).padStart(6)}  ${r.note}`)
    perTable.set(r.table, [...(perTable.get(r.table) ?? []), r.where])
  }
  console.log()
  for (const [table, wheres] of perTable) {
    const union = Prisma.join(wheres.map((w) => Prisma.sql`(${w})`), ' OR ')
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS n FROM ${Prisma.raw(table)} WHERE NOT is_internal AND (${union})`,
    )
    const t = totals.get(table)!
    t.would = Number(n)
    console.log(
      `  ${table.padEnd(20)} rows=${t.before}  already flagged=${t.flagged}  WOULD FLAG=${t.would}  → remaining organic=${t.before - t.flagged - t.would}`,
    )
    if (APPLY) {
      const res = await prisma.$executeRaw(
        Prisma.sql`UPDATE ${Prisma.raw(table)} SET is_internal = true WHERE NOT is_internal AND (${union})`,
      )
      console.log(`    ✓ applied: ${res} rows updated`)
    }
  }

  // Samples so the owner can eyeball the classification before --apply.
  console.log('\n  sample — intent_links creators that WOULD flag (H3), newest 5:')
  const sample = await prisma.$queryRaw<{ creator: string; n: bigint; asks: string }[]>(
    Prisma.sql`SELECT creator, count(*)::bigint AS n, string_agg(DISTINCT left(ask, 30), ' | ') AS asks
               FROM intent_links WHERE NOT is_internal AND creator IN (${THROWAWAY_CREATORS})
               GROUP BY creator ORDER BY max(created_at) DESC LIMIT 5`,
  )
  for (const s of sample) console.log(`    ${s.creator}  ×${s.n}  ${s.asks}`)
  console.log('\n  sample — intent_links creators that would NOT flag (organic), by links:')
  const keep = await prisma.$queryRaw<{ creator: string; n: bigint; asks: string }[]>(
    Prisma.sql`SELECT creator, count(*)::bigint AS n, string_agg(DISTINCT left(ask, 30), ' | ') AS asks
               FROM intent_links WHERE NOT is_internal AND creator IS NOT NULL AND creator NOT IN (${THROWAWAY_CREATORS})
                 AND NOT (coalesce(agent, '') ILIKE 'harness%' OR ask LIKE 'DRILL %' OR ask ILIKE '%(admin drill)%')
               GROUP BY creator ORDER BY n DESC LIMIT 12`,
  )
  for (const s of keep) console.log(`    ${s.creator}  ×${s.n}  ${s.asks.slice(0, 120)}`)

  if (!APPLY) console.log('\nDRY RUN — nothing written. Re-run with --apply (owner) to flag these rows.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
