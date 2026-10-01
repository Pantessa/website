// Read-only proof that the creator share pays out on-chain (lib/creator-split).
// Builds the REAL swap with a stand-in creator, then simulates it with
// eth_call from Multicall3 (balance / allowance state overrides, nothing is
// sent) and reads every party's balance before and after in the same call.
//
//   npm run probe:creator-split
//
// Stable IN  (USDC → WETH on Base): the creator gets its cut of the input.
// Stable OUT (ETH → each registry stable, every chain): the creator's leg
// leaves the remainder on the router, which is a transfer from the router to
// itself — the one thing here a token contract could refuse. Exit 1 if any
// row fails or the router keeps a balance.
import { encodeFunctionData, decodeFunctionResult, erc20Abi, keccak256, encodeAbiParameters, pad, toHex, parseEther } from 'viem'
import { publicClientFor, chainById, APP_CHAINS } from '@/lib/chains'
import { resolveToken } from '@/lib/cow'
import { buildUniswapSwap } from '@/lib/uniswap-venue'
import { TREASURY_ADDRESS } from '@/lib/fees'

const MC3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const
const CREATOR = '0x00000000000000000000000000000000c0ffee01' as const
const mc3Abi = [{ name: 'aggregate3Value', type: 'function', stateMutability: 'payable', inputs: [{ name: 'calls', type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'allowFailure', type: 'bool' }, { name: 'value', type: 'uint256' }, { name: 'callData', type: 'bytes' }] }], outputs: [{ name: 'r', type: 'tuple[]', components: [{ name: 'success', type: 'bool' }, { name: 'returnData', type: 'bytes' }] }] }] as const
const slot = (key: string, s: bigint) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [key as `0x${string}`, s]))
const slot2 = (owner: string, spender: string, s: bigint) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [spender as `0x${string}`, slot(owner, s)]))

let failed = 0
const ZERO = BigInt(0)
type Row = { creator: bigint; treasury: bigint; trader: bigint; router: bigint }

async function simulate(chainId: number, sell: string, buy: string, amount: string, feeBps: number, override?: { token: string; balanceSlot: bigint; allowanceSlot: bigint }): Promise<{ row: Row; side: string; guard: boolean }> {
  const client = publicClientFor(chainId)!
  const built = await buildUniswapSwap({ sellToken: sell, buyToken: buy, amountHuman: amount, from: MC3, chainId, feeBps, creator: CREATOR })
  const stable = resolveToken(built.creatorPaid?.side === 'in' ? sell : buy, chainId)!
  const who = [CREATOR, TREASURY_ADDRESS, MC3, built.swapTx.to]
  const bal = (w: string) => ({ target: stable as `0x${string}`, allowFailure: false, value: ZERO, callData: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [w as `0x${string}`] }) })
  const value = BigInt(built.swapTx.value)
  const data = encodeFunctionData({ abi: mc3Abi, functionName: 'aggregate3Value', args: [[...who.map(bal), { target: built.swapTx.to as `0x${string}`, allowFailure: false, value, callData: built.swapTx.data as `0x${string}` }, ...who.map(bal)]] })
  const big = pad(toHex(BigInt(10) ** BigInt(12)), { size: 32 })
  const res = await client.call({
    account: MC3, to: MC3, data, value,
    stateOverride: [
      { address: MC3, balance: parseEther('10') },
      ...(override ? [{ address: override.token as `0x${string}`, stateDiff: [{ slot: slot(MC3, override.balanceSlot), value: big }, { slot: slot2(MC3, built.swapTx.to, override.allowanceSlot), value: big }] }] : []),
    ],
  })
  const out = decodeFunctionResult({ abi: mc3Abi, functionName: 'aggregate3Value', data: res.data! })
  const d = who.map((_, i) => BigInt(out[who.length + 1 + i].returnData) - BigInt(out[i].returnData))
  return { row: { creator: d[0], treasury: d[1], trader: d[2], router: d[3] }, side: built.creatorPaid?.side ?? 'none', guard: !!built.guardrails.checks.find((k) => k.id === 'calldata')?.ok }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    // No database here: the builder's spend-grant read answers "no grant".
    process.env.DATABASE_URL = 'postgresql://probe:probe@localhost:1/probe'
    const { default: prisma } = await import('@/lib/db')
    Object.defineProperty(prisma, 'spendGrant', { value: { findFirst: async () => null }, configurable: true })
  }
  // Stable IN — Base USDC (FiatToken: balances slot 9, allowances slot 10).
  for (const feeBps of [20, 50]) {
    try {
      const usdc = resolveToken('USDC', 8453)!
      const r = await simulate(8453, 'USDC', 'WETH', '100', feeBps, { token: usdc, balanceSlot: BigInt(9), allowanceSlot: BigInt(10) })
      const want = BigInt(100_000_000 * (feeBps / 2)) / BigInt(10_000)
      const ok = r.guard && r.side === 'in' && r.row.creator === want && r.row.trader === -BigInt(100_000_000) && r.row.router === ZERO
      if (!ok) failed++
      console.log(`${ok ? 'OK  ' : 'FAIL'} Base             100 USDC→WETH at ${feeBps}bps  creator +${r.row.creator} USDC atoms (want ${want}) · trader ${r.row.trader} · router ${r.row.router}`)
    } catch (e) { failed++; console.log(`FAIL Base USDC→WETH at ${feeBps}bps: ${String((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message).slice(0, 140)}`) }
  }
  // Stable OUT — every registry stable with a v3 pool against native ETH.
  for (const c of APP_CHAINS) for (const st of ['USDC', 'USDT', 'DAI', 'USDG', 'USDC.e']) {
    const addr = resolveToken(st, c.id)
    if (!c.uniswap || !addr || c.stables[addr.toLowerCase()] === undefined || !resolveToken('ETH', c.id)) continue
    try {
      const r = await simulate(c.id, 'ETH', st, '0.01', 50)
      const ok = r.guard && r.side === 'out' && r.row.creator > ZERO && r.row.treasury > ZERO && r.row.trader > ZERO && r.row.router === ZERO
      if (!ok) failed++
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.name.padEnd(16)} 0.01 ETH→${st.padEnd(6)} creator +${r.row.creator} · treasury +${r.row.treasury} · trader +${r.row.trader} · router ${r.row.router}`)
    } catch (e) {
      const msg = String((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message)
      if (/No Uniswap v3 pool/.test(msg)) console.log(`skip ${c.name.padEnd(16)} ETH→${st}: no v3 pool`)
      else { failed++; console.log(`FAIL ${c.name.padEnd(16)} ETH→${st}: ${msg.slice(0, 140)}`) }
    }
  }
  console.log(failed ? `\n${failed} row(s) failed` : '\nall rows pay the creator, the treasury and the trader; no router keeps a balance')
  process.exit(failed ? 1 : 0)
}
main()
