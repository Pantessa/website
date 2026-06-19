#!/usr/bin/env tsx
/**
 * Regression test for the earn-receipt on-chain verifier (lib/receipt-verify.ts).
 * Self-contained: sets up a throwaway claimed MCP (receiver-verified) pointing at
 * a REAL, immutable historical Base-mainnet USDC transfer, then exercises every
 * branch of verifyReceipt() and asserts the resulting `verified` flag. Creates
 * and deletes its own rows; safe to re-run. Needs DATABASE_URL + a Base RPC.
 *
 *   DATABASE_URL=… npm run test:verify
 *
 * The fixture is a real settled USDC Transfer on Base (chain 8453) — pinned by
 * hash so the test is deterministic. Verified at authoring time via
 * eth_getTransactionReceipt.
 */
import prisma from '@/lib/db'
import { verifyReceipt } from '@/lib/receipt-verify'

const FIX = {
  txHash: '0x59067a372883a14018f9a4fdd2cb1d9fe93750528539bdc6026e196d07ca053b',
  to: '0xe9030014f5dae217d0a152f02a043567b16c1abf', // the Transfer recipient (lowercased)
  usd: 0.00481, // 4810 atomic USDC (6 decimals)
}
const SLUG = '__verify_test__'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}

/** Create a receipt, verify it, return the resulting `verified` value, delete it. */
async function verifyOnce(data: { amountUsd: number; txHash?: string; network?: string }): Promise<boolean | null> {
  const r = await prisma.mcpReceipt.create({
    data: { mcpSlug: SLUG, ownerAddress: FIX.to, amountUsd: data.amountUsd, txHash: data.txHash ?? null, network: data.network ?? 'base' },
    select: { id: true },
  })
  try {
    await verifyReceipt(r.id)
    const after = await prisma.mcpReceipt.findUnique({ where: { id: r.id }, select: { verified: true } })
    return after?.verified ?? null
  } finally {
    await prisma.mcpReceipt.delete({ where: { id: r.id } }).catch(() => {})
  }
}

async function main() {
  console.log('— receipt verifier (lib/receipt-verify.ts)')
  // The receiver-verified owner makes expectedRecipient() resolve to FIX.to.
  await prisma.mcpOwner.deleteMany({ where: { mcpSlug: SLUG } })
  await prisma.mcpReceipt.deleteMany({ where: { mcpSlug: SLUG } })
  await prisma.mcpOwner.create({ data: { mcpSlug: SLUG, ownerAddress: FIX.to, verifiedVia: 'receiver' } })

  try {
    check('real tx + matching amount → verified=true', (await verifyOnce({ amountUsd: FIX.usd, txHash: FIX.txHash })) === true)

    check('real tx + inflated claim (100×) → verified=false (flagged)', (await verifyOnce({ amountUsd: FIX.usd * 100, txHash: FIX.txHash })) === false)

    check('no txHash → verified=null (unverifiable, not flagged)', (await verifyOnce({ amountUsd: FIX.usd })) === null)

    const fakeTx = '0x' + 'ff'.repeat(32)
    check('nonexistent txHash → verified=null (retryable, not flagged)', (await verifyOnce({ amountUsd: FIX.usd, txHash: fakeTx })) === null)

    check('testnet network for a mainnet tx → verified=null (wrong chain)', (await verifyOnce({ amountUsd: FIX.usd, txHash: FIX.txHash, network: 'base-sepolia' })) === null)
  } finally {
    await prisma.mcpReceipt.deleteMany({ where: { mcpSlug: SLUG } })
    await prisma.mcpOwner.deleteMany({ where: { mcpSlug: SLUG } })
  }

  console.log(`\n${pass} passed, ${fail} failed.`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
