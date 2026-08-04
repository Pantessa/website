// ─────────────────────────────────────────────────────────────────────────
//  Live LiFi venue smoke — READ-ONLY. Quotes 1 USDG → AAPL on Robinhood
//  Chain (4663) through the real builder (li.quest HTTP + on-chain reads +
//  estimateGas simulation) and asserts the guard accepts the live quote and
//  the 0.20% Pantessa fee rides as its own decodable transfer step. Nothing
//  is signed, nothing is sent, nothing is spent.
//
//  Run: npx tsx scripts/smoke-lifi.ts   (needs network; LIFI_API_KEY optional)
//  Kept OUT of test:api on purpose — it leans on a third-party API + live
//  RPC and would make the standing harness flaky.
// ─────────────────────────────────────────────────────────────────────────
import { decodeFunctionData, erc20Abi } from 'viem'
import { buildLifiSwap, lifiRoutersFor } from '../lib/lifi-venue'
import { TREASURY_ADDRESS, swapFeeAtoms } from '../lib/fees'
import { ensureTokenList } from '../lib/token-list'

async function main() {
  // A real funded mainnet address (vitalik.eth) — used ONLY as `from` for
  // read-only quoting / allowance / simulation context.
  const from = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
  await ensureTokenList(4663) // AAPL/TSLA/… resolve via the official Uniswap list (same as the chat entry points)
  const built = await buildLifiSwap({ sellToken: 'USDG', buyToken: 'AAPL', amountHuman: '1', from, chainId: 4663 })

  console.log('summary:', built.summary)
  console.log('tool:', built.tool, '| blocked:', built.blocked, '| feeHuman:', built.feeHuman, '| minOut:', built.minimumOut)
  for (const s of built.steps) console.log(`  step ${s.label} → ${s.tx.to}${s.validUntil ? ` (validUntil ${s.validUntil})` : ''}`)
  for (const c of built.guardrails.checks) console.log(`  [${c.level}] ${c.id}: ${c.ok ? 'ok' : 'FAIL'} — ${c.note}`)
  console.log('valueUsd:', built.guardrails.valueUsd)

  const fails: string[] = []
  if (built.blocked) fails.push('guard BLOCKED the live quote')
  const feeStep = built.steps.find((s) => s.label === 'fee')
  const expectedFee = swapFeeAtoms(BigInt(1_000_000)) // 0.20% of 1 USDG (6 dec)
  if (!feeStep) fails.push('no fee step attached')
  else {
    const dec = decodeFunctionData({ abi: erc20Abi, data: feeStep.tx.data as `0x${string}` })
    const [to, amount] = dec.args as [string, bigint]
    if (dec.functionName !== 'transfer' || to.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) fails.push('fee step is not a transfer to the treasury')
    if (amount !== expectedFee) fails.push(`fee amount ${amount} != ${expectedFee} atoms`)
  }
  const swapStep = built.steps.find((s) => s.label === 'swap')
  const routers = lifiRoutersFor(4663).map((r) => r.toLowerCase())
  if (!swapStep) fails.push('no swap step')
  else if (!routers.includes(swapStep.tx.to.toLowerCase())) fails.push(`swap targets ${swapStep.tx.to} — not on the pinned allowlist`)
  if (!swapStep?.validUntil) fails.push('swap step carries no validUntil (deadline-watch coverage missing)')

  if (fails.length) {
    console.error('\nSMOKE FAILED:\n - ' + fails.join('\n - '))
    process.exit(1)
  }
  console.log('\nSMOKE PASSED: pinned router, guard-accepted live quote, 0.20% fee visible as its own transfer step.')
}

main().catch((e) => {
  console.error('SMOKE ERROR:', e instanceof Error ? e.message : e)
  process.exit(1)
})
