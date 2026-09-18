// scripts/backfill-job-step-paths.ts — give LEGACY signed job-step turns the
// build path their live siblings now carry.
//
//   DATABASE_URL=… npx tsx scripts/backfill-job-step-paths.ts           # DRY RUN — the plan + the money delta
//   DATABASE_URL=… npx tsx scripts/backfill-job-step-paths.ts --apply   # writes (OWNER-GATED — see MONEY below)
//
// WHY: until the fix this script accompanies, a signed job step reported the
// raw job builder id as its build path. Most builder ids are not BuildPaths,
// so the telemetry route's allowlist dropped them and the row landed with
// build_path NULL — and every fee reader (lib/fees FEE_BEARING_BUILD_PATHS /
// netFeeBpsForTurn, the creator studio + claims, the public fee strip, the
// admin Growth books) needs a fee-bearing path to price a turn. Prod on
// 2026-09-18: $308.50 of $347.50 of real signed 30-day volume was job-step
// rows with a NULL path, so the funded "Fund Robinhood Chain … then buy $X of
// AAPL" flow — which really does pay 20/50 bps on chain — counted as volume
// and earned its link creator nothing.
//
// ⚠️ MONEY: creator earnings are computed read-time from these rows and are
// CLAIMABLE USDC. Stamping a fee-bearing path on a legacy row creates a claim
// that did not exist yesterday. Stamping native-cross-chain-leg REMOVES one
// (pass 2 below). This is Nate's call, not the loop's — hence --apply.
//
// LINKAGE (the honest part): the turn row carries NO job id. The beacon sends
// one, but embed_turns has no column for it, and the first-party lane strips
// `detail` and (before this fix) sent no txUrl — so legacy rows hold only
// wallet + timestamp + value + fee tier. The match below is therefore a
// HEURISTIC, and it only writes when the heuristic is unambiguous:
//
//   a done `sign` step of a job owned by the same wallet, whose updated_at is
//   within ±MATCH_WINDOW_S of the turn and whose value_usd equals the turn's
//   to the cent, and where every such candidate agrees on the same path.
//
// The path itself is NOT guessed: it comes from the step's own stored
// artifact — the txChain refresh recipe names the venue the cascade settled
// on (uniswap-swap / uniswap-v4-swap / lifi-swap / lifi-bridge) — via the
// same lib/job-step-telemetry ladder the live beacon uses. Rows that don't
// resolve are listed and left NULL. Nothing here deletes, and re-running is a
// no-op (`WHERE build_path IS NULL`, plus the explicit pass-2 predicate).

import { PrismaClient } from '@prisma/client'
import { FEE_BEARING_BUILD_PATHS, CREATOR_FEE_SPLIT, netFeeBpsForTurn } from '../lib/fees'
import { jobStepBuildPath } from '../lib/job-step-telemetry'

const APPLY = process.argv.includes('--apply')
/** How far a step's completion may sit from the beacon it wrote. Measured on
 *  prod: the true pair lands 1–5s apart; the nearest WRONG step of the same
 *  job is 13–66s away. 20s keeps the pairs and drops most of the noise. */
const MATCH_WINDOW_S = 20
const prisma = new PrismaClient()

type TurnRow = { id: string; created_at: Date; value_usd: number | null; fee_bps: number | null; wallet_address: string | null; intent_link_slug: string | null; is_internal: boolean }
type StepRow = { id: string; builder: string; artifact: unknown; value_usd: number | null; updated_at: Date; wallet: string; job_title: string }

const usd = (n: number) => `$${n.toFixed(2)}`

