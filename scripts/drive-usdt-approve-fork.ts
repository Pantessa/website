// ─────────────────────────────────────────────────────────────────────────────
//  Fork drive: a USDT sell on Ethereum across the three allowance states.
//
//  Ethereum USDT's approve() reverts when the live allowance and the new
//  amount are both non-zero. This drive builds "swap 54.54 USDT for USDC on
//  Ethereum" with the REAL builder (lib/uniswap-venue) reading an anvil fork,
//  then sends every step the build returned, in order, from the wallet, and
//  reports what the chain did with each.
//
//    anvil --fork-url <ethereum rpc> --no-rate-limit --port 8745
//    FORK_RPC=http://127.0.0.1:8745 npx tsx scripts/drive-usdt-approve-fork.ts
//
//  Builder-agnostic on purpose (it sends resetTx when the build has one, and
//  doesn't mind when the field doesn't exist), so the same file run from a
//  checkout of the base shows the revert this branch fixes. Nothing here
//  touches a real network: every write goes to the fork.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createPublicClient, createTestClient, createWalletClient, erc20Abi, http, parseAbi, parseUnits } from 'viem'
import { mainnet } from 'viem/chains'

const FORK = process.env.FORK_RPC ?? 'http://127.0.0.1:8745'
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
const WALLET = '0x00000000000000000000000000000000000a11ce' as const
const WHALES = ['0xF977814e90dA44bFA03b6295A0616a897441aceC', '0x5a52E96BAcdaBb82fd05763E25335261B270Efcb', '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503'] as const
// USDT's approve/transfer return nothing; viem's erc20Abi expects a bool.
const usdtAbi = parseAbi(['function approve(address spender, uint256 amount)', 'function transfer(address to, uint256 amount)'])
const SELL = '54.54'

type Tx = { to: string; data: string; value?: string }

async function main() {
  // Point the registry's Ethereum client at the fork BEFORE the builder asks for it.
  const { chainById } = await import('@/lib/chains')
  const eth = chainById(1)!
  eth.rpcUrl = FORK
  eth.alchemyRpc = false
  const { buildUniswapSwap } = await import('@/lib/uniswap-venue')
  const router = eth.uniswap!.swapRouter02

  const pub = createPublicClient({ chain: mainnet, transport: http(FORK) })
  const test = createTestClient({ chain: mainnet, mode: 'anvil', transport: http(FORK) })
  const wallet = createWalletClient({ chain: mainnet, transport: http(FORK), account: WALLET })

  await test.setBalance({ address: WALLET, value: parseUnits('10', 18) })
  await test.impersonateAccount({ address: WALLET })
  let funded = false
  for (const whale of WHALES) {
    const bal = await pub.readContract({ address: USDT, abi: erc20Abi, functionName: 'balanceOf', args: [whale] })
    if (bal < parseUnits('200', 6)) continue
    await test.setBalance({ address: whale, value: parseUnits('1', 18) })
    await test.impersonateAccount({ address: whale })
    const w = createWalletClient({ chain: mainnet, transport: http(FORK), account: whale })
    const h = await w.writeContract({ address: USDT, abi: usdtAbi, functionName: 'transfer', args: [WALLET, parseUnits('200', 6)] })
    await pub.waitForTransactionReceipt({ hash: h })
    funded = true
    break
  }
  if (!funded) throw new Error('No USDT whale on the fork could fund the drive wallet.')

  const send = async (tx: Tx): Promise<'success' | 'reverted'> => {
    // Explicit gas: a wallet that skips estimation mines the revert, which is
    // what "reverts after the user signs" means.
    const hash = await wallet.sendTransaction({ to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(tx.value ?? '0'), gas: BigInt(600_000) })
    return (await pub.waitForTransactionReceipt({ hash })).status
  }

  const states: Array<{ name: string; allowance: string }> = [
    { name: 'no allowance', allowance: '0' },
    { name: 'partial allowance (10 USDT)', allowance: '10' },
    { name: `enough allowance (${SELL} USDT)`, allowance: SELL },
  ]
  let failures = 0
  for (const st of states) {
    const snap = await test.snapshot()
    if (st.allowance !== '0') {
      const h = await wallet.writeContract({ address: USDT, abi: usdtAbi, functionName: 'approve', args: [router, parseUnits(st.allowance, 6)] })
      await pub.waitForTransactionReceipt({ hash: h })
    }
    const usdcBefore = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [WALLET] })
    const built = (await buildUniswapSwap({ sellToken: 'USDT', buyToken: 'USDC', amountHuman: SELL, from: WALLET, chainId: 1 })) as Awaited<ReturnType<typeof buildUniswapSwap>> & { resetTx?: Tx | null }
    const steps: Array<{ label: string; tx: Tx }> = [
      ...(built.resetTx ? [{ label: 'approve(router, 0)', tx: built.resetTx }] : []),
      ...(built.approveTx ? [{ label: `approve(router, ${SELL})`, tx: built.approveTx }] : []),
      { label: 'swap', tx: built.swapTx },
    ]
    console.log(`\n── ${st.name} ── build: ${built.blocked ? 'BLOCKED' : 'ok'} · ${steps.map((s) => s.label).join(' → ')}`)
    let ok = !built.blocked
    for (const s of steps) {
      if (!ok) {
        console.log(`   ${s.label}: not sent (an earlier step failed)`)
        continue
      }
      const status = await send(s.tx)
      console.log(`   ${s.label}: ${status}`)
      if (status !== 'success') ok = false
    }
    const usdcAfter = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [WALLET] })
    const left = await pub.readContract({ address: USDT, abi: erc20Abi, functionName: 'allowance', args: [WALLET, router] })
    console.log(`   USDC received: ${(Number(usdcAfter - usdcBefore) / 1e6).toFixed(4)} · router allowance left: ${Number(left) / 1e6} USDT · ${ok ? 'SWAPPED' : 'FAILED'}`)
    if (!ok) failures++
    await test.revert({ id: snap })
    // evm_revert rewinds anvil's clock; put it back so the next deadline is live.
    await test.setNextBlockTimestamp({ timestamp: BigInt(Math.floor(Date.now() / 1000) + 5) }).catch(() => {})
  }
  console.log(`\n${failures === 0 ? 'ALL THREE STATES SWAPPED' : `${failures} of 3 states FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
