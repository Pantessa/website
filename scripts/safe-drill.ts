// scripts/safe-drill.ts — THE SAFE DRILL (CUSTODY lane, squad five-million 2026-11-03).
//
// An institution signs with its custody, not a browser wallet. This drill
// asks the plain question on Base Sepolia, with the log as the answer a
// prospect can read: can a Safe sign through the Pantessa desk today?
//
// Three rungs, each logged, each stopping honestly where it stops:
//   1. THE SAFE      — a 1-of-1 Safe the burner owns (found via the Safe
//                      Transaction Service, or deployed: SafeProxyFactory
//                      v1.4.1 + SafeL2 singleton, bytecode verified first).
//   2. THE IDENTITY  — the LOCAL desk asked to compile an intent OWNED BY THE
//                      SAFE: `openAndExecute` with `safeSigner` (the SDK's own
//                      refusal), then `broker_open` for the Safe + `broker_execute`
//                      with the OWNER's personal_sign consent — the desk's exact
//                      words. The prime-broker plan §5 predicts this block.
//   3. THE MONEY     — a BURNER-owned desk job ("Buy $1 of ETH through the policy
//                      pool") driven with `driveJob` + `safeSigner`: every EVM leg
//                      executes THROUGH the Safe (the attestation binds the
//                      burner as tx.origin; the burner executes the Safe tx, so
//                      the hook is satisfied and the Safe is msg.sender). The
//                      Safe is funded with $1.10 USDC from the burner first.
//
//   BASE=http://localhost:4450 npx tsx scripts/safe-drill.ts            # all three rungs
//   … --rung=safe | --rung=identity | --rung=money                     # one rung
//   … --safe=0x…                                                       # reuse a Safe
//   … --usd=1                                                          # the pool ask's size
//   SDK_DIR=../sdk-five-million                                         # the built `pantessa` SDK (dist/)
//
// MONEY RULE (CLAUDE.md rule 4): Base Sepolia (84532) ONLY. The script refuses
// any other chain by name and never reads a mainnet RPC. The burner's
// PRIVATE_KEY (.env.local) is the Safe's single owner and the executor.
// Every desk call carries `x-yf-internal-run: 1` so nothing it mints reads as growth.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseEventLogs,
  type Address,
  type Chain,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

// The harness idiom: this process doesn't load .env.local on its own.
try {
  const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
} catch {
  /* no .env.local — the env must already carry PRIVATE_KEY */
}

import { POLICY_POOL_HOOK_ABI } from '../lib/policy-pool/spec'
import { policyPoolConfig } from '../lib/policy-pool/config'
import { buildPolicyPoolSwap, isPolicyPoolRefusal } from '../lib/uniswap-v4'

/* ── the SDK, from its built dist (never the main checkout) ───────────── */

