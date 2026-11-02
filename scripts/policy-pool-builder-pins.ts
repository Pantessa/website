// THE POLICY POOL — builder pins (BUILDER lane, squad 2026-11-02). Pure: the
// v4 pin table (Base + Base Sepolia, Base's cascade untouched), the runtime
// config (off / half / whole / zero hook), the venue words and the origin
// rule, the hookData-bearing encoding (byte-identical without it), the guard
// over a signed attestation — passes once, refuses every tampered field, a
// wrong signer, an expired attestation, a hook without an expectation and an
// expectation without a hook — the hook's revert names, and the dispatch
// sites' source. No server, no chain, no DB. Throwaway keys only.
//
//   npx tsx scripts/policy-pool-builder-pins.ts
import { readFileSync } from 'node:fs'
import { encodeErrorResult, encodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { APP_CHAINS, BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_USDC, UNISWAP_V4_PINS, chainById, uniswapV4PinsFor } from '../lib/chains'
import { NATIVE_CURRENCY, POLICY_POOL_BUILD_PATH, POLICY_POOL_REFRESH_KIND, POLICY_POOL_VENUE, policyPoolChainName, policyPoolConfig } from '../lib/policy-pool/config'
import {
  POLICY_POOL_INTENT_ID_RE,
  POLICY_POOL_ORIGIN_RE,
  namesPolicyPool,
  planNamesPolicyPool,
  policyPoolOriginFor,
  policyPoolRouteFor,
  stripPolicyPoolWords,
  withPolicyPoolWords,
} from '../lib/policy-pool/venue'
import { POLICY_POOL_HOOK_ABI, encodeHookData, intentIdFor, poolIdFor, type Attestation } from '../lib/policy-pool/spec'
import { attestationFor, signAttestation } from '../lib/policy-pool/attestation'
import {
  PERMIT2_ABI,
  encodeV4SwapCalldata,
  guardPolicyPoolBuild,
  guardUniswapV4Build,
  policyPoolRevertName,
  swapHookDataOf,
  unwrapRevertData,
  type V4BuiltStep,
  type V4GuardExpectations,
  type V4PoolKey,
} from '../lib/uniswap-v4'

type Check = (name: string, ok: boolean, extra?: string) => void

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/
const HOOK: Address = getAddress('0x00000000000000000000000000000000000000C0') // any address with the three flag bits would do; the guard compares, never mines
const UR = UNISWAP_V4_PINS[84532].universalRouter
const PERMIT2 = UNISWAP_V4_PINS[84532].permit2

const SEPOLIA_ENV: Record<string, string | undefined> = {
  POLICY_POOL_CHAIN_ID: '84532',
  POLICY_POOL_HOOK: HOOK,
  POLICY_POOL_CURRENCY0: NATIVE_CURRENCY,
  POLICY_POOL_CURRENCY1: BASE_SEPOLIA_USDC,
  POLICY_POOL_FEE: '500',
  POLICY_POOL_TICK_SPACING: '10',
  POLICY_POOL_DEPLOY_BLOCK: '12345',
  POLICY_SIGNER_ADDRESS: '0x0000000000000000000000000000000000000001',
  POLICY_POOL_MAX_USD: '500',
}

/** Sign as a throwaway policy signer through the README contract (env key), restoring the env after. */
async function signAs(key: Hex, att: Attestation, hook: Address, chainId: number): Promise<Hex> {
  const prior = process.env.POLICY_SIGNER_PRIVATE_KEY
  process.env.POLICY_SIGNER_PRIVATE_KEY = key
  try {
    return await signAttestation(att, { chainId, hook })
  } finally {
    if (prior === undefined) delete process.env.POLICY_SIGNER_PRIVATE_KEY
    else process.env.POLICY_SIGNER_PRIVATE_KEY = prior
  }
}

export async function policyPoolBuilderPins(check: Check): Promise<void> {
  // ── The pins table ────────────────────────────────────────────────────────
  for (const id of [8453, 84532] as const) {
    const p = UNISWAP_V4_PINS[id]
    check(`policy pool pins: chain ${id} pins PoolManager · Universal Router · V4 Quoter · StateView · PositionManager · Permit2, all address-shaped, Permit2 canonical`,
      !!p && Object.values(p).every((a) => ADDR_RE.test(a)) && p.permit2.toLowerCase() === '0x000000000022d473030f116ddee9f6b43ac78ba3' && new Set(Object.values(p).map((a) => a.toLowerCase())).size === 6)
  }
  check('policy pool pins: Base (8453) pins are the deployments page\'s (PoolManager 0x4985…2b2b, UR 0x6ff5…9b43, Quoter 0xE1A6…CA47)',
    UNISWAP_V4_PINS[8453].poolManager.toLowerCase() === '0x498581ff718922c3f8e6a244956af099b2652b2b' && UNISWAP_V4_PINS[8453].universalRouter.toLowerCase() === '0x6ff5693b99212da76ad316178a184ab56d299b43' && UNISWAP_V4_PINS[8453].quoter.toLowerCase() === '0xe1a6c5803e3c44368b171bd680c7d32dfc92ca47')
  check('policy pool pins: Base Sepolia (84532) Quoter is the deployments page\'s 0x4a65…1cba (the squad README\'s 0x4A6b…d6a1 has no code), UR 0x492e…4104',
    UNISWAP_V4_PINS[84532].quoter.toLowerCase() === '0x4a6513c898fe1b2d0e78d3b0e0a4a151589b1cba' && UNISWAP_V4_PINS[84532].universalRouter.toLowerCase() === '0x492e6456d9528771018deb9e87ef7750ef184104')
  check('policy pool pins: the swap CASCADE is untouched — Base\'s AppChain still has uniswapV4: null, the v4 fallback stays Robinhood-only, Sepolia is NOT an AppChain',
    chainById(8453)?.uniswapV4 === null && APP_CHAINS.every((c) => c.id === 4663 || c.uniswapV4 === null) && chainById(BASE_SEPOLIA_CHAIN_ID) === null && uniswapV4PinsFor(4663) === null && uniswapV4PinsFor(84532) === UNISWAP_V4_PINS[84532])

  // ── Config ────────────────────────────────────────────────────────────────
  check('policy pool config: null while POLICY_POOL_HOOK is unset (feature off)', policyPoolConfig({}) === null && policyPoolConfig({ POLICY_POOL_CHAIN_ID: '84532' }) === null)
  const cfg = policyPoolConfig(SEPOLIA_ENV)
  check('policy pool config: a whole Sepolia env reads back — chain, hook, ordered key, poolId = poolIdFor(key), signer, cap 500, deploy block, pins, not mainnet',
    !!cfg && cfg.chainId === 84532 && cfg.chainName === 'Base Sepolia' && cfg.hook === HOOK && cfg.poolKey.currency0 === NATIVE_CURRENCY && cfg.poolKey.currency1 === getAddress(BASE_SEPOLIA_USDC) && cfg.poolKey.fee === 500 && cfg.poolKey.tickSpacing === 10 && cfg.poolKey.hooks === HOOK &&
      cfg.poolId === poolIdFor(cfg.poolKey) && cfg.signer === '0x0000000000000000000000000000000000000001' && cfg.maxUsd === 500 && cfg.deployBlock === 12345 && cfg.pins === UNISWAP_V4_PINS[84532] && cfg.mainnet === false)
  const throwsOn = (over: Record<string, string | undefined>, re: RegExp) => {
    try {
      policyPoolConfig({ ...SEPOLIA_ENV, ...over })
      return false
    } catch (e) {
      return re.test(e instanceof Error ? e.message : '')
    }
  }
  check('policy pool config: a HOOK beside a broken sibling THROWS by name (never reads as off) — bad chain, unknown chain, unordered currencies, missing signer, zero hook',
    throwsOn({ POLICY_POOL_CHAIN_ID: 'x' }, /POLICY_POOL_CHAIN_ID/) && throwsOn({ POLICY_POOL_CHAIN_ID: '4663' }, /No Uniswap v4 pins for chain 4663/) &&
      throwsOn({ POLICY_POOL_CURRENCY0: BASE_SEPOLIA_USDC, POLICY_POOL_CURRENCY1: NATIVE_CURRENCY }, /sort below/) && throwsOn({ POLICY_SIGNER_ADDRESS: '' }, /POLICY_SIGNER_ADDRESS/) &&
      throwsOn({ POLICY_POOL_HOOK: NATIVE_CURRENCY }, /zero address/) && throwsOn({ POLICY_POOL_FEE: '-1' }, /POLICY_POOL_FEE/))
  check('policy pool config: Base mainnet reads mainnet: true (the demo runner refuses there without Nate\'s yes)',
    policyPoolConfig({ ...SEPOLIA_ENV, POLICY_POOL_CHAIN_ID: '8453', POLICY_POOL_CURRENCY1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' })?.mainnet === true && policyPoolChainName(8453) === 'Base' && policyPoolChainName(84532) === 'Base Sepolia')

  // ── Venue words + origin ─────────────────────────────────────────────────
  check('policy pool venue: "through / on / via / in the policy pool" and the bare slug name it; plain asks do not',
    ['Buy $25 of ETH through the policy pool', 'Swap 25 USDC for ETH on the policy pool', 'buy $5 of ETH via the Policy Pool', 'Buy $25 of ETH (policy-pool)'].every(namesPolicyPool) &&
      ['Buy $25 of ETH', 'Buy $25 of ETH on Base', 'what is a policy', 'pool my funds'].every((s) => !namesPolicyPool(s)))
  check('policy pool venue: the words are added once and stripped clean',
    withPolicyPoolWords('Buy $25 of ETH.') === 'Buy $25 of ETH through the policy pool' && withPolicyPoolWords(withPolicyPoolWords('Buy $25 of ETH')) === 'Buy $25 of ETH through the policy pool' && stripPolicyPoolWords('Buy $25 of ETH through the policy pool') === 'Buy $25 of ETH')
  check('policy pool venue: origin is dune:<queryId> only for a Dune read whose ref is a query id, else desk:<intentId>',
    policyPoolOriginFor('abc123def4', { feed: 'dune', ref: '9055910' }) === 'dune:9055910' && policyPoolOriginFor('abc123def4', { feed: 'dune', ref: 'https://dune.com/x' }) === 'desk:abc123def4' &&
      policyPoolOriginFor('abc123def4', { feed: 'hyperliquid', ref: '123' }) === 'desk:abc123def4' && policyPoolOriginFor('abc123def4', null) === 'desk:abc123def4' && POLICY_POOL_ORIGIN_RE.test('dune:9055910') && POLICY_POOL_ORIGIN_RE.test('desk:abc123def4') && POLICY_POOL_ORIGIN_RE.test('demo:plain-wallet') && !POLICY_POOL_ORIGIN_RE.test('dune:x') && POLICY_POOL_INTENT_ID_RE.test('chat-abcdef1234'))
  check('policy pool venue: the route is null when nothing names the pool; the message or the desk plan routes it; the desk intent\'s id + Dune origin win over the fallback id',
    policyPoolRouteFor({ message: 'Buy $25 of ETH', fallbackId: 'f1' }) === null &&
      JSON.stringify(policyPoolRouteFor({ message: 'Buy $25 of ETH through the policy pool', fallbackId: 'f1' })) === JSON.stringify({ venue: POLICY_POOL_VENUE, intentId: 'f1', origin: 'desk:f1' }) &&
      JSON.stringify(policyPoolRouteFor({ message: 'Buy $25 of ETH', intent: { id: 'bi1', plan: { venue: 'policy-pool' }, origin: { feed: 'dune', ref: '42' } }, fallbackId: 'f1' })) === JSON.stringify({ venue: POLICY_POOL_VENUE, intentId: 'bi1', origin: 'dune:42' }) &&
      planNamesPolicyPool({ venue: 'policy-pool' }) && !planNamesPolicyPool({ venue: 'cow' }) && !planNamesPolicyPool(null))

  // ── Encoding ─────────────────────────────────────────────────────────────
  const poolKey: V4PoolKey = { currency0: NATIVE_CURRENCY, currency1: getAddress(BASE_SEPOLIA_USDC), fee: 500, tickSpacing: 10, hooks: HOOK }
  const noHookKey: V4PoolKey = { ...poolKey, hooks: NATIVE_CURRENCY }
  const amountIn = BigInt(25_000_000) // 25 USDC
  const minOut = BigInt('10900000000000000')
  const now = Math.floor(Date.now() / 1000)
  const deadline = now + 600
  const permit2Expiration = deadline + 3600
  const plain = encodeV4SwapCalldata({ poolKey: noHookKey, zeroForOne: false, amountIn, minOut, deadline })
  check('policy pool encode: the classic build is BYTE-IDENTICAL with hookData absent, "0x" or undefined',
    plain === encodeV4SwapCalldata({ poolKey: noHookKey, zeroForOne: false, amountIn, minOut, deadline, hookData: '0x' }) && plain === encodeV4SwapCalldata({ poolKey: noHookKey, zeroForOne: false, amountIn, minOut, deadline, hookData: undefined }) && swapHookDataOf(plain) === '0x')

  const signerKey = generatePrivateKey()
  const signer = privateKeyToAccount(signerKey).address
  const poolId = poolIdFor(poolKey)
  const swapper = privateKeyToAccount(generatePrivateKey()).address
  const att = attestationFor({ intentId: 'demo-intent-1', poolId, swapper, zeroForOne: false, maxAmountIn: amountIn, origin: 'dune:9055910' })
  const sig = await signAs(signerKey, att, HOOK, 84532)
  const hookData = encodeHookData(att, sig)
  const swapData = encodeV4SwapCalldata({ poolKey, zeroForOne: false, amountIn, minOut, deadline, hookData })
  check('policy pool encode: hookData rides inside the swap action and reads back verbatim', swapHookDataOf(swapData) === hookData && hookData.length > 2 + 64 * 9)

  const steps = (data: Hex): V4BuiltStep[] => [
    { label: 'approve', title: 'Approve USDC to Permit2', tx: { to: BASE_SEPOLIA_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [PERMIT2, amountIn] }), value: '0', chainId: 84532, action: 'approve' } },
    { label: 'permit', title: 'Permit2 grant', tx: { to: PERMIT2, data: encodeFunctionData({ abi: PERMIT2_ABI, functionName: 'approve', args: [BASE_SEPOLIA_USDC, UR, amountIn, permit2Expiration] }), value: '0', chainId: 84532, action: 'approve' } },
    { label: 'swap', title: 'Swap 25 USDC → ETH through the policy pool', tx: { to: UR, data, value: '0', chainId: 84532, action: 'swap' } },
  ]
  const baseExp: Omit<V4GuardExpectations, 'policyPool'> = { chainId: 84532, universalRouter: UR, permit2: PERMIT2, sellToken: BASE_SEPOLIA_USDC, buyToken: NATIVE_CURRENCY, amountIn, minOut, poolKey, permit2Expiration }
  const pp = { hook: HOOK, poolId, signer, intentId: intentIdFor('demo-intent-1'), swapper, zeroForOne: false, maxAmountIn: amountIn, origin: 'dune:9055910' }

  const good = await guardPolicyPoolBuild(steps(swapData), { ...baseExp, policyPool: pp })
  check('policy pool guard: a signed, matching attestation PASSES (3-step chain; native ETH out)', good.ok, good.reasons.join(' | '))
  const oneStep = await guardPolicyPoolBuild([steps(swapData)[2]], { ...baseExp, policyPool: pp })
  check('policy pool guard: swap-only chain PASSES (allowances in place)', oneStep.ok, oneStep.reasons.join(' | '))

  const refuses = async (data: Hex, exp: Parameters<typeof guardPolicyPoolBuild>[1], re: RegExp) => {
    const r = await guardPolicyPoolBuild(steps(data), exp)
    return !r.ok && r.reasons.some((x) => re.test(x))
  }
  const withAtt = async (over: Partial<Attestation>, key = signerKey) => {
    const a = { ...att, ...over }
    return encodeV4SwapCalldata({ poolKey, zeroForOne: a.zeroForOne, amountIn, minOut, deadline, hookData: encodeHookData(a, await signAs(key, a, HOOK, 84532)) })
  }
  check('policy pool guard: EMPTY hookData on the pinned hook refuses (the hook would revert NotAttested)',
    await refuses(encodeV4SwapCalldata({ poolKey, zeroForOne: false, amountIn, minOut, deadline }), { ...baseExp, policyPool: pp }, /no attestation/))
  check('policy pool guard: a signature by ANOTHER key refuses by name (does not verify to the pinned signer)',
    await refuses(await withAtt({}, generatePrivateKey()), { ...baseExp, policyPool: pp }, /does not verify to the pinned policy signer/))
  check('policy pool guard: a tampered intentId refuses', await refuses(await withAtt({ intentId: intentIdFor('other-intent') }), { ...baseExp, policyPool: pp }, /different intent/))
  check('policy pool guard: a tampered poolId refuses', await refuses(await withAtt({ poolId: poolIdFor(noHookKey) }), { ...baseExp, policyPool: pp }, /different pool/))
  check('policy pool guard: a tampered swapper refuses', await refuses(await withAtt({ swapper: signer }), { ...baseExp, policyPool: pp }, /different swapper/))
  check('policy pool guard: a flipped attested side refuses (against the ask AND the calldata)',
    await refuses(await withAtt({ zeroForOne: true }), { ...baseExp, policyPool: pp }, /direction does not match/))
  check('policy pool guard: a different maxAmountIn refuses; amountIn over the attested max refuses',
    (await refuses(await withAtt({ maxAmountIn: amountIn * BigInt(2) }), { ...baseExp, policyPool: pp }, /not the size the desk asked for/)) &&
      (await refuses(await withAtt({ maxAmountIn: amountIn - BigInt(1) }), { ...baseExp, policyPool: pp }, /exceeds the attested maximum/)))
  check('policy pool guard: a different origin refuses', await refuses(await withAtt({ origin: 'desk:somebody-else' }), { ...baseExp, policyPool: pp }, /origin is not the provenance/))
  check('policy pool guard: an EXPIRED attestation refuses', await refuses(await withAtt({ expiry: BigInt(now - 1) }), { ...baseExp, policyPool: pp }, /already expired/))
  check('policy pool guard: hookData that does not decode refuses',
    await refuses(encodeV4SwapCalldata({ poolKey, zeroForOne: false, amountIn, minOut, deadline, hookData: '0xdeadbeef' }), { ...baseExp, policyPool: pp }, /does not decode/))
  const otherHookKey: V4PoolKey = { ...poolKey, hooks: getAddress('0x00000000000000000000000000000000000000C1') }
  check('policy pool guard: calldata aimed at a DIFFERENT hook than the pinned one refuses (and its pool id no longer matches)',
    await refuses(encodeV4SwapCalldata({ poolKey: otherHookKey, zeroForOne: false, amountIn, minOut, deadline, hookData }), { ...baseExp, policyPool: pp }, /not the pinned policy pool hook/))
  check('policy pool guard: an expectation whose own quoted key lacks the hook refuses',
    await refuses(swapData, { ...baseExp, poolKey: noHookKey, policyPool: pp }, /quoted pool key does not carry the pinned policy pool hook/))
  const sync = guardUniswapV4Build(steps(swapData), { ...baseExp, policyPool: { ...pp, signatureVerified: false } })
  check('policy pool guard (sync): signatureVerified must be literally true — false refuses even when every field matches',
    !sync.ok && sync.reasons.length === 1 && /does not verify/.test(sync.reasons[0]) && guardUniswapV4Build(steps(swapData), { ...baseExp, policyPool: { ...pp, signatureVerified: true } }).ok)
  const classic = guardUniswapV4Build(steps(swapData), baseExp)
  check('no-hook guard: the SAME calldata WITHOUT a policy-pool expectation refuses on both counts — a hook contract and unexpected hookData — exactly as before',
    !classic.ok && classic.reasons.some((r) => /hook contract/.test(r)) && classic.reasons.some((r) => /Unexpected hookData/.test(r)))
  check('no-hook guard: the classic no-hook build still passes untouched', guardUniswapV4Build(steps(plain), { ...baseExp, poolKey: noHookKey }).ok)

  // ── The hook's reverts by name ──────────────────────────────────────────
  const viemErr = (data: Hex) => Object.assign(new Error('execution reverted'), { walk: (fn: (e: unknown) => boolean) => (fn({ data }) ? { data } : null) })
  check('policy pool revert names: NotAttested · BadSigner · OverSize decode from the hook ABI; a foreign revert reads null',
    policyPoolRevertName(viemErr(encodeErrorResult({ abi: POLICY_POOL_HOOK_ABI, errorName: 'NotAttested' }))) === 'NotAttested' &&
      policyPoolRevertName(viemErr(encodeErrorResult({ abi: POLICY_POOL_HOOK_ABI, errorName: 'BadSigner' }))) === 'BadSigner' &&
      policyPoolRevertName(viemErr(encodeErrorResult({ abi: POLICY_POOL_HOOK_ABI, errorName: 'OverSize' }))) === 'OverSize' &&
      policyPoolRevertName(viemErr('0x12345678')) === null && policyPoolRevertName(new Error('timeout')) === null)
  const notAttested = encodeErrorResult({ abi: POLICY_POOL_HOOK_ABI, errorName: 'NotAttested' })
  const wrappedByPm = encodeErrorResult({ abi: [{ type: 'error', name: 'WrappedError', inputs: [{ type: 'address' }, { type: 'bytes4' }, { type: 'bytes' }, { type: 'bytes' }] }], errorName: 'WrappedError', args: [HOOK, '0x575e24b4', notAttested, '0xa9e35b2f'] })
  const wrappedByUr = encodeErrorResult({ abi: [{ type: 'error', name: 'ExecutionFailed', inputs: [{ type: 'uint256' }, { type: 'bytes' }] }], errorName: 'ExecutionFailed', args: [BigInt(0), wrappedByPm] })
  const wrappedByQuoter = encodeErrorResult({ abi: [{ type: 'error', name: 'UnexpectedRevertBytes', inputs: [{ type: 'bytes' }] }], errorName: 'UnexpectedRevertBytes', args: [wrappedByPm] })
  check('policy pool revert names: the hook\'s revert is read THROUGH the PoolManager\'s WrappedError, the Universal Router\'s ExecutionFailed and the Quoter\'s UnexpectedRevertBytes',
    policyPoolRevertName(viemErr(wrappedByPm)) === 'NotAttested' && policyPoolRevertName(viemErr(wrappedByUr)) === 'NotAttested' && policyPoolRevertName(wrappedByQuoter) === 'NotAttested' && unwrapRevertData(wrappedByUr) === notAttested)

  // ── Dispatch sites (source) ─────────────────────────────────────────────
  const chat = readFileSync('app/api/chat/route.ts', 'utf8')
  const refresh = readFileSync('app/api/tx/refresh/route.ts', 'utf8')
  const broker = readFileSync('app/api/broker/[transport]/route.ts', 'utf8')
  const exec = readFileSync('lib/broker-exec.ts', 'utf8')
  const telemetry = readFileSync('app/api/embed/telemetry/route.ts', 'utf8')
  const swapExec = readFileSync('lib/swap-exec.ts', 'utf8')
  check('policy pool dispatch: the chat route routes a named ask to preparePolicyPoolTurn BEFORE the Uniswap/CoW venue pick, pre-flights the pool\'s chain before any balance read, and the recipe carries intentId + origin',
    chat.includes('namesPolicyPool(message) ? await policyPoolRouteForTurn(message, turnLinkSlug)') && chat.includes('withPolicyPoolRoute(policyPool, { allowRetarget, chainNote: inferredSpot?.line })') && chat.includes('{ ...opts, allowRetarget: false, policyPool: route }') && chat.includes('if (opts.policyPool && (intent.mode ?? \'swap\') === \'swap\') {\n    return await preparePolicyPoolTurn(') &&
      chat.includes('policyPoolPreflight(chainId, intent.mode)') && chat.includes('kind: POLICY_POOL_REFRESH_KIND') && chat.includes('intentId: route.intentId,\n            origin: route.origin,') && chat.indexOf('return await preparePolicyPoolTurn(') < chat.indexOf("if (venue === 'uniswap' && (intent.mode ?? 'swap') === 'swap') {"))
  check(`policy pool dispatch: /api/tx/refresh accepts kind "${POLICY_POOL_REFRESH_KIND}" and re-attests through buildPolicyPoolSwap with the intent id + origin re-derived SERVER-side (the link's desk intent, else only the turn's own chat-<id> → desk: origin) — never the recipe body's origin`,
    refresh.includes("body.kind !== POLICY_POOL_REFRESH_KIND") && refresh.includes("prisma.brokerIntent.findFirst({ where: { linkSlug }, select: { id: true, origin: true } })") && refresh.includes('origin = policyPoolOriginFor(desk.id, readDeskOrigin(desk.origin))') &&
      refresh.includes('/^chat-[A-Za-z0-9_-]{4,64}$/.test(body.intentId)') && refresh.includes('origin = `desk:${intentId}`') && !refresh.includes('POLICY_POOL_ORIGIN_RE.test(body.origin)') && refresh.includes('await buildPolicyPoolSwap({'))
  check('policy pool dispatch: broker_open takes venue: "policy-pool" (optional enum), the desk writes the venue words into the ask and stamps plan.venue, and handoff records handed_off',
    broker.includes(".enum(['policy-pool'])") && exec.includes('opts = { ...opts, ask: withPolicyPoolWords(opts.ask) }') && exec.includes("venue: POLICY_POOL_VENUE } : plan) as object") && exec.includes("kind: 'handed_off'"))
  check('policy pool dispatch: the telemetry beacon records signed (and mined once the receipt verified) for a desk intent opened for the pool — the existing receipt site, no new infrastructure',
    telemetry.includes("await recordPolicyPoolEvent({ kind: 'signed', ...base })") && telemetry.includes("if (verification === 'verified') await recordPolicyPoolEvent({ kind: 'mined', ...base })") && telemetry.includes('planNamesPolicyPool(deskIntent.plan)'))
  check('policy pool dispatch: the swap CASCADE (lib/swap-exec) never reaches the policy pool — only a named ask does',
    !swapExec.includes('policy-pool') && !swapExec.includes('buildPolicyPoolSwap') && POLICY_POOL_BUILD_PATH === 'native-swap-policy-pool')
}

if (process.argv[1]?.endsWith('policy-pool-builder-pins.ts')) {
  let failed = 0
  const check: Check = (name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  }
  policyPoolBuilderPins(check).then(() => {
    console.log(failed ? `\n${failed} failed` : '\nall policy pool builder pins green')
    process.exit(failed ? 1 : 0)
  })
}
