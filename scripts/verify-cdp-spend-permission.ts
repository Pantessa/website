#!/usr/bin/env tsx
/**
 * One-off verification for the CDP Spend Permission flow (slice 2). Runs the
 * full create on **Base Sepolia** (no real funds). NOT part of test:api — it
 * has on-chain side effects, needs CDP creds, and is slow. Run:
 *
 *   CDP_API_KEY_ID=… CDP_API_KEY_SECRET=… CDP_WALLET_SECRET=… \
 *     npx tsx scripts/verify-cdp-spend-permission.ts
 */
import { createGrantSpendPermission, getExpenseSmartAccount, getSpenderAccount, isCdpConfigured } from '../lib/cdp'

async function main() {
  if (!isCdpConfigured()) {
    console.error('✗ CDP not configured (need CDP_API_KEY_ID/SECRET/WALLET_SECRET)')
    process.exit(1)
  }
  console.log('• provisioning CDP accounts on base-sepolia…')
  const smart = await getExpenseSmartAccount()
  const spender = await getSpenderAccount()
  console.log('  smart account (grantor):', smart.address)
  console.log('  spender:', spender.address)

  console.log('• creating Spend Permission ($5/day cap → allowance 5_000_000)…')
  const created = await createGrantSpendPermission(
    { perDayUsd: 5, createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86_400_000) },
    'base-sepolia',
  )
  console.log('✓ created:', JSON.stringify(created, null, 2))
}

main().catch((e) => {
  console.error('✗ failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
