'use client'

// Trade a launched MCP token (x402-launch): BUY with ETH or SELL for ETH through
// the token's Flaunch Uniswap-v4 pool via @flaunch/sdk. Buy wraps flETH + routes
// the swap; sell uses Permit2 — Flaunch coins are auto-approved to Permit2, so a
// sell is just an optional permit SIGNATURE (when the Permit2 allowance is spent)
// + the sellCoin tx, no ERC20 approve. After buying, stake below to earn the rev
// share. Base Sepolia (LAUNCH_CHAIN). One-sign USDC→token→stake zap is the
// planned follow-up.
//
// Presentation is an exchange-style "ticket" (.tkt): segmented Buy/Sell, balance
// readout, big amount field with % chips, a debounced live "you receive ≈" quote
// from the Flaunch read SDK, and a full-width primary CTA.

import { useCallback, useEffect, useState } from 'react'
import { useAccount, useBalance, usePublicClient, useReadContract, useSwitchChain, useWalletClient } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatEther, formatUnits, parseEther, parseUnits, type Address } from 'viem'
import type { ReadWriteFlaunchSDK } from '@flaunch/sdk'
import { ERC20_ABI, LAUNCH_CHAIN, TOKEN_DECIMALS } from '@/lib/launch-contracts'

const SLIPPAGE = 15 // testnet pools are thin
const GAS_RESERVE = parseEther('0.0005') // leave headroom for gas on a "Max" buy
const QUOTE_DEBOUNCE_MS = 350
const PCTS = [25, 50, 75, 100] as const