interface SdkDesk {
  driveJob: (o: Record<string, unknown>) => Promise<{ status: string; legs: Array<{ seq: number; kind: string; summary: string; chainId: number | null; valueUsd: number | null }>; results: Array<{ seq: number; result: Record<string, unknown> }>; failReason?: string; withheld?: { seq: number; reason: string } }>
  openAndExecute: (o: Record<string, unknown>) => Promise<{ intentId: string; jobId: string; token: string; steps: Array<{ seq: number; kind: string; note: string }>; say: string }>
  deskCall: (base: string, name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<Record<string, unknown>>
  deskExecuteConsentMessage: (intentId: string, wallet: string, issuedAt: string) => string
  DeskError: new (...a: never[]) => Error & { code: string; status?: number; detail?: string }
}
interface SdkSafe {
  safeSigner: (o: Record<string, unknown>) => { address: Address; safeAddress: Address; supports: (k: string) => string | null; sendTransaction: (tx: { to: Address; data?: Hex; value?: string }, chainId: number) => Promise<Hex> }
  safeTxHash: (chainId: number, safe: Address, tx: Record<string, unknown>) => Hex
  SAFE_TX_SERVICE: Record<number, string>
}

const SDK_DIR = path.resolve(process.cwd(), process.env.SDK_DIR ?? '../sdk-five-million')
async function loadSdk(): Promise<{ desk: SdkDesk; safe: SdkSafe }> {
  const deskPath = path.join(SDK_DIR, 'dist/desk.js')
  const safePath = path.join(SDK_DIR, 'dist/safe.js')
  if (!fs.existsSync(deskPath) || !fs.existsSync(safePath)) {
    throw new Error(`The built SDK is not at ${SDK_DIR}/dist — run \`npm run build\` there (or set SDK_DIR).`)
  }
  const desk = (await import(pathToFileURL(deskPath).href)) as SdkDesk
  const safe = (await import(pathToFileURL(safePath).href)) as SdkSafe
  return { desk, safe }
}

/* ── constants (Base Sepolia only) ────────────────────────────────────── */

const CHAIN_ID = 84532
const BASE = (process.env.BASE ?? 'http://localhost:4450').replace(/\/$/, '')
const INTERNAL = { 'x-yf-internal-run': '1' }
const AGENT_KEY = process.env.AGENT_KEY_ID ?? 'custody-drill-key'
const AGENT = 'custody-drill'
const USDC: Address = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // Circle's USDC on Base Sepolia
// Safe v1.4.1 canonical deployments (safe-global/safe-deployments); bytecode is
// verified below before any of them is used, and the tx service lists the
// singleton as `1.4.1+L2`.
const SAFE_PROXY_FACTORY: Address = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67'
const SAFE_L2_SINGLETON: Address = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762'
const FALLBACK_HANDLER: Address = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99'
const ZERO: Address = '0x0000000000000000000000000000000000000000'

const FACTORY_ABI = [
  {
    type: 'function',
    name: 'createProxyWithNonce',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_singleton', type: 'address' },
      { name: 'initializer', type: 'bytes' },
      { name: 'saltNonce', type: 'uint256' },
    ],
    outputs: [{ name: 'proxy', type: 'address' }],
  },
  { type: 'event', name: 'ProxyCreation', inputs: [{ name: 'proxy', type: 'address', indexed: true }, { name: 'singleton', type: 'address', indexed: false }] },
] as const
const SAFE_SETUP_ABI = [
  {
    type: 'function',
    name: 'setup',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_owners', type: 'address[]' },
      { name: '_threshold', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'fallbackHandler', type: 'address' },
      { name: 'paymentToken', type: 'address' },
      { name: 'payment', type: 'uint256' },
      { name: 'paymentReceiver', type: 'address' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'getOwners', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] },
  { type: 'function', name: 'getThreshold', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'VERSION', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  {
    type: 'function',
    name: 'getTransactionHash',
    stateMutability: 'view',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: '_nonce', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
] as const

/* ── helpers ──────────────────────────────────────────────────────────── */

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const RUNG = arg('rung') ?? 'all'
const USD = arg('usd') ?? '1'
const lines: string[] = []
const log = (s = '') => {
  lines.push(s)
  console.log(s)
}
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`
const explorerTx = (h: string) => `https://sepolia.basescan.org/tx/${h}`
const explorerAddr = (a: string) => `https://sepolia.basescan.org/address/${a}`
const errWords = (e: unknown): string => {
  const x = e as { code?: string; status?: number; message?: string; shortMessage?: string }
  return `${x.code ? `[${x.code}${x.status ? ` ${x.status}` : ''}] ` : ''}${x.shortMessage ?? x.message ?? String(e)}`.replace(/\s+/g, ' ').slice(0, 600)
}
function stop(why: string): never {
  log(`\n**STOPPED:** ${why}`)
  process.exit(2)
}

/** Measure a candidate RPC before using it (never pin one blind). The
 *  Alchemy key, when present, rides in the URL the SDK's `http()` takes — it
 *  is never printed. publicnode is a TESTNET-only fallback, as the policy-pool
 *  squad measured (sepolia.base.org drops calls). */
async function pickRpc(): Promise<{ url: string; name: string }> {
  const key = process.env.ALCHEMY_API_KEY
  const candidates: Array<{ url: string; name: string }> = [
    ...(key ? [{ url: `https://base-sepolia.g.alchemy.com/v2/${key}`, name: 'alchemy base-sepolia' }] : []),
    { url: 'https://sepolia.base.org', name: 'sepolia.base.org' },
    { url: 'https://base-sepolia-rpc.publicnode.com', name: 'publicnode (testnet fallback)' },
  ]
  for (const c of candidates) {
    try {
      const pc = createPublicClient({ chain: baseSepolia as Chain, transport: http(c.url, { timeout: 8_000 }) })
      const t0 = Date.now()
      const n = await pc.getBlockNumber()
      log(`- RPC measured: ${c.name} answered block ${n} in ${Date.now() - t0}ms`)
      return c
    } catch (e) {
      log(`- RPC measured: ${c.name} FAILED (${errWords(e).slice(0, 120)})`)
    }
  }
  stop('no Base Sepolia RPC answered')
}

async function main() {
  log(`## The Safe drill — Base Sepolia (${new Date().toISOString()})`)
  log('')
  const key = process.env.PRIVATE_KEY as Hex | undefined
  if (!key) stop('PRIVATE_KEY (the burner) is not in .env.local')
  const owner = privateKeyToAccount(key)
  const rpc = await pickRpc()
  const chain = baseSepolia as Chain
  const pc = createPublicClient({ chain, transport: http(rpc.url) })
  const wc = createWalletClient({ account: owner, chain, transport: http(rpc.url) })
  const { desk, safe: sdkSafe } = await loadSdk()
  const service = sdkSafe.SAFE_TX_SERVICE[CHAIN_ID]!

  // Preconditions, in the log.
  const [ethBal, usdcBal] = await Promise.all([
    pc.getBalance({ address: owner.address }),
    pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] }),
  ])
  log(`- chain: Base Sepolia (${CHAIN_ID}) · desk: ${BASE} · SDK: ${SDK_DIR} · Safe service: ${service}`)
  log(`- the burner (owner + executor): ${owner.address} — ${formatEther(ethBal)} ETH · ${formatUnits(usdcBal, 6)} USDC`)
  const about = await fetch(`${service}/v1/about/`, { headers: { accept: 'application/json' } }).then((r) => r.json() as Promise<{ version?: string }>).catch(() => ({}) as { version?: string })
  log(`- Safe Transaction Service: ${about.version ? `v${about.version}` : 'unreachable'}`)
  const codes = await Promise.all([SAFE_PROXY_FACTORY, SAFE_L2_SINGLETON, FALLBACK_HANDLER].map(async (a) => [a, ((await pc.getCode({ address: a })) ?? '0x').length] as const))
  for (const [a, len] of codes) log(`- bytecode at ${short(a)}: ${len > 2 ? `${Math.floor((len - 2) / 2)} bytes` : 'NONE'}`)
  if (codes.some(([, len]) => len <= 2)) stop('a Safe v1.4.1 contract has no bytecode on Base Sepolia — look the addresses up again')
  if (ethBal < BigInt("300000000000000")) stop(`the burner holds ${formatEther(ethBal)} ETH on Base Sepolia — under the ~0.0003 ETH this drill needs for gas. Fund it from a faucet; nothing was sent.`)

  /* ── rung 1: the Safe ───────────────────────────────────────────────── */
  log('')
  log('### Rung 1 — the Safe')
  let safeAddress = arg('safe') as Address | undefined
  if (!safeAddress) {
    const owned = await fetch(`${service}/v1/owners/${owner.address}/safes/`, { headers: { accept: 'application/json' } })
      .then((r) => r.json() as Promise<{ safes?: string[] }>)
      .catch(() => ({ safes: [] as string[] }))
    log(`- the service lists ${owned.safes?.length ?? 0} Safe(s) owned by the burner${owned.safes?.length ? `: ${owned.safes.join(', ')}` : ''}`)
    for (const s of owned.safes ?? []) {
      const owners = await pc.readContract({ address: s as Address, abi: SAFE_SETUP_ABI, functionName: 'getOwners' }).catch(() => [] as readonly Address[])
      const threshold = await pc.readContract({ address: s as Address, abi: SAFE_SETUP_ABI, functionName: 'getThreshold' }).catch(() => BigInt(0))
      if (owners.length === 1 && owners[0]!.toLowerCase() === owner.address.toLowerCase() && threshold === BigInt(1)) {
        safeAddress = s as Address
        log(`- reusing the 1-of-1 Safe ${safeAddress}`)
        break
      }
    }
  }
  if (!safeAddress) {
    const initializer = encodeFunctionData({
      abi: SAFE_SETUP_ABI,
      functionName: 'setup',
      args: [[owner.address], BigInt(1), ZERO, '0x', FALLBACK_HANDLER, ZERO, BigInt(0), ZERO],
    })
    const saltNonce = BigInt(Date.now())
    const { result: predicted } = await pc.simulateContract({
      account: owner,
      address: SAFE_PROXY_FACTORY,
      abi: FACTORY_ABI,
      functionName: 'createProxyWithNonce',
      args: [SAFE_L2_SINGLETON, initializer, saltNonce],
    })
    log(`- deploying a 1-of-1 Safe (v1.4.1 L2 singleton ${short(SAFE_L2_SINGLETON)}, fallback handler ${short(FALLBACK_HANDLER)}, salt ${saltNonce}) → predicted ${predicted}`)
    const hash = await wc.writeContract({
      address: SAFE_PROXY_FACTORY,
      abi: FACTORY_ABI,
      functionName: 'createProxyWithNonce',
      args: [SAFE_L2_SINGLETON, initializer, saltNonce],
    })
    const receipt = await pc.waitForTransactionReceipt({ hash })
    const created = parseEventLogs({ abi: FACTORY_ABI, logs: receipt.logs, eventName: 'ProxyCreation' })[0]
    safeAddress = (created?.args.proxy ?? predicted) as Address
    log(`- deploy tx ${hash} → ${receipt.status} in block ${receipt.blockNumber} (${receipt.gasUsed} gas) — ${explorerTx(hash)}`)
    log(`- **Safe: ${safeAddress}** — ${explorerAddr(safeAddress)}`)
  }
  const [owners, threshold, version, nonce0] = await Promise.all([
    pc.readContract({ address: safeAddress, abi: SAFE_SETUP_ABI, functionName: 'getOwners' }),
    pc.readContract({ address: safeAddress, abi: SAFE_SETUP_ABI, functionName: 'getThreshold' }),
    pc.readContract({ address: safeAddress, abi: SAFE_SETUP_ABI, functionName: 'VERSION' }),
    pc.readContract({ address: safeAddress, abi: SAFE_SETUP_ABI, functionName: 'nonce' }),
  ])
  log(`- on-chain: version ${version} · owners [${owners.join(', ')}] · threshold ${threshold} · nonce ${nonce0}`)
  // The service must index the Safe before it accepts a proposal for it.
  const t0 = Date.now()
  let indexed = false
  for (let i = 0; i < 36 && !indexed; i++) {
    const r = await fetch(`${service}/v1/safes/${safeAddress}/`, { headers: { accept: 'application/json' } })
    if (r.status === 200) {
      const b = (await r.json()) as { nonce?: number; threshold?: number; version?: string }
      log(`- the Safe Transaction Service indexed it after ${Math.round((Date.now() - t0) / 1000)}s: nonce ${b.nonce} · threshold ${b.threshold} · version ${b.version}`)
      indexed = true
    } else await new Promise((r) => setTimeout(r, 5_000))
  }
  if (!indexed) log(`- the Safe Transaction Service has NOT indexed ${safeAddress} after ${Math.round((Date.now() - t0) / 1000)}s — proposals will be refused until it does (on-chain reads still work)`)

  // The hash vector: what the CONTRACT answers vs what the SDK computes, for the first leg shape.
  const sample = { to: owner.address, value: BigInt(0), data: '0x' as Hex, operation: 0, safeTxGas: BigInt(0), baseGas: BigInt(0), gasPrice: BigInt(0), gasToken: ZERO, refundReceiver: ZERO, nonce: nonce0 }
  const onChain = await pc.readContract({
    address: safeAddress,
    abi: SAFE_SETUP_ABI,
    functionName: 'getTransactionHash',
    args: [sample.to, sample.value, sample.data, sample.operation, sample.safeTxGas, sample.baseGas, sample.gasPrice, sample.gasToken, sample.refundReceiver, sample.nonce],
  })
  const sdkHash = sdkSafe.safeTxHash(CHAIN_ID, safeAddress, sample)
  log(`- hash vector (to=${short(owner.address)}, value 0, data 0x, nonce ${nonce0}): contract ${onChain} · SDK ${sdkHash} → ${onChain === sdkHash ? '**MATCH**' : '**MISMATCH**'}`)
  if (onChain !== sdkHash) stop('the SDK hashes a SafeTx differently from the Safe — fix safeTxHash before anything is signed')
  if (RUNG === 'safe') return

  const signerOpts = {
    safeAddress,
    chainId: CHAIN_ID,
    owner,
    rpc: rpc.url,
    headers: INTERNAL,
    origin: 'pantessa custody drill',
    onEvent: (e: Record<string, unknown>) => {
      const { kind, ...rest } = e
      const words = JSON.stringify(rest, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).slice(0, 300)
      log(`  - safe event \`${String(kind)}\`: ${words}`)
    },
  }

  /* ── rung 2: the identity probe ─────────────────────────────────────── */
  if (RUNG === 'all' || RUNG === 'identity') {
    log('')
    log('### Rung 2 — the identity probe (an intent OWNED BY THE SAFE)')
    const ask = `Buy $${USD} of ETH through the policy pool`
    // (a) the SDK's own door: openAndExecute with the Safe as the signer.
    try {
      await desk.openAndExecute({ base: BASE, ask, signer: sdkSafe.safeSigner(signerOpts), agentKey: AGENT_KEY, agent: AGENT, headers: INTERNAL })
      log('- (a) `openAndExecute(safeSigner)`: UNEXPECTEDLY succeeded')
    } catch (e) {
      log(`- (a) \`openAndExecute(safeSigner)\` refused in the SDK, before any consent: ${errWords(e)}`)
    }
    // (b) the desk itself: open for the Safe, then execute with the OWNER's consent.
    try {
      const open = await desk.deskCall(BASE, 'broker_open', { ask, wallet: safeAddress, agent: AGENT, agent_key: AGENT_KEY, venue: 'policy-pool' }, { headers: INTERNAL })
      const plan = (open.plan ?? {}) as { say?: string; quote?: { funding?: { verdict?: string; askUsd?: number; movableUsd?: number } }; options?: Array<{ id: string; label: string }> }
      log(`- (b) \`broker_open\` for the Safe → intent ${String(open.intentId)} · state ${String(open.state)} · funding ${plan.quote?.funding?.verdict ?? '?'} (movable $${plan.quote?.funding?.movableUsd ?? '?'} of $${plan.quote?.funding?.askUsd ?? '?'})${plan.options?.length ? ` · options ${plan.options.map((o) => o.id).join('/')}` : ''}`)
      if (plan.say) log(`  - the desk said: "${String(plan.say).slice(0, 240)}"`)
      const issuedAt = new Date().toISOString()
      const consent = desk.deskExecuteConsentMessage(String(open.intentId), safeAddress, issuedAt)
      const signature = await owner.signMessage({ message: consent })
      try {
        const exec = await desk.deskCall(BASE, 'broker_execute', { intent_id: open.intentId, issued_at: issuedAt, agent_key: AGENT_KEY, wallet_signature: signature }, { headers: INTERNAL })
        log(`- (b) \`broker_execute\` with the OWNER's signature over a consent naming the Safe: UNEXPECTEDLY accepted → job ${String(exec.jobId)}`)
      } catch (e) {
        log(`- (b) \`broker_execute\` with the OWNER's personal_sign over a consent naming the Safe — the desk's words: ${errWords(e)}`)
      }
    } catch (e) {
      log(`- (b) \`broker_open\` for the Safe refused: ${errWords(e)}`)
    }
    if (RUNG === 'identity') return
  }

  /* ── rung 3: the money — a burner-owned job executed THROUGH the Safe ── */
  log('')
  log('### Rung 3 — the money (a burner-owned job, every leg executed THROUGH the Safe)')
  const ask = `Buy $${USD} of ETH through the policy pool`
  // Fund the Safe: the job's legs pull the sell side from msg.sender (the Safe).
  const need = BigInt(Math.ceil(Number(USD) * 1.1 * 1e6))
  const safeUsdc = await pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [safeAddress] })
  if (safeUsdc < need) {
    if (usdcBal < need - safeUsdc) stop(`the burner holds ${formatUnits(usdcBal, 6)} USDC; the Safe needs ${formatUnits(need - safeUsdc, 6)} more. Nothing was sent.`)
    const h = await wc.writeContract({ address: USDC, abi: erc20Abi, functionName: 'transfer', args: [safeAddress, need - safeUsdc] })
    const r = await pc.waitForTransactionReceipt({ hash: h })
    log(`- funded the Safe with ${formatUnits(need - safeUsdc, 6)} USDC from the burner: ${h} → ${r.status} — ${explorerTx(h)}`)
  } else log(`- the Safe already holds ${formatUnits(safeUsdc, 6)} USDC`)

  // (a) The desk path, as the BURNER (the EOA the desk can prove), through the
  // venue. Logged either way: the policy pool is a HANDOFF venue today (the
  // jobs compiler claims no agent-signed job for it), and the log says so.
  let jobId = ''
  let token = ''
  try {
    const open = await desk.deskCall(BASE, 'broker_open', { ask, wallet: owner.address, agent: AGENT, agent_key: AGENT_KEY, venue: 'policy-pool' }, { headers: INTERNAL })
    const plan = (open.plan ?? {}) as { say?: string; quote?: { funding?: { verdict?: string; askUsd?: number; movableUsd?: number } } }
    log(`- (a) \`broker_open\` (burner) → intent ${String(open.intentId)} · funding ${plan.quote?.funding?.verdict ?? '?'} (movable $${plan.quote?.funding?.movableUsd ?? '?'} of $${plan.quote?.funding?.askUsd ?? '?'})`)
    const issuedAt = new Date().toISOString()
    const signature = await owner.signMessage({ message: desk.deskExecuteConsentMessage(String(open.intentId), owner.address, issuedAt) })
    const exec = await desk.deskCall(BASE, 'broker_execute', { intent_id: open.intentId, issued_at: issuedAt, agent_key: AGENT_KEY, wallet_signature: signature }, { headers: INTERNAL })
    jobId = String(exec.jobId)
    token = decodeURIComponent(/[?&]t=([^&]+)/.exec(String((exec.drive as { poll?: string })?.poll ?? ''))?.[1] ?? '')
    const steps = (exec.steps ?? []) as Array<{ seq: number; kind: string; note: string }>
    log(`- (a) \`broker_execute\` (burner) → job ${jobId} · ${steps.length} leg(s): ${steps.map((s) => `${s.seq}:${s.kind} ${s.note}`).join(' → ')}`)
  } catch (e) {
    log(`- (a) the desk path, as the burner: ${errWords(e)}`)
  }

  // (b) When the desk compiles no job for the pool ask, the leg comes from
  // the app's OWN policy-pool builder (the same guard-checked artifact the
  // handoff page signs), served to driveJob by a stub Jobs API in this
  // process — labelled as such. `from` = the Safe (msg.sender, holds the
  // USDC); `swapper` = the burner (tx.origin — it executes the Safe tx), so
  // the hook's attestation check is satisfied by a smart-account custody.
  let fetchForDrive: typeof fetch = globalThis.fetch.bind(globalThis)
  let stubbed = false
  if (!jobId) {
    const cfg = policyPoolConfig()
    if (!cfg || cfg.chainId !== CHAIN_ID) stop(`the policy pool env pins chain ${cfg?.chainId ?? 'none'}; this drill signs only on ${CHAIN_ID}`)
    const intentId = `custody-${Date.now().toString(36)}`
    const built = await buildPolicyPoolSwap({ sellToken: 'USDC', buyToken: 'ETH', amountHuman: USD, from: safeAddress, chainId: CHAIN_ID, intentId, origin: 'custody:drill', swapper: owner.address })
    if (isPolicyPoolRefusal(built)) stop(`(b) the policy-pool builder refused (${built.kind}): ${built.reason}`)
    log(`- (b) built by the app's policy-pool builder for the SAFE (swapper = the burner, tx.origin): "${built.summary.slice(0, 200)}"`)
    for (const c of built.guardrails.checks) log(`  - ${c.ok ? '·' : '✗'} ${c.id}: ${c.note.slice(0, 160)}`)
    if (built.blocked) stop('(b) the guard withheld the artifact — nothing signed')
    log(`  - attestation: intent ${built.attestation.deskIntentId} · swapper ${short(built.attestation.swapper)} · maxAmountIn ${built.attestation.maxAmountIn} · expiry ${new Date(built.attestation.expiry * 1000).toISOString()} · origin "${built.attestation.origin}"`)
    log(`  - ${built.steps.length} step(s): ${built.steps.map((s) => s.label).join(' → ')} — served to driveJob by a STUB Jobs API in this process (the desk compiles no agent-signed job for the pool today)`)
    stubbed = true
    jobId = 'stub_safe_drill'
    token = 'stub'
    const step = {
      seq: 0,
      kind: 'sign',
      status: 'offered',
      title: built.summary,
      builder: built.buildPath,
      valueUsd: built.usd,
      updatedAt: new Date().toISOString(),
      artifact: {
        txChain: {
          summary: built.summary,
          steps: built.steps.map((s) => ({ label: s.label, title: s.label, tx: { to: s.tx.to, data: s.tx.data, value: s.tx.value ?? '0', chainId: CHAIN_ID } })),
        },
        summary: built.summary,
      },
    }
    let completed = false
    const real = globalThis.fetch.bind(globalThis)
    fetchForDrive = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (!u.startsWith(BASE)) return real(url as string, init)
      const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
      if (u.includes('/complete')) {
        completed = true
        const body = init?.body ? (JSON.parse(String(init.body)) as { seq: number; result: Record<string, unknown> }) : null
        log(`- (b) the stub Jobs API accepted the completion of leg ${body?.seq}: ${JSON.stringify(body?.result).slice(0, 300)}`)
        return json({ ok: true })
      }
      if (u.includes(`/api/jobs/${jobId}`)) {
        return json({ job: { id: jobId, status: completed ? 'done' : 'waiting_signature', currentStep: 0, steps: [completed ? { ...step, status: 'done' } : step] } })
      }
      return real(url as string, init)
    }) as typeof fetch
  }

  // Drive it with the SAFE as the signer. Every EVM leg becomes a Safe tx.
  const signer = sdkSafe.safeSigner(signerOpts)
  const hashes: string[] = []
  let outcome: Awaited<ReturnType<SdkDesk['driveJob']>>
  try {
    outcome = await desk.driveJob({
      base: BASE,
      jobId,
      token,
      signer,
      fetch: fetchForDrive,
      rpc: { [CHAIN_ID]: rpc.url },
      headers: INTERNAL,
      timeoutMs: 12 * 60_000,
      onLeg: (leg: { seq: number; kind: string; summary: string; chainId: number | null; valueUsd: number | null; staleAfterMs: number | null }) =>
        log(`- leg ${leg.seq} offered: \`${leg.kind}\` on chain ${leg.chainId} · $${leg.valueUsd ?? '?'} · stale in ${leg.staleAfterMs == null ? '—' : `${Math.round(leg.staleAfterMs / 1000)}s`} — "${leg.summary.slice(0, 200)}"`),
      onDone: (seq: number, result: Record<string, unknown>) => {
        const words = JSON.stringify(result).slice(0, 400)
        if (typeof result.txHash === 'string') hashes.push(result.txHash)
        for (const t of (result.txs as Array<{ hash: string }> | undefined) ?? []) if (!hashes.includes(t.hash)) hashes.push(t.hash)
        log(`- leg ${seq} completed by the runner: ${words}`)
      },
      onWaiting: (n: { seq: number; status: string; title: string; waiting?: string; withheld?: string }) => {
        if (n.withheld) log(`- waiting at leg ${n.seq}: WITHHELD — ${n.withheld}`)
      },
    })
  } catch (e) {
    log(`- \`driveJob(safeSigner)\` stopped: ${errWords(e)}`)
    outcome = { status: 'error', legs: [], results: [] }
  }
  log(`- outcome: **${outcome.status}**${outcome.failReason ? ` — ${outcome.failReason}` : ''}${outcome.withheld ? ` — withheld at leg ${outcome.withheld.seq}: ${outcome.withheld.reason}` : ''}`)

  // The receipts: every hash the Safe executed, with its DeskFill if the hook emitted one.
  for (const h of hashes) {
    try {
      const r = await pc.getTransactionReceipt({ hash: h as Hex })
      const fills = parseEventLogs({ abi: POLICY_POOL_HOOK_ABI, logs: r.logs, eventName: 'DeskFill' }).map((l) => {
        const a = l.args as Record<string, unknown>
        return `DeskFill(intentId ${String(a.intentId).slice(0, 10)}…, swapper ${short(String(a.swapper))}, origin "${String(a.origin)}")`
      })
      log(`- receipt ${h}: ${r.status} · from ${short(r.from)} (tx.origin) → to ${short(r.to ?? '')} (the Safe) · block ${r.blockNumber} · ${r.gasUsed} gas${fills.length ? ` · ${fills.join('; ')}` : ''} — ${explorerTx(h)}`)
    } catch (e) {
      log(`- receipt ${h}: not readable (${errWords(e).slice(0, 120)})`)
    }
  }
  if (!stubbed) {
    const job = await fetch(`${BASE}/api/jobs/${jobId}?t=${encodeURIComponent(token)}`, { headers: { accept: 'application/json', ...INTERNAL } })
      .then((r) => r.json() as Promise<{ job?: { status?: string; steps?: Array<{ seq: number; kind?: string; status?: string; title?: string }> } }>)
      .catch(() => ({}) as { job?: undefined })
    if (job.job) log(`- the job as the desk sees it: ${job.job.status} · ${(job.job.steps ?? []).map((s) => `${s.seq}:${s.kind ?? ''}=${s.status ?? ''}`).join(' ')}`)
  }
  const [safeEth, safeUsdcAfter, ownerEthAfter] = await Promise.all([
    pc.getBalance({ address: safeAddress }),
    pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [safeAddress] }),
    pc.getBalance({ address: owner.address }),
  ])
  log(`- after: the Safe holds ${formatEther(safeEth)} ETH · ${formatUnits(safeUsdcAfter, 6)} USDC; the burner ${formatEther(ownerEthAfter)} ETH (gas paid as executor)`)
  log('')
  log(`_Log written by scripts/safe-drill.ts; ${lines.length} lines._`)
}

main().catch((e) => {
  log(`\n**CRASHED:** ${errWords(e)}`)
  process.exit(1)
})
