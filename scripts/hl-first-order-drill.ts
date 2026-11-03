// THE FIRST-ORDER DRILL (squad five-million, lane PERPS, 2026-11-03) — the
// first-time Hyperliquid path, as the product walks it, against HL TESTNET
// with the .env.local burner, recording the venue's EXACT words at each step.
// Nothing is funded; nothing moves on mainnet.
//
//   (a) the deposit sentence — what the product says to "Long $25 of ETH on
//       Hyperliquid" from an account with no collateral (the LOCAL chat
//       route, a dry run: it builds, it never signs) and what the deposit
//       layer builds for "Deposit 25 USDC to Hyperliquid";
//   (b) the builder-fee approval — approveBuilderFeeArtifacts → the burner
//       signs → the LOCAL relay /api/hl/submit (isTestnet) → the venue's
//       answer, then the venue's maxBuilderFee read-back;
//   (c) one $25 order carrying the builder field — the guarded build against
//       the live testnet snapshot, then the relay (or, when the guard refuses
//       locally, the signed action straight at the testnet venue so its own
//       refusal is on record).
//
// The log is the deliverable: PERPS.md § "The first-order drill". The owner
// step it exists for: fund ≥100 USDC of perps account value at the treasury
// (0x9Cc0B7A0DdB091E17647d689206e730131E9892A) on mainnet, then re-run.
//
//   npx tsx scripts/hl-first-order-drill.ts --base http://localhost:4441 [--coin ETH] [--usd 25]
import { config } from 'dotenv'
config({ path: '.env.local' })
import { privateKeyToAccount } from 'viem/accounts'

const arg = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const BASE = arg('base', process.env.BASE ?? 'http://localhost:3000')
const COIN = arg('coin', 'ETH').toUpperCase()
const USD = Number(arg('usd', '25'))
const TESTNET_INFO = 'https://api.hyperliquid-testnet.xyz/info'
const TESTNET_EXCHANGE = 'https://api.hyperliquid-testnet.xyz/exchange'

const log: string[] = []
const say = (line: string) => {
  console.log(line)
  log.push(line)
}
const words = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 600)