async function main() {
  // ── Pass 1: NULL build_path on signed job-step turns ────────────────────
  const turns = await prisma.$queryRawUnsafe<TurnRow[]>(`
    SELECT id, created_at, value_usd, fee_bps, wallet_address, intent_link_slug, is_internal
      FROM embed_turns
     WHERE artifact = 'job-step' AND build_path IS NULL AND outcome IN ('signed','tx-built')
     ORDER BY created_at DESC`)

  const steps = await prisma.$queryRawUnsafe<StepRow[]>(`
    SELECT s.id, s.builder, s.artifact, s.value_usd, s.updated_at, lower(j.wallet) AS wallet, j.title AS job_title
      FROM job_steps s JOIN jobs j ON j.id = s.job_id
     WHERE s.kind = 'sign' AND s.status = 'done'`)

  const byWallet = new Map<string, StepRow[]>()
  for (const s of steps) {
    const list = byWallet.get(s.wallet) ?? []
    list.push(s)
    byWallet.set(s.wallet, list)
  }

  const planned: { turn: TurnRow; path: string; builder: string; job: string; dtS: number }[] = []
  const unresolved: { turn: TurnRow; why: string }[] = []

  for (const t of turns) {
    if (!t.wallet_address || t.value_usd == null) {
      unresolved.push({ turn: t, why: !t.wallet_address ? 'no wallet on the row' : 'no value on the row' })
      continue
    }
    const candidates = (byWallet.get(t.wallet_address) ?? [])
      .map((s) => ({ s, dt: Math.abs((s.updated_at.getTime() - t.created_at.getTime()) / 1000) }))
      .filter(({ s, dt }) => dt <= MATCH_WINDOW_S && s.value_usd != null && Math.abs((s.value_usd as number) - (t.value_usd as number)) <= 0.01)
    if (candidates.length === 0) {
      unresolved.push({ turn: t, why: `no done sign step within ${MATCH_WINDOW_S}s at ${usd(t.value_usd)}` })
      continue
    }
    const paths = new Set(candidates.map(({ s }) => jobStepBuildPath(s.builder, s.artifact)))
    if (paths.size !== 1 || !paths.has([...paths][0]) || [...paths][0] === undefined) {
      unresolved.push({ turn: t, why: `${candidates.length} candidates disagree: ${[...paths].join(' / ')}` })
      continue
    }
    const best = candidates.sort((a, b) => a.dt - b.dt)[0]
    planned.push({ turn: t, path: [...paths][0] as string, builder: best.s.builder, job: best.s.job_title, dtS: Math.round(best.dt) })
  }

  // ── Pass 2: job cross-chain legs wearing the FEE-BEARING chat path ──────
  // The runner builds a job's cross-chain leg with NO appFees on purpose
  // ("insufficient funds" must never cost extra to fix), but the beacon sent
  // 'native-cross-chain' — which IS in the fee map. Those rows have been
  // earning a fee nobody charged. Correcting them REMOVES creator earnings.
  const legs = await prisma.$queryRawUnsafe<TurnRow[]>(`
    SELECT id, created_at, value_usd, fee_bps, wallet_address, intent_link_slug, is_internal
      FROM embed_turns
     WHERE artifact = 'job-step' AND build_path = 'native-cross-chain'`)

  // ── The money delta, per creator, real traffic only ─────────────────────
  const earn = (valueUsd: number | null, feeBps: number | null, path: string | null) => {
    if (!valueUsd || !path || !FEE_BEARING_BUILD_PATHS.has(path)) return 0
    return valueUsd * (netFeeBpsForTurn(path, feeBps) / 10_000) * CREATOR_FEE_SPLIT
  }
  const delta = new Map<string, number>()
  const bump = (slug: string | null, internal: boolean, d: number) => {
    if (!slug || internal || d === 0) return
    delta.set(slug, (delta.get(slug) ?? 0) + d)
  }
  for (const p of planned) bump(p.turn.intent_link_slug, p.turn.is_internal, earn(p.turn.value_usd, p.turn.fee_bps, p.path))
  for (const l of legs) bump(l.intent_link_slug, l.is_internal, -earn(l.value_usd, l.fee_bps, 'native-cross-chain'))

  // ── Report ──────────────────────────────────────────────────────────────
  const byPath = new Map<string, { n: number; usd: number }>()
  for (const p of planned) {
    const cur = byPath.get(p.path) ?? { n: 0, usd: 0 }
    byPath.set(p.path, { n: cur.n + 1, usd: cur.usd + (p.turn.value_usd ?? 0) })
  }
  console.log(`\njob-step build_path backfill — ${APPLY ? 'APPLY' : 'DRY RUN'}\n`)
  console.log(`pass 1: ${turns.length} job-step turns with a NULL path — ${planned.length} resolve, ${unresolved.length} do not`)
  for (const [path, v] of [...byPath].sort((a, b) => b[1].usd - a[1].usd)) {
    console.log(`   ${path.padEnd(26)} ${String(v.n).padStart(4)} rows  ${usd(v.usd).padStart(10)}  ${FEE_BEARING_BUILD_PATHS.has(path) ? 'FEE-BEARING' : 'fee-free'}`)
  }
  console.log(`\npass 2: ${legs.length} job cross-chain legs wearing the fee-bearing chat path → native-cross-chain-leg (fee-free)`)
  console.log(`\ncreator earnings delta (real traffic, claimable USDC):`)
  if (delta.size === 0) console.log('   none — no resolved row carries a link slug')
  for (const [slug, d] of [...delta].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) {
    console.log(`   /i/${slug.padEnd(12)} ${d >= 0 ? '+' : '−'}$${Math.abs(d).toFixed(4)}`)
  }
  if (unresolved.length) {
    console.log(`\nunresolved (left NULL — the row carries no job id, so nothing links them):`)
    for (const u of unresolved.slice(0, 20)) console.log(`   ${u.turn.id}  ${u.turn.created_at.toISOString()}  ${usd(u.turn.value_usd ?? 0).padStart(9)}  ${u.why}`)
    if (unresolved.length > 20) console.log(`   … and ${unresolved.length - 20} more`)
  }
  if (planned.length) {
    console.log(`\nsample of the plan:`)
    for (const p of planned.slice(0, 12)) console.log(`   ${p.turn.created_at.toISOString()}  ${usd(p.turn.value_usd ?? 0).padStart(9)}  ${p.builder.padEnd(18)} → ${p.path.padEnd(24)} (Δ${p.dtS}s)  ${p.job.slice(0, 48)}`)
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to write (this CHANGES claimable creator earnings).\n`)
    return
  }

  let n = 0
  for (const p of planned) {
    n += await prisma.$executeRawUnsafe(
      `UPDATE embed_turns SET build_path = $1 WHERE id = $2 AND build_path IS NULL`,
      p.path,
      p.turn.id,
    )
  }
  const legN = await prisma.$executeRawUnsafe(
    `UPDATE embed_turns SET build_path = 'native-cross-chain-leg' WHERE artifact = 'job-step' AND build_path = 'native-cross-chain'`,
  )
  console.log(`\nwrote ${n} paths, corrected ${legN} cross-chain legs.\n`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