const fmt = (v: number, max: number) => v.toLocaleString(undefined, { maximumFractionDigits: max })

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
  const [quote, setQuote] = useState<string | null>(null)

  const buying = mode === 'buy'
  const ethBal = eth.data?.value
  const tokBal = tokenBal.data as bigint | undefined

  const reset = (m: 'buy' | 'sell') => { setMode(m); setAmount(''); setError(null); setDone(null); setQuote(null) }

  const onAmount = (v: string) => {
    const cleaned = v.replace(/[^0-9.]/g, '')
    const parts = cleaned.split('.')
    setAmount(parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned)
    setDone(null)
  }

  // % chips compute off the relevant balance — buy leaves gas headroom on Max.
  const setPct = (pct: number) => {
    const frac = BigInt(pct)
    if (buying) {
      if (!ethBal) return
      const avail = ethBal > GAS_RESERVE ? ethBal - GAS_RESERVE : BigInt(0)
      setAmount(formatEther((avail * frac) / BigInt(100)))
    } else {
      if (tokBal === undefined) return
      setAmount(formatUnits((tokBal * frac) / BigInt(100), TOKEN_DECIMALS))
    }
    setDone(null)
  }

  // Debounced live quote: ETH in → coins out (buy) / coins in → ETH out (sell).
  useEffect(() => {
    setQuote(null)
    const a = amount.trim()
    if (!a || !publicClient || !(Number(a) > 0)) return
    let live = true
    const t = setTimeout(async () => {
      try {
        const { createFlaunch } = await import('@flaunch/sdk')
        const sdk = createFlaunch({ publicClient: publicClient as never })
        if (buying) {
          const out = await sdk.getBuyQuoteExactInput({ coinAddress: token as Address, amountIn: parseEther(a) })
          if (live) setQuote(`${fmt(Number(formatUnits(out, TOKEN_DECIMALS)), 2)} ${ticker}`)
        } else {
          const out = await sdk.getSellQuoteExactInput({ coinAddress: token as Address, amountIn: parseUnits(a, TOKEN_DECIMALS) })
          if (live) setQuote(`${fmt(Number(formatEther(out)), 6)} ETH`)
        }
      } catch {
        if (live) setQuote(null)
      }
    }, QUOTE_DEBOUNCE_MS)
    return () => { live = false; clearTimeout(t) }
  }, [amount, buying, publicClient, token, ticker])

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
        if (eth.data && wei + GAS_RESERVE > eth.data.value) throw new Error('Not enough ETH for the buy + gas.')
        setBusy('buy')
        const hash = await sdk.buyCoin({ coinAddress: token as Address, slippagePercent: SLIPPAGE, swapType: 'EXACT_IN', amountIn: wei })
        await publicClient.waitForTransactionReceipt({ hash })
        setDone(`Bought ${ticker}. Stake it below to start earning.`)
      } else {
        const wei = parseUnits((amount || '0').trim() || '0', TOKEN_DECIMALS)
        if (wei <= BigInt(0)) throw new Error(`Enter a ${ticker} amount.`)
        if (tokBal !== undefined && wei > tokBal) throw new Error(`You only hold ${formatUnits(tokBal, TOKEN_DECIMALS)} ${ticker}.`)
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
      setQuote(null)
      void eth.refetch()
      void tokenBal.refetch()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed.'
      setError(/rejected|denied|User /i.test(msg) ? 'Cancelled.' : msg.slice(0, 160))
    } finally {
      setBusy(null)
    }
  }, [mode, amount, eth, tokBal, tokenBal, walletClient, publicClient, address, token, ticker, switchChainAsync])

  if (!mounted) return null
  if (!isConnected) {
    return (
      <button className="tkt__cta mono" onClick={() => openConnectModal?.()}>
        Connect wallet to trade
      </button>
    )
  }

  const ctaLabel =
    busy === 'buy' ? 'Buying…'
    : busy === 'permit' ? 'Sign permit…'
    : busy === 'sell' ? 'Selling…'
    : buying ? `Buy ${ticker}` : `Sell ${ticker}`

  const balDisabled = buying ? !ethBal : tokBal === undefined

  return (
    <div className="tkt">
      <div className="tkt__tabs">
        <button className={`tkt__tab tkt__tab--buy mono${buying ? ' is-active' : ''}`} aria-pressed={buying} disabled={!!busy} onClick={() => reset('buy')}>Buy</button>
        <button className={`tkt__tab tkt__tab--sell mono${!buying ? ' is-active' : ''}`} aria-pressed={!buying} disabled={!!busy} onClick={() => reset('sell')}>Sell</button>
      </div>

      <div className="tkt__bal mono">
        <span className="tkt__ballbl">{buying ? 'your ETH' : `your ${ticker}`}</span>
        <span className="tkt__balval">
          {buying
            ? (eth.data ? fmt(Number(formatEther(eth.data.value)), 5) : '—')
            : (tokBal !== undefined ? fmt(Number(formatUnits(tokBal, TOKEN_DECIMALS)), 2) : '—')}
        </span>
      </div>

      <div className="tkt__field">
        <input
          className="tkt__input"
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          placeholder={buying ? 'ETH to spend' : `${ticker} to sell`}
          inputMode="decimal"
          disabled={!!busy}
          aria-label={buying ? 'ETH to spend' : `${ticker} to sell`}
        />
        <span className="tkt__suffix mono">{buying ? 'ETH' : ticker}</span>
      </div>

      <div className="tkt__chips">
        {PCTS.map((p) => (
          <button key={p} className="tkt__chip mono" disabled={!!busy || balDisabled} onClick={() => setPct(p)}>
            {p === 100 ? 'Max' : `${p}%`}
          </button>
        ))}
      </div>

      <div className="tkt__quote mono">
        <span className="tkt__quotelbl">you receive ≈</span>
        <span className="tkt__quoteval">{quote ?? '—'}</span>
      </div>

      <button className={`tkt__cta mono${buying ? '' : ' tkt__cta--sell'}`} disabled={!!busy || !amount} onClick={() => void trade()}>
        {ctaLabel}
      </button>

      <p className="tkt__note mono">
        {buying ? 'ETH' : ticker} → {buying ? ticker : 'ETH'} through the token&rsquo;s Uniswap&nbsp;v4 pool (~{SLIPPAGE}% slippage — testnet pools are thin).
      </p>
      {done && !error && <p className="tkt__msg tkt__msg--ok mono">{done}</p>}
      {error && <p className="tkt__msg tkt__msg--err mono">{error}</p>}
    </div>
  )
}