async function info(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(TESTNET_INFO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return res.json().catch(() => null)
}

async function main() {
  const H = await import('../lib/hyperliquid-exec')
  const F = await import('../lib/fees')
  const { splitSignature } = await import('../lib/hl-guardian')
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY missing from .env.local')
  const burner = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
  say(`# HL first-order drill — ${new Date().toISOString()}`)
  say(`burner ${burner.address} · venue TESTNET · treasury ${F.TREASURY_ADDRESS} · builder fee ${F.HL_BUILDER_MAX_FEE_RATE} (f=${F.HL_BUILDER_FEE_TENTH_BPS}) · relay ${BASE}`)

  // ── the venue's view of both accounts before anything ────────────────────
  const treasury = (await info({ type: 'clearinghouseState', user: F.TREASURY_ADDRESS.toLowerCase() })) as { marginSummary?: { accountValue?: string } } | null
  const mine = (await info({ type: 'clearinghouseState', user: burner.address })) as { marginSummary?: { accountValue?: string }; withdrawable?: string } | null
  say(`venue read: treasury testnet accountValue = $${treasury?.marginSummary?.accountValue ?? '?'} (builder floor $${H.HL_BUILDER_MIN_ACCOUNT_USD} → eligible: ${H.builderEligibleFromAccountValue(Number(treasury?.marginSummary?.accountValue))}); burner testnet accountValue = $${mine?.marginSummary?.accountValue ?? '?'}, withdrawable $${mine?.withdrawable ?? '?'}`)
  const mainTreasury = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'clearinghouseState', user: F.TREASURY_ADDRESS.toLowerCase() }) }).then((r) => r.json()).catch(() => null) as { marginSummary?: { accountValue?: string } } | null
  say(`venue read: treasury MAINNET accountValue = $${mainTreasury?.marginSummary?.accountValue ?? '?'} (read-only; the owner step is to make this ≥ $${H.HL_BUILDER_MIN_ACCOUNT_USD})`)

  // ── (a) the deposit sentence, as the product says it ──────────────────────
  say('')
  say(`## (a) the deposit sentence`)
  const ask = `Long $${USD} of ${COIN} on Hyperliquid`
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' },
      body: JSON.stringify({ message: ask, walletAddress: burner.address, activeServers: [], history: [] }),
    })
    const j = (await res.json().catch(() => ({}))) as { reply?: string; buildPath?: string; jobId?: string; orderRequest?: unknown; clarify?: unknown; chips?: unknown }
    say(`chat "${ask}" (mainnet snapshot, dry run) → HTTP ${res.status} · buildPath ${j.buildPath ?? '-'} · ${j.jobId ? `job ${j.jobId}` : j.orderRequest ? 'an order artifact' : j.clarify ? 'a clarify' : 'words only'}`)
    say(`product says: ${words(j.reply ?? '(no reply)')}`)
  } catch (e) {
    say(`chat route unreachable at ${BASE}: ${(e as Error).message}`)
  }
  const depositIntent = H.parseHlIntent(`Deposit ${USD} USDC to Hyperliquid`)
  if (depositIntent?.kind === 'deposit') {
    const bal = await H.arbitrumUsdcBalance(burner.address).catch(() => -1)
    const built = H.buildHlDeposit(depositIntent, Math.max(0, bal))
    say(`deposit layer: "Deposit ${USD} USDC to Hyperliquid" → Arbitrum USDC balance ${bal < 0 ? 'unreadable' : bal} → ${built.guardrails.ok ? 'BUILDS' : 'REFUSES'}: ${built.guardrails.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.note}`).join(' · ')}`)
    say(`deposit layer summary: ${built.summary} (to ${H.HL_BRIDGE2_ARBITRUM}; NOT sent)`)
  }

  // ── (b) the builder-fee approval on testnet ──────────────────────────────
  say('')
  say(`## (b) the builder-fee approval (testnet)`)
  const before = await info({ type: 'maxBuilderFee', user: burner.address, builder: F.TREASURY_ADDRESS.toLowerCase() })
  say(`venue maxBuilderFee before: ${words(before)}`)
  const { action: fa, typedData: ftd } = H.approveBuilderFeeArtifacts({ nonce: Date.now(), signatureChainId: 8453, isTestnet: true })
  const feeSig = await burner.signTypedData({
    domain: ftd.domain,
    types: ftd.types,
    primaryType: ftd.primaryType,
    message: { ...ftd.message, nonce: BigInt(fa.nonce) },
  } as Parameters<typeof burner.signTypedData>[0])
  const feeGuard = H.guardHlBuilderFeeApproval(fa, true)
  say(`guard (lib/hyperliquid-exec guardHlBuilderFeeApproval): ${feeGuard.ok ? 'ok' : 'REFUSED'} — ${feeGuard.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.note}`).join(' · ')}`)
  try {
    const res = await fetch(`${BASE}/api/hl/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1' },
      body: JSON.stringify({ action: fa, nonce: fa.nonce, signature: feeSig, from: burner.address, isTestnet: true }),
    })
    say(`relay /api/hl/submit (approveBuilderFee, isTestnet) → HTTP ${res.status}: ${words(await res.text())}`)
  } catch (e) {
    say(`relay unreachable at ${BASE}: ${(e as Error).message}`)
  }
  const after = await info({ type: 'maxBuilderFee', user: burner.address, builder: F.TREASURY_ADDRESS.toLowerCase() })
  say(`venue maxBuilderFee after: ${words(after)}`)

  // ── (c) one $25 order carrying the builder field ─────────────────────────
  say('')
  say(`## (c) one $${USD} ${COIN} order with the builder field (testnet)`)
  const intent: import('../lib/hyperliquid-exec').HlOrderIntent = { kind: 'open', coin: COIN, isBuy: true, notionalUsd: USD }
  let snap: Awaited<ReturnType<typeof H.fetchHlSnapshot>>
  try {
    snap = await H.fetchHlSnapshot(COIN, burner.address, true, true)
  } catch (e) {
    say(`testnet snapshot failed: ${(e as Error).message}`)
    return finish()
  }
  say(`testnet snapshot: ${COIN} mark ${snap.markPx} · asset ${snap.assetIndex} · collateral to trade $${snap.withdrawableUsd} · approved builder cap ${snap.approvedBuilderFeeTenthBps ?? 'none'} (tenths of a bp)`)
  const action = H.buildHlOrderAction(intent, snap, { builderFee: true })
  say(`built action: ${JSON.stringify(action)}`)
  const guard = H.guardHlExecBuild(intent, action, { markPx: snap.markPx, assetIndex: snap.assetIndex, withdrawableUsd: snap.withdrawableUsd, positionSzi: snap.positionSzi })
  say(`guard (guardHlExecBuild): ${guard.ok ? 'ok' : 'REFUSED'} · value $${guard.valueUsd} — ${guard.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.note}`).join(' · ')}`)
  const nonce = Date.now()
  const typedData = H.hlActionTypedData(action, nonce, true)
  const sig = await burner.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  } as Parameters<typeof burner.signTypedData>[0])
  try {
    const res = await fetch(`${BASE}/api/hl/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1' },
      body: JSON.stringify({ action, nonce, signature: sig, from: burner.address, isTestnet: true, expected: { coin: COIN, kind: 'open', isBuy: true } }),
    })
    say(`relay /api/hl/submit (order, isTestnet) → HTTP ${res.status}: ${words(await res.text())}`)
  } catch (e) {
    say(`relay unreachable at ${BASE}: ${(e as Error).message}`)
  }
  // The venue's own words, whatever the relay said: the same signed bytes
  // straight at the testnet exchange (the relay re-guards before relaying, so
  // a locally refused build never reaches the venue through it).
  const direct = await fetch(TESTNET_EXCHANGE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature: splitSignature(sig) }),
  })
  say(`venue direct (testnet /exchange, same signed action) → HTTP ${direct.status}: ${words(await direct.text())}`)
  return finish()
}

function finish() {
  say('')
  say(`## owner step`)
  say(`Fund ≥ $${100} USDC of perps account value at the treasury ${'0x9Cc0B7A0DdB091E17647d689206e730131E9892A'} on MAINNET (deposit USDC to Hyperliquid from that wallet), then: npx tsx scripts/fee-approval-drill.ts <base> and re-run this drill. Until then every perp order builds WITHOUT the builder field (lib/hyperliquid-exec builderFeeEligible → false) and the venue collects nothing for referrers.`)
  console.log('\n--- log (paste into PERPS.md) ---\n' + log.join('\n'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
