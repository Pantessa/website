// Pins for the creator share paid inside a swap (lib/creator-split,
// lib/creator-paid, the v3 + v4 guards). Pure: no server, no chain, no DB.
// Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/creator-split-pins.ts
import { encodeFunctionData, encodeAbiParameters, pad } from 'viem'
import { chainById } from '../lib/chains'
import { TREASURY_ADDRESS, SWAP_FEE_BPS, LINK_SWAP_FEE_BPS, swapFeeAtoms } from '../lib/fees'
import { creatorBpsFor, payableCreator, stableSideOf } from '../lib/creator-split'
import { creatorPaidUsdFromLogs, onchainClaimId } from '../lib/creator-paid'
import { ADDRESS_THIS, SWAP_ROUTER_02_ABI, guardUniswapV3Build, type V3GuardExpectations } from '../lib/uniswap-venue'
import { encodeV4SwapCalldata, guardUniswapV4Build } from '../lib/uniswap-v4'

type Check = (name: string, ok: boolean, extra?: string) => void

export function creatorSplitPins(check: Check): void {
  const base = chainById(8453)!
  const router = base.uniswap!.swapRouter02
  const USDC = Object.keys(base.stables).find((a) => base.stables[a] === 6)! as `0x${string}`
  const WETH = base.wrappedNative as `0x${string}`
  const USER = '0x1111111111111111111111111111111111111111' as const
  const CREATOR = '0x00000000000000000000000000000000c0ffee01' as const
  const OTHER = '0x00000000000000000000000000000000bad00bad' as const
  const deadline = Math.floor(Date.now() / 1000) + 600
  const enc = (functionName: string, args: readonly unknown[]) => encodeFunctionData({ abi: SWAP_ROUTER_02_ABI, functionName, args } as never) as `0x${string}`
  const tx = (calls: `0x${string}`[], value = '0') => ({ to: router as string, data: enc('multicall', [BigInt(deadline), calls]), value, chainId: 8453 })

  check('creator split: the creator share is half the tier in whole bps and the two halves sum to it (20 → 10, 50 → 25, 0 → 0)',
    creatorBpsFor(SWAP_FEE_BPS) * 2 === SWAP_FEE_BPS && creatorBpsFor(LINK_SWAP_FEE_BPS) === Math.floor(LINK_SWAP_FEE_BPS / 2) && creatorBpsFor(0) === 0 && creatorBpsFor(-5) === 0)
  check('creator split: the stable side is the input on a buy, the output on a sell, never native ETH out, and absent with no stable in the pair',
    stableSideOf(8453, USDC, WETH) === 'in' && stableSideOf(8453, WETH, USDC) === 'out' && stableSideOf(8453, USDC, WETH, true) === 'in' && stableSideOf(8453, WETH, OTHER) === null && stableSideOf(8453, OTHER, WETH, true) === null)
  check('creator split: a creator is payable only as a distinct party (never the trader, the treasury, the zero address, a router sentinel or a named router)',
    payableCreator(CREATOR, USER) === CREATOR && payableCreator(USER.toUpperCase().replace('0X', '0x'), USER) === null && payableCreator(TREASURY_ADDRESS, USER) === null &&
      payableCreator('0x0000000000000000000000000000000000000000', USER) === null && payableCreator(ADDRESS_THIS, USER) === null && payableCreator(router, USER, [router]) === null && payableCreator('nope', USER) === null && payableCreator(null, USER) === null)

  // ── v3, stable IN (a buy): pull → sweepToken → swap(rest) → treasury sweep
  const amountIn = BigInt(100_000_000) // 100 USDC
  const minOut = BigInt('36000000000000000')
  const fee = LINK_SWAP_FEE_BPS
  const cBps = creatorBpsFor(fee)
  const cut = swapFeeAtoms(amountIn, cBps)
  const expIn: V3GuardExpectations = { chainId: 8453, swapRouter02: router, sellToken: USDC, buyToken: WETH, sellIsEth: false, nativeOut: false, amountIn, minOut, poolFee: 500, recipient: USER, deadline, feeBps: fee, creator: { address: CREATOR, bps: cBps, side: 'in' } }
  const swapCall = (o: { amountIn?: bigint; tokenIn?: string; tokenOut?: string } = {}) =>
    enc('exactInputSingle', [{ tokenIn: o.tokenIn ?? USDC, tokenOut: o.tokenOut ?? WETH, fee: 500, recipient: ADDRESS_THIS, amountIn: o.amountIn ?? amountIn - cut, amountOutMinimum: minOut, sqrtPriceLimitX96: BigInt(0) }])
  const pull = (v = cut, t: string = USDC) => enc('pull', [t, v])
  const hand = (to: string = CREATOR, v = cut, t: string = USDC) => enc('sweepToken', [t, v, to])
  const treasurySweep = (bps = fee - cBps, min = minOut, to: string = USER, feeTo: string = TREASURY_ADDRESS, token: string = WETH) => enc('sweepTokenWithFee', [token, min, to, BigInt(bps), feeTo])
  const approve = { to: USDC as string, data: encodeFunctionData({ abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'a', type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const, functionName: 'approve', args: [router, amountIn] }), value: '0', chainId: 8453 }
  const g = (calls: `0x${string}`[], exp: V3GuardExpectations = expIn, withApprove = true) => guardUniswapV3Build({ swapTx: tx(calls), approveTx: withApprove ? approve : null }, exp)
  const good = g([pull(), hand(), swapCall(), treasurySweep()])
  check('creator split (v3, stable in): pull the cut → hand it to the creator → swap the rest → the treasury takes the other half; the approval still covers exactly the asked amount', good.ok && cut === BigInt(250_000), good.reasons.join(' '))
  const bad: [string, `0x${string}`[]][] = [
    ['the creator payout goes to another address', [pull(), hand(OTHER), swapCall(), treasurySweep()]],
    ['the pull is one atom more than the share', [pull(cut + BigInt(1)), hand(), swapCall(), treasurySweep()]],
    ['the pull is in another token', [pull(cut, WETH), hand(), swapCall(), treasurySweep()]],
    ['the swap still spends the FULL amount (cut taken twice)', [pull(), hand(), swapCall({ amountIn }), treasurySweep()]],
    ['the treasury still takes the WHOLE tier (fee charged 1.5 times)', [pull(), hand(), swapCall(), treasurySweep(fee)]],
    ['the creator leg is missing', [swapCall(), treasurySweep()]],
    ['the creator legs trail the swap', [swapCall(), treasurySweep(), pull(), hand()]],
    ['the fee recipient is the creator, not the treasury', [pull(), hand(), swapCall(), treasurySweep(fee - cBps, minOut, USER, CREATOR)]],
  ]
  const leaks = bad.filter(([, calls]) => g(calls).ok).map(([n]) => n)
  check(`creator split (v3, stable in): every tampered shape refuses (${bad.length} mutations)`, leaks.length === 0, leaks.join(' · '))
  const noCreator: V3GuardExpectations = { ...expIn, creator: undefined }
  check('creator split (v3): a creator leg nobody priced refuses, and the classic two-call build still passes at the full tier',
    !g([pull(), hand(), swapCall(), treasurySweep()], noCreator).ok && g([swapCall({ amountIn }), treasurySweep(fee)], noCreator).ok)
  check('creator split (v3): the expectation itself is fenced — a share that is not half the tier, a creator who is the recipient or the treasury, a share on the wrong side, or a share with the fee off all refuse',
    !g([pull(), hand(), swapCall(), treasurySweep()], { ...expIn, creator: { address: CREATOR, bps: cBps + 1, side: 'in' } }).ok &&
      !g([pull(), hand(USER), swapCall(), treasurySweep()], { ...expIn, creator: { address: USER, bps: cBps, side: 'in' } }).ok &&
      !g([pull(), hand(TREASURY_ADDRESS), swapCall(), treasurySweep()], { ...expIn, creator: { address: TREASURY_ADDRESS, bps: cBps, side: 'in' } }).ok &&
      !g([pull(), hand(), swapCall(), treasurySweep()], { ...expIn, creator: { address: CREATOR, bps: cBps, side: 'out' } }).ok &&
      !g([pull(), hand(), swapCall()], { ...expIn, feeBps: 0 }).ok)

  // ── v3, stable OUT (a sell): swap → creator bps (rest stays on the router) → treasury sweep
  const sellIn = BigInt('50000000000000000')
  const outMin = BigInt(130_000_000)
  const expOut: V3GuardExpectations = { chainId: 8453, swapRouter02: router, sellToken: WETH, buyToken: USDC, sellIsEth: true, nativeOut: false, amountIn: sellIn, minOut: outMin, poolFee: 500, recipient: USER, deadline, feeBps: fee, creator: { address: CREATOR, bps: cBps, side: 'out' } }
  const sellSwap = enc('exactInputSingle', [{ tokenIn: WETH, tokenOut: USDC, fee: 500, recipient: ADDRESS_THIS, amountIn: sellIn, amountOutMinimum: outMin, sqrtPriceLimitX96: BigInt(0) }])
  const creatorLeg = (rest: string = router, to: string = CREATOR, bps = cBps) => enc('sweepTokenWithFee', [USDC, outMin, rest, BigInt(bps), to])
  const afterCreator = outMin - swapFeeAtoms(outMin, cBps)
  const gOut = (calls: `0x${string}`[]) => guardUniswapV3Build({ swapTx: tx(calls, sellIn.toString()), approveTx: null }, expOut)
  const goodOut = gOut([sellSwap, creatorLeg(), treasurySweep(fee - cBps, afterCreator, USER, TREASURY_ADDRESS, USDC)])
  check('creator split (v3, stable out): the creator leg leaves the remainder on the pinned router and the last sweep pays the seller after both halves', goodOut.ok, goodOut.reasons.join(' '))
  const badOut: [string, `0x${string}`[]][] = [
    ['the remainder goes to a stranger instead of the router', [sellSwap, creatorLeg(OTHER), treasurySweep(fee - cBps, afterCreator, USER, TREASURY_ADDRESS, USDC)]],
    ['the remainder goes to the creator', [sellSwap, creatorLeg(CREATOR), treasurySweep(fee - cBps, afterCreator, USER, TREASURY_ADDRESS, USDC)]],
    ['the creator leg pays another address', [sellSwap, creatorLeg(router, OTHER), treasurySweep(fee - cBps, afterCreator, USER, TREASURY_ADDRESS, USDC)]],
    ['the creator leg takes the whole tier', [sellSwap, creatorLeg(router, CREATOR, fee), treasurySweep(fee - cBps, afterCreator, USER, TREASURY_ADDRESS, USDC)]],
    ['the last sweep keeps the pre-creator minimum', [sellSwap, creatorLeg(), treasurySweep(fee - cBps, outMin, USER, TREASURY_ADDRESS, USDC)]],
    ['the last sweep pays a stranger', [sellSwap, creatorLeg(), treasurySweep(fee - cBps, afterCreator, OTHER, TREASURY_ADDRESS, USDC)]],
    ['the creator leg is missing', [sellSwap, treasurySweep(fee, outMin, USER, TREASURY_ADDRESS, USDC)]],
  ]
  const leaksOut = badOut.filter(([, calls]) => gOut(calls).ok).map(([n]) => n)
  check(`creator split (v3, stable out): every tampered shape refuses (${badOut.length} mutations)`, leaksOut.length === 0, leaksOut.join(' · '))

  // ── v4 (stable out only): V4_SWAP → PAY_PORTION(creator) → PAY_PORTION(treasury) → SWEEP
  const hood = chainById(4663)
  if (hood?.uniswapV4) {
    const USDG = Object.keys(hood.stables)[0] as `0x${string}`
    const STOCK = '0x00000000000000000000000000000000000a0a01' as `0x${string}`
    const [currency0, currency1] = STOCK.toLowerCase() < USDG.toLowerCase() ? [STOCK, USDG] : [USDG, STOCK]
    const poolKey = { currency0, currency1, fee: 3000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000000' as `0x${string}` }
    const plan = { poolKey, zeroForOne: currency0 === STOCK, amountIn: BigInt(10) ** BigInt(18), minOut: BigInt(300_000_000), deadline }
    const v4exp = { chainId: 4663, universalRouter: hood.uniswapV4.universalRouter, permit2: hood.uniswapV4.permit2, sellToken: STOCK, buyToken: USDG, amountIn: plan.amountIn, minOut: plan.minOut, poolKey, permit2Expiration: deadline + 3600, feeBps: fee }
    const step = (data: `0x${string}`) => [{ label: 'swap', title: 'swap', tx: { to: hood.uniswapV4!.universalRouter as string, data, value: '0', chainId: 4663, action: 'swap' } }] as never
    const withCreator = encodeV4SwapCalldata({ ...plan, feeBps: fee, creator: { address: CREATOR, bps: cBps } })
    const classic = encodeV4SwapCalldata({ ...plan, feeBps: fee })
    const ok4 = guardUniswapV4Build(step(withCreator), { ...v4exp, creator: { address: CREATOR, bps: cBps, payer: USER } })
    check('creator split (v4, stable out): the creator PAY_PORTION leads, the treasury takes the rest of the tier, SWEEP pays the sender after both', ok4.ok, ok4.reasons.join(' '))
    check('creator split (v4): the wrong creator, a creator leg nobody priced, a missing creator leg, the payer as creator, and a share on a stable-IN pair all refuse',
      !guardUniswapV4Build(step(withCreator), { ...v4exp, creator: { address: OTHER, bps: cBps, payer: USER } }).ok &&
        !guardUniswapV4Build(step(withCreator), v4exp).ok &&
        !guardUniswapV4Build(step(classic), { ...v4exp, creator: { address: CREATOR, bps: cBps, payer: USER } }).ok &&
        !guardUniswapV4Build(step(withCreator), { ...v4exp, creator: { address: CREATOR, bps: cBps, payer: CREATOR } }).ok &&
        !guardUniswapV4Build(step(withCreator), { ...v4exp, sellToken: USDG, buyToken: STOCK, creator: { address: CREATOR, bps: cBps, payer: USER } }).ok &&
        guardUniswapV4Build(step(classic), v4exp).ok)
  }

  // ── The ledger's record of an on-chain payout reads the receipt, nothing else
  const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  const log = (token: string, from: string, to: string, atoms: bigint) => ({ address: token, topics: [TRANSFER, pad(from as `0x${string}`), pad(to as `0x${string}`)], data: encodeAbiParameters([{ type: 'uint256' }], [atoms]) })
  const facts = { router, creator: CREATOR, stables: base.stables }
  check('creator paid: only a registry stable moving from the router to the creator counts — the swap output, a transfer from the trader, a payment to someone else and a non-stable token are all $0',
    creatorPaidUsdFromLogs([log(USDC, router, CREATOR, BigInt(250_000))], facts) === 0.25 &&
      creatorPaidUsdFromLogs([log(USDC, USER, CREATOR, BigInt(250_000)), log(USDC, router, OTHER, BigInt(250_000)), log(WETH, router, CREATOR, BigInt(10) ** BigInt(18)), log(USDC, router, USER, BigInt(99_000_000))], facts) === 0 &&
      creatorPaidUsdFromLogs([log(USDC, router, CREATOR, BigInt(100_000)), log(USDC, router, CREATOR.toUpperCase().replace('0X', '0x'), BigInt(150_000))], facts) === 0.25)
  check('creator paid: one claim row per transaction, keyed on the lowercased hash, so a repeated beacon cannot record a payout twice',
    onchainClaimId('0xABCDEF') === 'onchain-0xabcdef')
}

// Runnable alone (argv guard: the harness imports this file).
if (process.argv[1]?.endsWith('creator-split-pins.ts')) {
  let pass = 0
  let fail = 0
  creatorSplitPins((name, ok, extra = '') => {
    if (ok) pass++
    else fail++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
