'use client'

// Trade a launched MCP token (x402-launch): BUY with ETH or SELL for ETH through
// the token's Flaunch Uniswap-v4 pool via @flaunch/sdk. Buy wraps flETH + routes
// the swap; sell uses Permit2 — Flaunch coins are auto-approved to Permit2, so a
// sell is just an optional permit SIGNATURE (when the Permit2 allowance is spent)
// + the sellCoin tx, no ERC20 approve. After buying, stake below to earn the rev
// share. Base Sepolia (LAUNCH_CHAIN). One-sign USDC→token→stake zap is the
// planned follow-up.

import { useCallback, useEffect, useState } from 'react'
import { useAccount, useBalance, usePublicClient, useReadContract, useSwitchChain, useWalletClient } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatEther, formatUnits, parseEther, parseUnits, type Address } from 'viem'
import type { ReadWriteFlaunchSDK } from '@flaunch/sdk'
import { ERC20_ABI, LAUNCH_CHAIN, TOKEN_DECIMALS } from '@/lib/launch-contracts'

const SLIPPAGE = 15 // testnet pools are thin
const tab = (active: boolean) =>
  ({
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--smoke)',
    border: active ? 'none' : '1px solid var(--mist)',
    borderRadius: 10,
    padding: '6px 16px',
    fontWeight: 600,
    cursor: 'pointer',
  }) as const
const btn = { background: 'var(--accent)', color: 'var(--ink)', border: 'none', borderRadius: 12, padding: '8px 14px', fontWeight: 600, cursor: 'pointer' } as const
const note = { margin: 0, fontSize: 13, color: 'var(--smoke)' } as const

