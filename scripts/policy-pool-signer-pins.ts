// Pins for the policy pool's signer lane (lib/policy-pool/attestation +
// lib/policy-pool/policy): sign → verify, every tampered field refuses, a
// wrong signer / domain refuses, hookData round-trips through spec.ts, the
// committed cross-implementation vectors still match spec.ts, and the desk
// policy allows/refuses by the env. Pure: no server, no chain, no DB.
// Uses only PUBLIC throwaway keys (Anvil accounts). Runnable alone:
//   npx tsx scripts/policy-pool-signer-pins.ts
import { getAddress, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { attestationDigest, attestationFor, policySignerAddress, signAttestation, verifyAttestation } from '../lib/policy-pool/attestation'
import { policyCapUsd, policyDecision, pinnedPolicyPool, POLICY_POOL_DEFAULT_MAX_USD } from '../lib/policy-pool/policy'
import { ATTESTATION_TTL_SEC, ZERO_SWAPPER, decodeHookData, encodeHookData, intentIdFor, poolIdFor, type Attestation } from '../lib/policy-pool/spec'
import { ANVIL_ACCOUNT_0_ADDRESS, ANVIL_ACCOUNT_0_KEY, EXAMPLE_HOOK, VECTORS_PATH, buildVectors } from './policy-pool-attestation-vectors'
import { readFileSync } from 'node:fs'

type Check = (name: string, ok: boolean, extra?: string) => void

const ANVIL_ACCOUNT_1_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const CHAIN = 84532
const USDC_SEPOLIA: Address = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e')
const NATIVE: Address = '0x0000000000000000000000000000000000000000'
const POOL_ID = poolIdFor({ currency0: NATIVE, currency1: USDC_SEPOLIA, fee: 500, tickSpacing: 10, hooks: EXAMPLE_HOOK })
const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)
const same = (a: unknown, b: unknown) => JSON.stringify(a, big) === JSON.stringify(b, big)

const POLICY_ENV = {
  POLICY_POOL_CHAIN_ID: String(CHAIN),
  POLICY_POOL_HOOK: EXAMPLE_HOOK.toLowerCase(),
  POLICY_POOL_CURRENCY0: NATIVE,
  POLICY_POOL_CURRENCY1: USDC_SEPOLIA,
  POLICY_POOL_FEE: '500',
  POLICY_POOL_TICK_SPACING: '10',
}

async function throwsWith(fn: () => unknown, re: RegExp): Promise<boolean> {
  try {
    await fn()
    return false
  } catch (e) {
    return re.test(String((e as Error)?.message ?? e))
  }
}

