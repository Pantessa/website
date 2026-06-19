'use client'

// Buy a launched MCP token with ETH (x402-launch). Swaps ETH → the coin through
// the token's Flaunch Uniswap-v4 pool via @flaunch/sdk (wraps flETH + routes the
// v4 swap internally), so a holder can then stake it for the rev share below.
// Base Sepolia (LAUNCH_CHAIN). USDC input + a one-sign zap-to-stake are the
// planned follow-up (needs a ZapStake contract + vault stakeFor).

import { useCallback, useEffect, useState } from 'react'
import { useAccount, useBalance, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatEther, parseEther, type Address } from 'viem'
import type { ReadWriteFlaunchSDK } from '@flaunch/sdk'
import { ERC20_ABI, LAUNCH_CHAIN } from '@/lib/launch-contracts'
import { useReadContract } from 'wagmi'

const btn = {
  background: 'var(--accent)',
  color: 'var(--ink)',
  border: 'none',
  borderRadius: 12,
  padding: '8px 14px',
  fontWeight: 600,
  cursor: 'pointer',
} as const
const note = { margin: 0, fontSize: 13, color: 'var(--smoke)' } as const

export default function BuyToken({ token }: { token: string }) {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient({ chainId: LAUNCH_CHAIN.id })
  const eth = useBalance({ address, chainId: LAUNCH_CHAIN.id, query: { enabled: !!address } })
  const symbol = useReadContract({ address: token as Address, abi: ERC20_ABI, functionName: 'symbol', chainId: LAUNCH_CHAIN.id })
  const ticker = (symbol.data as string | undefined) || 'token'

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const buy = useCallback(async () => {
    setError(null)
    setDone(null)
    try {
      const wei = parseEther((amount || '0').trim() || '0')
      if (wei <= BigInt(0)) throw new Error('Enter an ETH amount.')
      if (eth.data && wei + parseEther('0.0005') > eth.data.value) throw new Error('Not enough ETH for the buy + gas.')
      await switchChainAsync({ chainId: LAUNCH_CHAIN.id }).catch(() => {})
      if (!walletClient || !publicClient) throw new Error('Wallet not ready — try again.')
      setBusy(true)
      // Lazy-load the SDK so it never touches SSR / the initial bundle.
      const { createFlaunch } = await import('@flaunch/sdk')
      const sdk = createFlaunch({ publicClient, walletClient }) as ReadWriteFlaunchSDK
      const hash = await sdk.buyCoin({ coinAddress: token as Address, slippagePercent: 15, swapType: 'EXACT_IN', amountIn: wei })
      await publicClient.waitForTransactionReceipt({ hash })
      setAmount('')
      setDone(`Bought ${ticker}. Stake it below to start earning the rev share.`)
      void eth.refetch()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed.'
      setError(/rejected|denied|User /i.test(msg) ? 'Cancelled.' : msg.slice(0, 160))
    } finally {
      setBusy(false)
    }
  }, [amount, eth, walletClient, publicClient, token, ticker, switchChainAsync])

  if (!mounted) return null
  if (!isConnected) {
    return (
      <button style={btn} className="mono" onClick={() => openConnectModal?.()}>
        Connect wallet to buy
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono" style={{ fontSize: 14 }}>
        <span style={{ color: 'var(--smoke)' }}>your ETH </span>
        {eth.data ? Number(formatEther(eth.data.value)).toLocaleString(undefined, { maximumFractionDigits: 5 }) : '—'}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="ETH to spend"
          inputMode="decimal"
          disabled={busy}
          className="mono"
          style={{ width: 150, minWidth: 0, border: '1px solid var(--mist)', borderRadius: 10, padding: '8px 11px', background: 'var(--paper)', color: 'var(--ink)' }}
        />
        <button style={btn} className="mono" disabled={busy || !amount} onClick={() => void buy()}>
          {busy ? 'Buying…' : `Buy ${ticker}`}
        </button>
      </div>
      <p className="mono" style={note}>
        Swaps ETH → {ticker} through the token&rsquo;s Uniswap&nbsp;v4 pool (~15% slippage — testnet pools are thin).
      </p>
      {done && !error && <p className="mono" style={{ ...note, color: 'var(--accent)' }}>{done}</p>}
      {error && <p className="mono" style={{ ...note, color: 'var(--error, #C0392B)' }}>{error}</p>}
    </div>
  )
}