export default function TradeToken({ token }: { token: string }) {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient({ chainId: LAUNCH_CHAIN.id })
  const eth = useBalance({ address, chainId: LAUNCH_CHAIN.id, query: { enabled: !!address } })
  const symbol = useReadContract({ address: token as Address, abi: ERC20_ABI, functionName: 'symbol', chainId: LAUNCH_CHAIN.id })
  const tokenBal = useReadContract({ address: token as Address, abi: ERC20_ABI, functionName: 'balanceOf', args: [address as Address], chainId: LAUNCH_CHAIN.id, query: { enabled: !!address } })
  const ticker = (symbol.data as string | undefined) || 'token'

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [mode, setMode] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const trade = useCallback(async () => {
    setError(null)
    setDone(null)
    try {
      await switchChainAsync({ chainId: LAUNCH_CHAIN.id }).catch(() => {})
      if (!walletClient || !publicClient || !address) throw new Error('Wallet not ready — try again.')
      const { createFlaunch } = await import('@flaunch/sdk')
      // Cast to the SDK's own param type — it bundles a separate viem, so the
      // wagmi clients are structurally identical but nominally "unrelated".
      const sdk = createFlaunch({ publicClient: publicClient as never, walletClient: walletClient as never }) as ReadWriteFlaunchSDK

      if (mode === 'buy') {
        const wei = parseEther((amount || '0').trim() || '0')
        if (wei <= BigInt(0)) throw new Error('Enter an ETH amount.')
        if (eth.data && wei + parseEther('0.0005') > eth.data.value) throw new Error('Not enough ETH for the buy + gas.')
        setBusy('buy')
        const hash = await sdk.buyCoin({ coinAddress: token as Address, slippagePercent: SLIPPAGE, swapType: 'EXACT_IN', amountIn: wei })
        await publicClient.waitForTransactionReceipt({ hash })
        setDone(`Bought ${ticker}. Stake it below to start earning.`)
      } else {
        const wei = parseUnits((amount || '0').trim() || '0', TOKEN_DECIMALS)
        if (wei <= BigInt(0)) throw new Error(`Enter a ${ticker} amount.`)
        const bal = tokenBal.data as bigint | undefined
        if (bal !== undefined && wei > bal) throw new Error(`You only hold ${formatUnits(bal, TOKEN_DECIMALS)} ${ticker}.`)
        // Flaunch coins are auto-approved to Permit2 — only sign a permit when the
        // Permit2 allowance is short; then sell.
        const { allowance } = await sdk.getPermit2AllowanceAndNonce(token as Address)
        let permit: { permitSingle: unknown; signature: `0x${string}` } | null = null
        if (allowance < wei) {
          setBusy('permit')
          const { typedData, permitSingle } = await sdk.getPermit2TypedData(token as Address)
          const signature = await walletClient.signTypedData({
            account: address,
            domain: typedData.domain,
            types: typedData.types,
            primaryType: typedData.primaryType as string,
            message: typedData.message,
          } as Parameters<typeof walletClient.signTypedData>[0])
          permit = { permitSingle, signature }
        }
        setBusy('sell')
        const hash = await sdk.sellCoin({
          coinAddress: token as Address,
          amountIn: wei,
          slippagePercent: SLIPPAGE,
          ...(permit ? { permitSingle: permit.permitSingle as never, signature: permit.signature } : {}),
        })
        await publicClient.waitForTransactionReceipt({ hash })
        setDone(`Sold ${ticker} for ETH.`)
      }
      setAmount('')
      void eth.refetch()
      void tokenBal.refetch()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed.'
      setError(/rejected|denied|User /i.test(msg) ? 'Cancelled.' : msg.slice(0, 160))
    } finally {
      setBusy(null)
    }
  }, [mode, amount, eth, tokenBal, walletClient, publicClient, address, token, ticker, switchChainAsync])

  if (!mounted) return null
  if (!isConnected) {
    return (
      <button style={btn} className="mono" onClick={() => openConnectModal?.()}>
        Connect wallet to trade
      </button>
    )
  }

  const buying = mode === 'buy'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={tab(buying)} className="mono" disabled={!!busy} onClick={() => { setMode('buy'); setAmount(''); setError(null); setDone(null) }}>Buy</button>
        <button style={tab(!buying)} className="mono" disabled={!!busy} onClick={() => { setMode('sell'); setAmount(''); setError(null); setDone(null) }}>Sell</button>
      </div>
      <div className="mono" style={{ fontSize: 14 }}>
        {buying ? (
          <><span style={{ color: 'var(--smoke)' }}>your ETH </span>{eth.data ? Number(formatEther(eth.data.value)).toLocaleString(undefined, { maximumFractionDigits: 5 }) : '—'}</>
        ) : (
          <><span style={{ color: 'var(--smoke)' }}>your {ticker} </span>{tokenBal.data !== undefined ? Number(formatUnits(tokenBal.data as bigint, TOKEN_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder={buying ? 'ETH to spend' : `${ticker} to sell`}
          inputMode="decimal"
          disabled={!!busy}
          className="mono"
          style={{ width: 150, minWidth: 0, border: '1px solid var(--mist)', borderRadius: 10, padding: '8px 11px', background: 'var(--paper)', color: 'var(--ink)' }}
        />
        <button style={btn} className="mono" disabled={!!busy || !amount} onClick={() => void trade()}>
          {busy === 'buy' ? 'Buying…' : busy === 'permit' ? 'Sign permit…' : busy === 'sell' ? 'Selling…' : buying ? `Buy ${ticker}` : `Sell ${ticker}`}
        </button>
      </div>
      <p className="mono" style={note}>
        {buying ? 'ETH' : ticker} → {buying ? ticker : 'ETH'} through the token&rsquo;s Uniswap&nbsp;v4 pool (~{SLIPPAGE}% slippage — testnet pools are thin).
      </p>
      {done && !error && <p className="mono" style={{ ...note, color: 'var(--accent)' }}>{done}</p>}
      {error && <p className="mono" style={{ ...note, color: 'var(--error, #C0392B)' }}>{error}</p>}
    </div>
  )
}
