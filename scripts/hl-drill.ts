#!/usr/bin/env tsx
/**
 * The Hyperliquid Guardian LIVE fire drill — the whole "agent hands off to
 * agent" chain as one narrated command, run BY THE OWNER from a terminal:
 *
 *   1. NEAR Intents (our own free MCP): bridge USDC Base → Arbitrum, plus a
 *      small USDC → ETH leg for Arbitrum gas. One-time deposit addresses are
 *      guard-checked against the quote INSIDE the same response.
 *   2. Deposit USDC to Hyperliquid's Bridge2 on Arbitrum (address pinned in
 *      lib/hyperliquid-exec.ts from the official docs; ≥5 USDC enforced).
 *   3. Against PRODUCTION yeetful.com: SIWE as the burner, create the
 *      guardian delegation, sign approveAgent, activate.
 *   4. Open a small ETH long — built and guarded by lib/hyperliquid-exec,
 *      signed with the burner key (the master account).
 *   5. Arm a tight stop-loss via the prod API, then WATCH the prod cron
 *      close it autonomously. Receipts print as they land.
 *
 * Usage (from the website checkout, .env.local present):
 *   npx tsx scripts/hl-drill.ts            # dry-run: prints the plan + quotes, moves NOTHING
 *   npx tsx scripts/hl-drill.ts --live     # executes; each leg prints before it fires
 *   flags: --bridge-usd 25 --gas-usd 3 --position-usd 12 --stop-pct 0.1
 *          --skip-bridge (funds already on Arbitrum) --skip-deposit
 *          --base https://www.yeetful.com
 */
