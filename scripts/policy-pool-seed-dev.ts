// DEV ONLY — fills the TEST DB's policy_pool_events with clearly labelled
// rows (origin 'demo:seed', intent ids 'seed-…', meta.seed = true) so
// /policy-pool can be looked at with data in it. `--clean` deletes exactly
// those rows. Refuses to run against any host but the TEST DB.
//
//   DATABASE_URL=<TEST> npx tsx scripts/policy-pool-seed-dev.ts
//   DATABASE_URL=<TEST> npx tsx scripts/policy-pool-seed-dev.ts --clean

import { randomBytes } from 'node:crypto'
import { PrismaClient, type Prisma } from '@prisma/client'

const url = process.env.DATABASE_URL ?? ''
if (!/ep-tiny-butterfly/.test(url)) {
  console.error('Refusing: DATABASE_URL is not the TEST DB (ep-tiny-butterfly…).')
  process.exit(1)
}
const prisma = new PrismaClient()
const ORIGIN = 'demo:seed'
const CHAIN = 84532
const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
const ETH = '0x0000000000000000000000000000000000000000'
const hash = () => `0x${randomBytes(32).toString('hex')}`
const addr = () => `0x${randomBytes(20).toString('hex')}`

async function clean() {
  const r = await prisma.policyPoolEvent.deleteMany({ where: { origin: ORIGIN } })
  console.log(`deleted ${r.count} demo:seed rows`)
}

async function seed() {
  const now = Date.now()
  const rows: Prisma.PolicyPoolEventCreateManyInput[] = []
  const swapper = addr()
  // A happy walk per intent, spread over the last 14 days (denser today).
  const offsetsMin = [3, 22, 70, 140, 300, 520, 900, 1300, 2900, 4400, 7300, 10100, 14500, 18800]
  offsetsMin.forEach((m, i) => {
    const id = `seed-${String(i + 1).padStart(3, '0')}`
    const usd = [25, 40, 12.5, 25, 100, 60, 25, 250, 75, 25, 30, 480, 18, 25][i]
    const buy = i % 3 !== 2
    const t0 = now - m * 60_000
    const tx = hash()
    const step = (kind: string, dt: number, extra: Record<string, unknown> = {}) =>
      rows.push({ kind, chainId: CHAIN, intentId: id, origin: ORIGIN, swapper, createdAt: new Date(t0 + dt * 1000), meta: { seed: true }, ...extra })
    const ethAtoms = BigInt(Math.round((usd / 2400) * 1e18)).toString()
    const usdcAtoms = String(Math.round(usd * 1e6))
    const amounts = buy
      ? { amountIn: usdcAtoms, amountOut: ethAtoms, meta: { seed: true, currencyIn: USDC, currencyOut: ETH } }
      : { amountIn: ethAtoms, amountOut: usdcAtoms, meta: { seed: true, currencyIn: ETH, currencyOut: USDC } }
    step('guard_allowed', 0, { usd, reason: null })
    step('attested', 1)
    step('handed_off', 2)
    if (i === 6) return // one walked away before signing
    step('signed', 14 + i)
    step('mined', 18 + i, { txHash: tx, blockNumber: 1_000_000 + i })
    step('fill', 18 + i, { txHash: tx, blockNumber: 1_000_000 + i, logIndex: 3, usd, ...amounts })
    if (i % 2 === 0) step('dune_seen', 120 + i * 7, { txHash: tx })
  })
  // The cap holding twice: the guard refuses $5,000; a forged attestation reverts.
  rows.push({ kind: 'guard_refused', chainId: CHAIN, intentId: 'seed-cap-5000', origin: ORIGIN, usd: 5000, reason: 'Over the $500 per-order cap.', createdAt: new Date(now - 40 * 60_000), meta: { seed: true } })
  rows.push({ kind: 'guard_refused', chainId: CHAIN, intentId: 'seed-cap-1200', origin: ORIGIN, usd: 1200, reason: 'Over the $500 per-order cap.', createdAt: new Date(now - 26 * 3600_000), meta: { seed: true } })
  rows.push({ kind: 'onchain_revert', chainId: CHAIN, intentId: 'seed-forged', origin: ORIGIN, swapper: addr(), txHash: hash(), reason: 'BadSigner()', createdAt: new Date(now - 35 * 60_000), meta: { seed: true } })
  rows.push({ kind: 'onchain_revert', chainId: CHAIN, intentId: 'seed-plain', origin: ORIGIN, swapper: addr(), txHash: hash(), reason: 'NotAttested()', createdAt: new Date(now - 5 * 3600_000), meta: { seed: true } })
  const r = await prisma.policyPoolEvent.createMany({ data: rows })
  console.log(`inserted ${r.count} demo:seed rows`)
}

;(process.argv.includes('--clean') ? clean() : seed())
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
