// THE POLICY POOL — the demo runner (BUILDER lane, squad 2026-11-02).
// Scenes 2–4 of /Users/nate/pantessa/squad-policy-pool-2026-11-02/README.md,
// against the pool the env pins (POLICY_POOL_* — Base Sepolia for the
// rehearsal). Every scene records its ledger row (lib/policy-pool/ledger).
//
//   npm run demo:policy-pool                       all scenes, reverts SIMULATED (eth_call), nothing broadcast
//   npm run demo:policy-pool -- --scene=2 --send   broadcast the plain wallet's swap and show the on-chain revert
//   npm run demo:policy-pool -- --scene=3 --usd=25 the attested swap, signed by the agent wallet (PRIVATE_KEY), Sepolia only
//   npm run demo:policy-pool -- --scene=4 --send   the over-cap refusal + a forged attestation reverting BadSigner on-chain
//   --wallet-key=0x…   a funded throwaway key for the plain wallet (scene 2 --send needs gas); default = a fresh key, simulate only
//
// MONEY RULE (CLAUDE.md standing rule 4): this script REFUSES chain 8453
// unless I_HAVE_NATES_YES=1 is set by hand. The agent wallet (PRIVATE_KEY)
// is only ever used on Base Sepolia. Nothing here spends mainnet funds.
import fs from 'node:fs'
import path from 'node:path'
import { createWalletClient, fallback, formatUnits, http, parseEventLogs, type Address, type Chain, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

// The harness idiom: this process doesn't load .env.local on its own.
try {
  const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
} catch {
  /* no .env.local — the env must already carry POLICY_POOL_* */
}

import { BASE_SEPOLIA_CHAIN_ID } from '../lib/chains'
import { policyPoolClient, policyPoolConfig, policyPoolExplorerTx, type PolicyPoolConfig } from '../lib/policy-pool/config'
import { POLICY_POOL_HOOK_ABI, encodeHookData, type Attestation } from '../lib/policy-pool/spec'
import { attestationFor, signAttestation } from '../lib/policy-pool/attestation'
import { recordPolicyPoolEvent } from '../lib/policy-pool/ledger'
import { buildPolicyPoolSwap, encodeV4SwapCalldata, isPolicyPoolRefusal, policyPoolRevertName, type V4PoolKey } from '../lib/uniswap-v4'

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const flag = (name: string): boolean => process.argv.includes(`--${name}`)
const SCENE = arg('scene') ?? 'all'
const USD = Number(arg('usd') ?? '25')
const SEND = flag('send')

const log = (s: string) => console.log(s)
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`

function refuseMainnet(cfg: PolicyPoolConfig): void {
  if (cfg.chainId === 8453 && process.env.I_HAVE_NATES_YES !== '1') {
    log('🚫 The policy pool env points at Base MAINNET (8453). This runner spends nothing there without Nate\'s explicit yes — set I_HAVE_NATES_YES=1 by hand to proceed. Exiting.')
    process.exit(2)
  }
}

function sepoliaTransport() {
  const key = process.env.ALCHEMY_API_KEY
  const primary = key ? [http('https://base-sepolia.g.alchemy.com/v2/', { fetchOptions: { headers: { Authorization: `Bearer ${key}` } } })] : []
  return primary.length ? fallback([...primary, http()]) : http()
}

/** A wallet client for a key on the pool's chain — Sepolia only; mainnet needs the gate above AND a chain object we don't ship here on purpose. */
function walletFor(key: Hex, cfg: PolicyPoolConfig) {
  if (cfg.chainId !== BASE_SEPOLIA_CHAIN_ID) throw new Error(`This runner signs only on Base Sepolia (84532); the env pins chain ${cfg.chainId}.`)
  return createWalletClient({ account: privateKeyToAccount(key), chain: baseSepolia as Chain, transport: sepoliaTransport() })
}

/** Sign an attestation as an arbitrary key through the README contract (env key), restoring the env after. */
async function signAs(key: Hex, att: Attestation, cfg: PolicyPoolConfig): Promise<Hex> {
  const prior = process.env.POLICY_SIGNER_PRIVATE_KEY
  process.env.POLICY_SIGNER_PRIVATE_KEY = key
  try {
    return await signAttestation(att, { chainId: cfg.chainId, hook: cfg.hook })
  } finally {
    if (prior === undefined) delete process.env.POLICY_SIGNER_PRIVATE_KEY
    else process.env.POLICY_SIGNER_PRIVATE_KEY = prior
  }
}

/** Simulate `data` from `from` against the router; the hook's revert by name, or 'passed' / the raw first line. */
async function simulateSwap(cfg: PolicyPoolConfig, from: Address, data: Hex): Promise<{ revert: string | null; detail: string }> {
  const client = policyPoolClient(cfg.chainId)!
  try {
    await client.call({ account: from, to: cfg.pins.universalRouter, data })
    return { revert: null, detail: 'the call PASSED in simulation' }
  } catch (err) {
    const name = policyPoolRevertName(err)
    return { revert: name, detail: name ? `reverted ${name}()` : (err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err)) }
  }
}

/** Broadcast a swap we EXPECT to revert (gas fixed, no estimate) and read the receipt. */
async function sendExpectingRevert(cfg: PolicyPoolConfig, key: Hex, data: Hex): Promise<{ txHash: Hex; status: string; blockNumber: number }> {
  const wallet = walletFor(key, cfg)
  const client = policyPoolClient(cfg.chainId)!
  const txHash = await wallet.sendTransaction({ to: cfg.pins.universalRouter, data, value: BigInt(0), gas: BigInt(400_000) })
  const receipt = await client.waitForTransactionReceipt({ hash: txHash })
  return { txHash, status: receipt.status, blockNumber: Number(receipt.blockNumber) }
}

const oneUsdc = BigInt(1_000_000)

// ── Scene 2: a plain wallet, no attestation ───────────────────────────────
async function scenePlainWallet(cfg: PolicyPoolConfig): Promise<boolean> {
  log('\n── Scene 2 · a plain wallet swaps into the pool with EMPTY hookData ──')
  const key = (arg('wallet-key') as Hex | undefined) ?? generatePrivateKey()
  const plain = privateKeyToAccount(key).address
  const poolKey: V4PoolKey = { ...cfg.poolKey }
  const deadline = Math.floor(Date.now() / 1000) + 600
  const data = encodeV4SwapCalldata({ poolKey, zeroForOne: false, amountIn: oneUsdc, minOut: BigInt(1), deadline, feeBps: 0 })
  log(`   wallet ${short(plain)} (${arg('wallet-key') ? 'supplied' : 'fresh throwaway'}) · 1 USDC → ETH · hookData 0x`)
  const sim = await simulateSwap(cfg, plain, data)
  log(`   simulation: ${sim.detail}`)
  let onchain: { txHash: Hex; status: string; blockNumber: number } | null = null
  if (SEND) {
    if (!arg('wallet-key')) log('   --send needs --wallet-key=<funded throwaway> (a fresh key has no gas) — broadcasting skipped.')
    else {
      onchain = await sendExpectingRevert(cfg, key, data)
      log(`   on-chain: ${onchain.status} · ${policyPoolExplorerTx(cfg.chainId)}${onchain.txHash} · block ${onchain.blockNumber}`)
    }
  }
  await recordPolicyPoolEvent({
    kind: 'onchain_revert',
    intentId: 'demo-plain-wallet',
    origin: 'demo:plain-wallet',
    swapper: plain.toLowerCase(),
    chainId: cfg.chainId,
    amountIn: oneUsdc.toString(),
    usd: 1,
    reason: sim.revert ? `${sim.revert}()` : sim.detail,
    ...(onchain ? { txHash: onchain.txHash, blockNumber: onchain.blockNumber } : {}),
    meta: { scene: 2, simulated: !onchain, revert: sim.revert, currencyIn: cfg.poolKey.currency1, currencyOut: cfg.poolKey.currency0 },
  })
  const ok = sim.revert === 'NotAttested' && (!onchain || onchain.status === 'reverted')
  log(ok ? '   ✅ the hook refused the plain wallet: NotAttested' : `   ❌ expected NotAttested, saw ${sim.revert ?? sim.detail}`)
  return ok
}

// ── Scene 3: the attested swap, signed by the agent wallet ───────────────
async function sceneAttested(cfg: PolicyPoolConfig): Promise<boolean> {
  log(`\n── Scene 3 · "Buy $${USD} of ETH through the policy pool" — attested, signed by the agent wallet ──`)
  const key = process.env.PRIVATE_KEY as Hex | undefined
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    log('   ❌ PRIVATE_KEY (the agent wallet) is not set — nothing to sign with.')
    return false
  }
  if (cfg.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    log(`   ❌ the agent wallet signs only on Base Sepolia; the env pins chain ${cfg.chainId}.`)
    return false
  }
  const wallet = walletFor(key, cfg)
  const agent = wallet.account.address
  const client = policyPoolClient(cfg.chainId)!
  const intentId = `demo-${Date.now().toString(36)}`
  log(`   agent wallet ${short(agent)} · intent ${intentId} · origin demo:attested`)
  const built = await buildPolicyPoolSwap({ sellToken: 'USDC', buyToken: 'ETH', amountHuman: String(USD), from: agent, chainId: cfg.chainId, intentId, origin: 'demo:attested', swapper: agent })
  if (isPolicyPoolRefusal(built)) {
    log(`   ❌ refused (${built.kind}): ${built.reason}`)
    return false
  }
  log(`   built: ${built.summary}`)
  for (const c of built.guardrails.checks) log(`   ${c.ok ? '·' : '✗'} ${c.id}: ${c.note.slice(0, 160)}`)
  if (built.blocked) {
    log('   ❌ the guard withheld the artifact — nothing signed.')
    return false
  }
  let swapHash: Hex | null = null
  let fill: { amount0: bigint; amount1: bigint; origin: string; intentId: Hex } | null = null
  for (const step of built.steps) {
    const txHash = await wallet.sendTransaction({ to: step.tx.to as Address, data: step.tx.data as Hex, value: BigInt(step.tx.value || '0') })
    log(`   ${step.label}: sent ${policyPoolExplorerTx(cfg.chainId)}${txHash}`)
    if (step.label === 'swap') {
      swapHash = txHash
      await recordPolicyPoolEvent({ kind: 'signed', intentId, origin: 'demo:attested', swapper: agent.toLowerCase(), chainId: cfg.chainId, amountIn: built.attestation.maxAmountIn, usd: built.usd, txHash, meta: { scene: 3, currencyIn: cfg.poolKey.currency1, currencyOut: cfg.poolKey.currency0 } })
    }
    const receipt = await client.waitForTransactionReceipt({ hash: txHash })
    log(`   ${step.label}: ${receipt.status} in block ${receipt.blockNumber}`)
    if (receipt.status !== 'success') {
      log(`   ❌ ${step.label} reverted on-chain.`)
      return false
    }
    if (step.label === 'swap') {
      await recordPolicyPoolEvent({ kind: 'mined', intentId, origin: 'demo:attested', swapper: agent.toLowerCase(), chainId: cfg.chainId, amountIn: built.attestation.maxAmountIn, usd: built.usd, txHash, blockNumber: Number(receipt.blockNumber), meta: { scene: 3, currencyIn: cfg.poolKey.currency1, currencyOut: cfg.poolKey.currency0 } })
      const logs = parseEventLogs({ abi: POLICY_POOL_HOOK_ABI, logs: receipt.logs, eventName: 'DeskFill' })
      const f = logs[0]
      if (f) {
        fill = { amount0: f.args.amount0, amount1: f.args.amount1, origin: f.args.origin, intentId: f.args.intentId }
        log(`   DeskFill: intent ${short(f.args.intentId)} · swapper ${short(f.args.swapper)} · amount0 ${formatUnits(f.args.amount0, 18)} ETH · amount1 ${formatUnits(f.args.amount1, 6)} USDC · origin "${f.args.origin}"`)
        await recordPolicyPoolEvent({ kind: 'fill', intentId, origin: f.args.origin, swapper: f.args.swapper.toLowerCase(), chainId: cfg.chainId, amountIn: (f.args.amount1 < BigInt(0) ? -f.args.amount1 : f.args.amount1).toString(), amountOut: (f.args.amount0 < BigInt(0) ? -f.args.amount0 : f.args.amount0).toString(), usd: built.usd, txHash, blockNumber: Number(receipt.blockNumber), meta: { scene: 3, poolId: f.args.poolId, zeroForOne: f.args.zeroForOne, currencyIn: cfg.poolKey.currency1, currencyOut: cfg.poolKey.currency0 } })
      } else log('   ⚠️ no DeskFill log in the swap receipt')
    }
  }
  const ok = !!swapHash && !!fill && fill.intentId.toLowerCase() === built.attestation.intentId.toLowerCase() && fill.origin === 'demo:attested'
  log(ok ? '   ✅ the attested swap filled and DeskFill named the intent and its origin' : '   ❌ the swap did not produce the expected DeskFill')
  return ok
}

// ── Scene 4: over the cap, and a forged attestation ─────────────────────
async function sceneOverCapAndForged(cfg: PolicyPoolConfig): Promise<boolean> {
  log(`\n── Scene 4a · the same ask at $${cfg.maxUsd + 1} against the $${cfg.maxUsd} cap ──`)
  const agentKey = process.env.PRIVATE_KEY as Hex | undefined
  const swapper = agentKey && /^0x[0-9a-fA-F]{64}$/.test(agentKey) ? privateKeyToAccount(agentKey).address : privateKeyToAccount(generatePrivateKey()).address
  const over = await buildPolicyPoolSwap({ sellToken: 'USDC', buyToken: 'ETH', amountHuman: String(cfg.maxUsd + 1), from: swapper, chainId: cfg.chainId, intentId: `demo-overcap-${Date.now().toString(36)}`, origin: 'demo:over-cap', swapper })
  const overOk = isPolicyPoolRefusal(over) && over.kind === 'policy'
  log(overOk ? `   ✅ refused before anything was built: ${(over as { reason: string }).reason}` : '   ❌ expected a policy refusal')

  log('\n── Scene 4b · a hand-forged attestation (random signer) ──')
  const forger = generatePrivateKey()
  const att = attestationFor({ intentId: `demo-forged-${Date.now().toString(36)}`, poolId: cfg.poolId, swapper, zeroForOne: false, maxAmountIn: oneUsdc, origin: 'demo:forged' })
  const sig = await signAs(forger, att, cfg)
  const hookData = encodeHookData(att, sig)
  const deadline = Math.floor(Date.now() / 1000) + 600
  const data = encodeV4SwapCalldata({ poolKey: { ...cfg.poolKey }, zeroForOne: false, amountIn: oneUsdc, minOut: BigInt(1), deadline, feeBps: 0, hookData })
  log(`   forged by ${short(privateKeyToAccount(forger).address)} (the hook trusts ${short(cfg.signer)}) · swapper ${short(swapper)} · 1 USDC → ETH`)
  const sim = await simulateSwap(cfg, swapper, data)
  log(`   simulation: ${sim.detail}`)
  let onchain: { txHash: Hex; status: string; blockNumber: number } | null = null
  if (SEND && agentKey && cfg.chainId === BASE_SEPOLIA_CHAIN_ID) {
    onchain = await sendExpectingRevert(cfg, agentKey, data)
    log(`   on-chain: ${onchain.status} · ${policyPoolExplorerTx(cfg.chainId)}${onchain.txHash} · block ${onchain.blockNumber}`)
  } else if (SEND) log('   --send skipped: needs PRIVATE_KEY on Base Sepolia.')
  await recordPolicyPoolEvent({
    kind: 'onchain_revert',
    intentId: 'demo-forged',
    origin: 'demo:forged',
    swapper: swapper.toLowerCase(),
    chainId: cfg.chainId,
    amountIn: oneUsdc.toString(),
    usd: 1,
    reason: sim.revert ? `${sim.revert}()` : sim.detail,
    ...(onchain ? { txHash: onchain.txHash, blockNumber: onchain.blockNumber } : {}),
    meta: { scene: 4, simulated: !onchain, revert: sim.revert, forger: privateKeyToAccount(forger).address, currencyIn: cfg.poolKey.currency1, currencyOut: cfg.poolKey.currency0 },
  })
  const forgedOk = sim.revert === 'BadSigner' && (!onchain || onchain.status === 'reverted')
  log(forgedOk ? '   ✅ the hook refused the forged attestation: BadSigner' : `   ❌ expected BadSigner, saw ${sim.revert ?? sim.detail}`)
  return overOk && forgedOk
}

async function main() {
  const cfg = policyPoolConfig()
  if (!cfg) {
    log('The policy pool is not deployed yet (POLICY_POOL_HOOK is unset) — nothing to demo. Set the POLICY_POOL_* env from the HOOK lane\'s deployment first.')
    process.exit(1)
  }
  refuseMainnet(cfg)
  log(`THE POLICY POOL · ${cfg.chainName} (${cfg.chainId}) · hook ${cfg.hook} · signer ${cfg.signer} · cap $${cfg.maxUsd} · pool ${short(cfg.poolId)}`)
  log(`router ${cfg.pins.universalRouter} · quoter ${cfg.pins.quoter} · ${SEND ? 'BROADCASTING reverts' : 'reverts simulated (add --send to broadcast)'}`)
  const results: Record<string, boolean> = {}
  if (SCENE === 'all' || SCENE === '2') results['2 plain wallet → NotAttested'] = await scenePlainWallet(cfg)
  if (SCENE === 'all' || SCENE === '3') results['3 attested swap → DeskFill'] = await sceneAttested(cfg)
  if (SCENE === 'all' || SCENE === '4') results['4 over-cap refused + forged → BadSigner'] = await sceneOverCapAndForged(cfg)
  log('\n── Scenes ──')
  for (const [k, v] of Object.entries(results)) log(`${v ? '✅' : '❌'} ${k}`)
  process.exit(Object.values(results).every(Boolean) ? 0 : 1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