import fs from 'node:fs'
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, formatEther, formatUnits, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { arbitrum, base } from 'viem/chains'
import { ExchangeClient, HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import {
  buildHlOrderAction,
  guardHlExecBuild,
  HL_BRIDGE2_ARBITRUM,
  HL_MIN_DEPOSIT_USDC,
  ARBITRUM_USDC,
  type HlOrderIntent,
} from '../lib/hyperliquid-exec'

// ── args / env ──────────────────────────────────────────────────────────────
const arg = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const has = (name: string) => process.argv.includes(`--${name}`)
const LIVE = has('live')
const BRIDGE_USD = Number(arg('bridge-usd', '25'))
const GAS_USD = Number(arg('gas-usd', '3'))
const POSITION_USD = Number(arg('position-usd', '12'))
const STOP_PCT = Number(arg('stop-pct', '0.1'))
const PROD = arg('base', 'https://www.yeetful.com')
const MCP = 'https://near-intents.yeetful.com'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const pk = (env.PRIVATE_KEY.startsWith('0x') ? env.PRIVATE_KEY : `0x${env.PRIVATE_KEY}`) as `0x${string}`
const burner = privateKeyToAccount(pk)
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const

const say = (s: string) => console.log(`\n▸ ${s}`)
const die = (s: string): never => { console.error(`\n✖ ${s}`); process.exit(1) }

// ── MCP driver (streamable HTTP tools/call) ────────────────────────────────
async function mcpCall(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${MCP}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const text = await res.text()
  const line = text.includes('\ndata:') || text.startsWith('event:')
    ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop()!
    : text
  const rpc = JSON.parse(line)
  if (rpc.error) throw new Error(`MCP: ${JSON.stringify(rpc.error)}`)
  if (rpc.result?.isError) throw new Error(`MCP tool error: ${rpc.result.content?.[0]?.text?.slice(0, 300)}`)
  return rpc.result.content.map((c: { text?: string }) => c.text ?? '').join('\n')
}

// ── one bridge leg via our near-intents MCP, guard-checked ────────────────
async function bridgeLeg(label: string, destToken: string, amountUsd: number): Promise<void> {
  say(`${label}: quoting ${amountUsd} USDC (Base) → ${destToken} (Arbitrum) via near-intents.yeetful.com`)
  const raw = await mcpCall('build_swap', {
    originChain: 'base', originToken: 'USDC', destinationChain: 'arbitrum', destinationToken: destToken,
    amount: String(amountUsd), from: burner.address,
  })
  const built = JSON.parse(raw) as {
    quote: { receive: { estimated: string; minimum: string }; summary: string }
    deposit: { address: string; addressExpires: string }
    steps: { tx: { to: string; data: string; value: string; chainId: number } }[]
  }
  console.log(`  ${built.quote.summary}`)
  const tx = built.steps[0].tx
  // Guard: the calldata's transfer target must equal the quoted one-time
  // deposit address, token must be canonical Base USDC, amount exact.
  const target = `0x${tx.data.slice(34, 74)}`
  const atoms = BigInt(`0x${tx.data.slice(74)}`)
  if (tx.to.toLowerCase() !== BASE_USDC.toLowerCase()) die(`${label}: tx.to is not Base USDC`)
  if (target.toLowerCase() !== built.deposit.address.toLowerCase()) die(`${label}: calldata target ≠ quoted deposit address`)
  if (atoms !== parseUnits(amountUsd.toFixed(6), 6)) die(`${label}: calldata amount ≠ quoted amount`)
  if (tx.chainId !== 8453) die(`${label}: wrong chain`)
  console.log(`  guard ✓ exact ${amountUsd} USDC → one-time address ${built.deposit.address} (expires ${built.deposit.addressExpires})`)
  if (!LIVE) { console.log('  [dry-run] would sign & send, then await settlement'); return }

  const wallet = createWalletClient({ account: burner, chain: base, transport: http() })
  const pub = createPublicClient({ chain: base, transport: http() })
  const hash = await wallet.sendTransaction({ to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(0) })
  console.log(`  sent: https://basescan.org/tx/${hash}`)
  await pub.waitForTransactionReceipt({ hash })
  await mcpCall('submit_deposit_tx', { depositAddress: built.deposit.address, txHash: hash }).catch(() => {})
  for (let i = 0; i < 20; i++) {
    const status = await mcpCall('await_completion', { depositAddress: built.deposit.address }).catch((e) => String(e))
    if (/SUCCESS/.test(status)) { console.log(`  settled ✓`); return }
    if (/REFUNDED|FAILED/.test(status)) die(`${label}: swap ${status.slice(0, 200)}`)
    console.log('  …waiting for solver settlement')
  }
  die(`${label}: settlement not confirmed after ~15 min — check manually with check_status`)
}

// ── prod API helpers (SIWE as the burner) ──────────────────────────────────
async function prodSignIn(): Promise<string> {
  const nonceRes = await fetch(`${PROD}/api/auth/nonce`)
  const nonceCookie = (nonceRes.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_siwe_nonce=([^;]+)/)?.[1]).find(Boolean)
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({ address: burner.address, chainId: 8453, domain: new URL(PROD).host, nonce, uri: PROD, version: '1' })
  const signature = await burner.signMessage({ message })
  const res = await fetch(`${PROD}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: `yf_siwe_nonce=${nonceCookie}` } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const session = (res.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_session=([^;]+)/)?.[1]).find(Boolean)
  if (!session) die(`prod SIWE failed (${res.status}): ${await res.text()}`)
  return `yf_session=${session}`
}

async function main() {
  console.log(`Hyperliquid Guardian fire drill — ${LIVE ? '🔴 LIVE' : 'dry-run (nothing moves; pass --live to execute)'}`)
  console.log(`burner: ${burner.address}`)
  console.log(`plan: bridge $${BRIDGE_USD} USDC + $${GAS_USD}→ETH to Arbitrum → deposit to HL → SIWE+delegate on ${PROD} → long ~$${POSITION_USD} ETH → ${STOP_PCT}% stop → prod cron closes it`)

  const basePub = createPublicClient({ chain: base, transport: http() })
  const arbPub = createPublicClient({ chain: arbitrum, transport: http() })
  const baseUsdc = Number(formatUnits(await basePub.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [burner.address] }), 6))
  console.log(`balances: ${baseUsdc} USDC (Base)`)

  // 1+2 — bridge legs
  if (!has('skip-bridge')) {
    if (baseUsdc < BRIDGE_USD + GAS_USD) die(`need ${BRIDGE_USD + GAS_USD} USDC on Base, have ${baseUsdc}`)
    await bridgeLeg('leg 1', 'USDC', BRIDGE_USD)
    await bridgeLeg('leg 2 (gas)', 'ETH', GAS_USD)
  }

  // 3 — deposit to Bridge2
  let arbUsdc = Number(formatUnits(await arbPub.readContract({ address: ARBITRUM_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [burner.address] }), 6))
  let arbEth = Number(formatEther(await arbPub.getBalance({ address: burner.address })))
  if (!LIVE && !has('skip-bridge')) {
    // Dry-run: the bridge legs didn't actually land — project them so the
    // deposit leg's plan (and its refusals) reflect the live sequence.
    arbUsdc += BRIDGE_USD * 0.99
    arbEth += (GAS_USD / 3000) * 0.98
    console.log('  [dry-run] projecting post-bridge balances for the deposit plan')
  }
  say(`Arbitrum: ${arbUsdc.toFixed(4)} USDC, ${arbEth.toFixed(6)} ETH${LIVE ? '' : ' (projected)'}`)
  const info = new InfoClient({ transport: new HttpTransport() })
  if (!has('skip-deposit')) {
    const depositUsd = Math.floor(Math.min(arbUsdc - 0.1, BRIDGE_USD) * 100) / 100
    if (depositUsd < HL_MIN_DEPOSIT_USDC) die(`deposit ${depositUsd} < bridge minimum ${HL_MIN_DEPOSIT_USDC} USDC — DO NOT send (it would be lost)`)
    if (arbEth < 0.00002) die('no Arbitrum ETH for gas — rerun leg 2 or fund manually')
    say(`depositing ${depositUsd} USDC → Hyperliquid Bridge2 ${HL_BRIDGE2_ARBITRUM} (pinned from official docs; credits the sender <1 min)`)
    if (LIVE) {
      const wallet = createWalletClient({ account: burner, chain: arbitrum, transport: http() })
      const hash = await wallet.sendTransaction({
        to: ARBITRUM_USDC,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [HL_BRIDGE2_ARBITRUM as `0x${string}`, parseUnits(depositUsd.toFixed(6), 6)] }),
        value: BigInt(0),
      })
      console.log(`  sent: https://arbiscan.io/tx/${hash}`)
      await arbPub.waitForTransactionReceipt({ hash })
      for (let i = 0; i < 30; i++) {
        const st = await info.clearinghouseState({ user: burner.address })
        if (Number(st.withdrawable) > 0) { console.log(`  HL credited ✓ withdrawable $${st.withdrawable}`); break }
        await new Promise((r) => setTimeout(r, 10_000))
      }
    } else console.log('  [dry-run] would transfer + wait for HL credit')
  }

  // 4 — prod delegation
  say(`delegating on ${PROD} (SIWE as burner → approveAgent → active)`)
  if (!LIVE) { console.log('  [dry-run] stopping here — the rest needs the live account'); return }
  const cookie = await prodSignIn()
  const CJ = { 'content-type': 'application/json', cookie }
  const state = (await (await fetch(`${PROD}/api/guardian`, { headers: { cookie } })).json()) as { delegation?: { status: string } | null }
  if (state.delegation?.status !== 'active') {
    const created = (await (await fetch(`${PROD}/api/guardian/delegation`, { method: 'POST', headers: CJ, body: JSON.stringify({ signatureChainId: 8453 }) })).json()) as {
      id: string; agentAddress: string; typedData: { domain: object; types: object; primaryType: string; message: Record<string, unknown> }
    }
    if (!created.id) die(`delegation create failed: ${JSON.stringify(created)}`)
    console.log(`  agent address: ${created.agentAddress} (can trade, can NEVER withdraw — venue-enforced)`)
    const sig = await burner.signTypedData({ ...created.typedData, message: { ...created.typedData.message, nonce: BigInt(created.typedData.message.nonce as number) } } as Parameters<typeof burner.signTypedData>[0])
    const act = await fetch(`${PROD}/api/guardian/delegation`, { method: 'PATCH', headers: CJ, body: JSON.stringify({ id: created.id, signature: sig }) })
    if (!act.ok) die(`approveAgent rejected: ${await act.text()}`)
    console.log('  delegation ACTIVE ✓ (one signature — that was the whole custody handshake)')
  } else console.log('  delegation already active ✓')

  // 5 — open the position (master key, built + guarded by the exec layer)
  say(`opening ~$${POSITION_USD} ETH long (IOC, guarded by lib/hyperliquid-exec)`)
  const [meta, mids, chState] = await Promise.all([info.meta(), info.allMids(), info.clearinghouseState({ user: burner.address })])
  const ethIdx = meta.universe.findIndex((u) => u.name === 'ETH')
  const snap = { assetIndex: ethIdx, szDecimals: meta.universe[ethIdx].szDecimals, markPx: Number(mids.ETH), positionSzi: 0, maxLeverage: meta.universe[ethIdx].maxLeverage, accountLeverage: null }
  const intent: HlOrderIntent = { kind: 'open', coin: 'ETH', isBuy: true, notionalUsd: POSITION_USD }
  const action = buildHlOrderAction(intent, snap)
  const guard = guardHlExecBuild(intent, action, { markPx: snap.markPx, assetIndex: ethIdx, withdrawableUsd: Number(chState.withdrawable), positionSzi: 0 })
  if (!guard.ok) die(`exec guard refused: ${JSON.stringify(guard.checks.filter((c) => !c.ok))}`)
  console.log(`  guard ✓ (${guard.checks.length} checks) — ${action.orders[0].s} ETH @ ≤${action.orders[0].p}`)
  const exch = new ExchangeClient({ transport: new HttpTransport(), wallet: burner })
  const orderRes = await exch.order({ orders: action.orders, grouping: 'na' })
  const st = orderRes.response.data.statuses[0] as { filled?: { totalSz: string; avgPx: string } }
  const filled = st.filled
  if (!filled) return die(`order not filled: ${JSON.stringify(st)}`)
  console.log(`  filled ✓ ${filled.totalSz} ETH @ ${filled.avgPx}`)

  // 6 — arm the stop via prod, then watch the prod cron do its job
  say(`arming ${STOP_PCT}% stop-loss on ETH via ${PROD}`)
  const arm = await fetch(`${PROD}/api/guardian/policies`, { method: 'POST', headers: CJ, body: JSON.stringify({ coin: 'ETH', kind: 'stop_loss', triggerMode: 'price_move_pct', triggerValue: STOP_PCT }) })
  if (!arm.ok) die(`arming failed: ${await arm.text()}`)
  console.log('  armed ✓ — the PROD cron now owns this position. Watching…')
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 20_000))
    const s = (await (await fetch(`${PROD}/api/guardian`, { headers: { cookie } })).json()) as { runs: { action: string; reason: string; valueUsd: number | null; createdAt: string }[] }
    const closed = s.runs.find((r) => r.action === 'closed')
    if (closed) {
      console.log(`\n🏁 GUARDIAN CLOSED IT — ${closed.reason}`)
      console.log(`   money moved: $${closed.valueUsd} · receipt at ${PROD}/dashboard/guardian`)
      return
    }
    const latest = s.runs[0]
    console.log(`  …cron alive${latest ? ` (last: ${latest.action} @ ${latest.createdAt})` : ''} — ETH hasn't moved ${STOP_PCT}% yet`)
  }
  console.log('watch window ended (40 min) — the stop stays armed; check /dashboard/guardian anytime.')
}

main().catch((e) => die(e instanceof Error ? e.stack ?? e.message : String(e)))
