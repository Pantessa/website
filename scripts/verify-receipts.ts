#!/usr/bin/env tsx
/**
 * Backfill on-chain verification for earn receipts (P0 trust layer). Finds
 * receipts that carry a settlement `txHash` but haven't been checked yet
 * (verified IS NULL) and confirms each against the chain via verifyReceipt().
 * Idempotent; safe to re-run. New receipts are verified inline by the
 * POST /api/mcp/receipts route — this is for backfilling the ones that predate
 * verification (or that the RPC missed on first try).
 *
 *   DATABASE_URL=... npm run verify:receipts
 */
import prisma from '@/lib/db'
import { verifyReceipt } from '@/lib/receipt-verify'

async function main() {
  const pending = await prisma.mcpReceipt.findMany({
    where: { txHash: { not: null }, verified: null },
    select: { id: true, mcpSlug: true, amountUsd: true, network: true, txHash: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Verifying ${pending.length} unchecked receipt(s) with a txHash…`)
  let ok = 0
  let flagged = 0
  let pendingStill = 0
  for (const r of pending) {
    await verifyReceipt(r.id)
    const after = await prisma.mcpReceipt.findUnique({ where: { id: r.id }, select: { verified: true } })
    const v = after?.verified
    if (v === true) ok++
    else if (v === false) flagged++
    else pendingStill++
    console.log(`  ${r.mcpSlug}  $${r.amountUsd}  ${r.network}  ${r.txHash?.slice(0, 14)}…  → verified=${String(v)}`)
  }
  console.log(`\nDone: ${ok} verified, ${flagged} flagged (chain contradicts), ${pendingStill} still unresolved (RPC/recipient).`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