export async function policyPoolSignerPins(check: Check): Promise<void> {
  const opts = { chainId: CHAIN, hook: EXAMPLE_HOOK }
  const signer = ANVIL_ACCOUNT_0_ADDRESS

  // ── attestationFor ──
  const before = Math.floor(Date.now() / 1000)
  const att = attestationFor({
    intentId: 'cmh-desk-intent-1',
    poolId: POOL_ID,
    swapper: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    zeroForOne: true,
    maxAmountIn: BigInt('10000000000000000'),
    origin: 'desk:cmh-desk-intent-1',
  })
  const after = Math.floor(Date.now() / 1000)
  check('policy-pool signer: attestationFor hashes the intent id', att.intentId === intentIdFor('cmh-desk-intent-1'))
  check(
    'policy-pool signer: attestationFor expiry = now + 600 (bigint)',
    typeof att.expiry === 'bigint' && att.expiry >= BigInt(before + ATTESTATION_TTL_SEC) && att.expiry <= BigInt(after + ATTESTATION_TTL_SEC),
    String(att.expiry),
  )
  const bearer = attestationFor({ intentId: 'x', poolId: POOL_ID, swapper: null, zeroForOne: false, maxAmountIn: BigInt(1), origin: 'demo:bearer', ttlSec: 60 })
  check('policy-pool signer: null swapper = bearer (zero address)', bearer.swapper === ZERO_SWAPPER)
  check('policy-pool signer: ttlSec honoured', bearer.expiry - BigInt(Math.floor(Date.now() / 1000)) <= BigInt(60))
  check(
    'policy-pool signer: attestationFor refuses a zero size',
    await throwsWith(() => attestationFor({ intentId: 'x', poolId: POOL_ID, swapper: null, zeroForOne: true, maxAmountIn: BigInt(0), origin: 'o' }), /maxAmountIn/),
  )

  // ── sign → verify ──
  const sig = await signAttestation(att, { ...opts, privateKey: ANVIL_ACCOUNT_0_KEY })
  check('policy-pool signer: 65-byte signature', /^0x[0-9a-f]{130}$/.test(sig))
  check('policy-pool signer: sign → verify true', await verifyAttestation(att, sig, { ...opts, signer }))
  check('policy-pool signer: verify accepts a lowercase signer', await verifyAttestation(att, sig, { ...opts, signer: signer.toLowerCase() as Address }))

  // every field, tampered, refuses
  const tampered: Array<[string, Attestation]> = [
    ['intentId', { ...att, intentId: intentIdFor('another-intent') }],
    ['poolId', { ...att, poolId: poolIdFor({ currency0: NATIVE, currency1: USDC_SEPOLIA, fee: 3000, tickSpacing: 60, hooks: EXAMPLE_HOOK }) }],
    ['swapper', { ...att, swapper: ZERO_SWAPPER }],
    ['zeroForOne', { ...att, zeroForOne: !att.zeroForOne }],
    ['maxAmountIn', { ...att, maxAmountIn: att.maxAmountIn + BigInt(1) }],
    ['expiry', { ...att, expiry: att.expiry + BigInt(1) }],
    ['origin', { ...att, origin: att.origin + ' ' }],
  ]
  for (const [field, t] of tampered) {
    check(`policy-pool signer: tampered ${field} → false`, !(await verifyAttestation(t, sig, { ...opts, signer })))
  }
  check('policy-pool signer: wrong signer → false', !(await verifyAttestation(att, sig, { ...opts, signer: privateKeyToAccount(ANVIL_ACCOUNT_1_KEY).address })))
  check('policy-pool signer: wrong chain → false', !(await verifyAttestation(att, sig, { ...opts, chainId: 8453, signer })))
  check(
    'policy-pool signer: wrong hook (verifyingContract) → false',
    !(await verifyAttestation(att, sig, { ...opts, hook: '0x00000000000000000000000000000000000008C0', signer })),
  )
  check('policy-pool signer: garbage signature → false (no throw)', !(await verifyAttestation(att, '0xdeadbeef', { ...opts, signer })))
  check('policy-pool signer: garbage signer → false (no throw)', !(await verifyAttestation(att, sig, { ...opts, signer: 'nope' as Address })))
  const sig1 = await signAttestation(att, { ...opts, privateKey: ANVIL_ACCOUNT_1_KEY })
  check('policy-pool signer: a different key\'s signature → false', !(await verifyAttestation(att, sig1, { ...opts, signer })))
  check('policy-pool signer: digest changes with the domain', attestationDigest(att, opts) !== attestationDigest(att, { ...opts, chainId: 8453 }))

  // ── env key ──
  const saved = { key: process.env.POLICY_SIGNER_PRIVATE_KEY }
  try {
    delete process.env.POLICY_SIGNER_PRIVATE_KEY
    check('policy-pool signer: unset key → clear error', await throwsWith(() => signAttestation(att, opts), /POLICY_SIGNER_PRIVATE_KEY is not set/))
    process.env.POLICY_SIGNER_PRIVATE_KEY = '0x1234'
    check('policy-pool signer: malformed key → clear error', await throwsWith(() => signAttestation(att, opts), /malformed/))
    const k = generatePrivateKey()
    process.env.POLICY_SIGNER_PRIVATE_KEY = k
    const envSig = await signAttestation(att, opts)
    const envAddr = privateKeyToAccount(k).address
    check('policy-pool signer: env key signs, verifies against its address', await verifyAttestation(att, envSig, { ...opts, signer: envAddr }))
    check('policy-pool signer: policySignerAddress reads the env key', policySignerAddress() === envAddr)
  } finally {
    if (saved.key === undefined) delete process.env.POLICY_SIGNER_PRIVATE_KEY
    else process.env.POLICY_SIGNER_PRIVATE_KEY = saved.key
  }

  // ── hookData ──
  const hd = encodeHookData(att, sig)
  const back = decodeHookData(hd)
  check('policy-pool signer: decodeHookData(encodeHookData(att, sig)) round-trips', same(back, { att, sig }))
  const uni: Attestation = { ...bearer, origin: 'dune:9055910 · 政策池 🏦👩🏽‍💻 é', maxAmountIn: (BigInt(1) << BigInt(256)) - BigInt(1) }
  const uniSig = await signAttestation(uni, { ...opts, privateKey: ANVIL_ACCOUNT_0_KEY })
  check('policy-pool signer: unicode + max uint round-trips', same(decodeHookData(encodeHookData(uni, uniSig)), { att: uni, sig: uniSig }))
  check('policy-pool signer: unicode + max uint verifies', await verifyAttestation(uni, uniSig, { ...opts, signer }))

  // ── the committed vectors still match spec.ts ──
  let committed = ''
  try {
    committed = readFileSync(VECTORS_PATH, 'utf8')
  } catch {}
  check('policy-pool signer: committed attestation.json matches spec.ts', committed === JSON.stringify(await buildVectors(), null, 2) + '\n')

  // ── policyDecision ──
  check('policy-pool policy: default cap $500', policyCapUsd({}) === POLICY_POOL_DEFAULT_MAX_USD)
  check('policy-pool policy: cap parses "$1,000"', policyCapUsd({ POLICY_POOL_MAX_USD: '$1,000' }) === 1000)
  check('policy-pool policy: junk cap → default', policyCapUsd({ POLICY_POOL_MAX_USD: 'lots' }) === 500 && policyCapUsd({ POLICY_POOL_MAX_USD: '-5' }) === 500 && policyCapUsd({ POLICY_POOL_MAX_USD: '0' }) === 500)
  const pinned = pinnedPolicyPool(POLICY_ENV)
  check('policy-pool policy: pinned pool id = spec poolIdFor', pinned.ok && pinned.poolId === POOL_ID)

  const ok = policyDecision({ usd: 25, chainId: CHAIN, hook: EXAMPLE_HOOK, poolId: POOL_ID }, POLICY_ENV)
  check('policy-pool policy: $25 on the pinned pool → allowed', ok.allowed === true && ok.capUsd === 500, JSON.stringify(ok))
  const atCap = policyDecision({ usd: 500, chainId: CHAIN, hook: EXAMPLE_HOOK, poolId: POOL_ID }, POLICY_ENV)
  check('policy-pool policy: exactly the cap → allowed', atCap.allowed === true)
  const over = policyDecision({ usd: 5000, chainId: CHAIN, hook: EXAMPLE_HOOK, poolId: POOL_ID }, POLICY_ENV)
  check(
    'policy-pool policy: $5,000 → "Over the desk\'s per-order cap of $500."',
    !over.allowed && over.reason === "Over the desk's per-order cap of $500.",
    JSON.stringify(over),
  )
  const raised = policyDecision({ usd: 5000, chainId: CHAIN, hook: EXAMPLE_HOOK, poolId: POOL_ID }, { ...POLICY_ENV, POLICY_POOL_MAX_USD: '10000' })
  check('policy-pool policy: a raised cap allows it', raised.allowed === true && raised.capUsd === 10000)
  const wrongPool = policyDecision({ usd: 25, chainId: CHAIN, hook: EXAMPLE_HOOK, poolId: intentIdFor('not-a-pool') }, POLICY_ENV)
  check('policy-pool policy: another pool → refused', !wrongPool.allowed && /not the desk's policy pool/.test(wrongPool.reason), JSON.stringify(wrongPool))
  const wrongHook = policyDecision({ usd: 25, chainId: CHAIN, hook: ANVIL_ACCOUNT_0_ADDRESS, poolId: POOL_ID }, POLICY_ENV)
  check('policy-pool policy: another hook → refused', !wrongHook.allowed && /hook/.test(wrongHook.reason))
  const wrongChain = policyDecision({ usd: 25, chainId: 8453, hook: EXAMPLE_HOOK, poolId: POOL_ID }, POLICY_ENV)
  check('policy-pool policy: another chain → refused', !wrongChain.allowed && /chain 84532, not chain 8453/.test(wrongChain.reason), JSON.stringify(wrongChain))
  for (const usd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const bad = policyDecision({ usd, chainId: CHAIN, hook: EXAMPLE_HOOK, poolId: POOL_ID }, POLICY_ENV)
    check(`policy-pool policy: usd ${usd} → refused`, !bad.allowed)
  }
  const unset = policyDecision({ usd: 25, chainId: CHAIN, hook: EXAMPLE_HOOK, poolId: POOL_ID }, {})
  check(
    'policy-pool policy: env unset → refused, names what is missing',
    !unset.allowed && /not configured/.test(unset.reason) && /POLICY_POOL_HOOK/.test(unset.reason) && unset.capUsd === 500,
    JSON.stringify(unset),
  )
  const partial = policyDecision({ usd: 25, chainId: CHAIN, hook: EXAMPLE_HOOK, poolId: POOL_ID }, { ...POLICY_ENV, POLICY_POOL_FEE: 'abc' })
  check('policy-pool policy: bad fee env → refused naming POLICY_POOL_FEE', !partial.allowed && /POLICY_POOL_FEE/.test(partial.reason))
}

if (require.main === module) {
  let pass = 0
  let fail = 0
  const check: Check = (name, ok, extra) => {
    if (ok) pass++
    else fail++
    console.log(`${ok ? '✅' : '❌'} ${name}${!ok && extra ? ` — ${extra}` : ''}`)
  }
  policyPoolSignerPins(check)
    .then(() => {
      console.log(`\n${pass} passed, ${fail} failed`)
      process.exit(fail ? 1 : 0)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
