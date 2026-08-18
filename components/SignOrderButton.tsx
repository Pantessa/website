'use client'

// "Sign order" — turns a guardrailed CoW order (built by the swap fast-path,
// carried on Message.meta.orderRequest) into a wallet signature and relays it
// to the CoW order book via /api/cow/submit. The OWNER signs with their own
// wallet — the server never signs, and the submit route re-gates the spend
// policy before relaying.
//
// Progress is a real stepper: Sign → Place → Open → Filled. After placement we
// poll the order book's trades endpoint for the solver fill and link the
// actual Basescan settlement transaction. CoW-specific by design — on-chain
// `send_transaction` payloads (Uniswap et al.) render via <SendTxButton>.

import { useEffect, useRef, useState } from 'react'
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi'
import { Loader2, PenLine, CheckCircle2, Circle, ExternalLink } from 'lucide-react'
import type { Eip712OrderRequest } from '@/lib/transaction-layer'
import { reportWalletRefusal, walletErrorWords } from '@/lib/wallet-refusal'
import { SIGN_CTA_CLASS } from '@/lib/sign-cta'

type Status = 'idle' | 'signing' | 'placing' | 'open' | 'filled' | 'error'

const STEPS: Array<{ key: Status; label: string }> = [
  { key: 'signing', label: 'Sign' },
  { key: 'placing', label: 'Place' },
  { key: 'open', label: 'On the book' },
  { key: 'filled', label: 'Filled' },
]
const ORDER = ['idle', 'signing', 'placing', 'open', 'filled'] as const

const TX_EXPLORER: Record<number, string> = {
  8453: 'https://basescan.org/tx/',
  1: 'https://etherscan.io/tx/',
  42161: 'https://arbiscan.io/tx/',
}

interface CowTypedData {
  domain: Record<string, unknown>
  primaryType: string
  types: Record<string, unknown>
  message: { receiver?: string; sellAmount?: string; buyAmount?: string; feeAmount?: string } & Record<string, unknown>
}

export default function SignOrderButton({
  order,
  summary,
  onPlaced,
}: {
  order: Eip712OrderRequest
  summary?: string
  /** Fires once the signed order lands on the book (status → 'open') — the
   *  embed bridge relays it to the host page as an 'order-signed' event. */
  onPlaced?: (info: { orderUid: string | null; explorerUrl: string | null }) => void
}) {
  const { address, isConnected, connector, chain: connectedChain } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const { switchChainAsync } = useSwitchChain()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null)
  const [orderUid, setOrderUid] = useState<string | null>(null)
  const [fillTx, setFillTx] = useState<string | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const chainId = order.chainId ?? 8453
  // ".../api/v1/orders" → the API base we poll trades on.
  const apiBase = order.submitUrl?.replace(/\/api\/v1\/orders\/?$/, '') ?? 'https://api.cow.fi/base'

  // Poll for the solver fill once the order is on the book (5s cadence, ~3min
  // cap — a limit order legitimately stays open longer; the explorer link
  // keeps tracking after we stop).
  useEffect(() => {
    if (status !== 'open' || !orderUid) return
    let tries = 0
    pollTimer.current = setInterval(async () => {
      tries += 1
      if (tries > 36 && pollTimer.current) {
        clearInterval(pollTimer.current)
        return
      }
      try {
        const res = await fetch(`${apiBase}/api/v1/trades?orderUid=${orderUid}`)
        if (!res.ok) return
        const trades = (await res.json()) as Array<{ txHash?: string }>
        const tx = trades.find((t) => typeof t.txHash === 'string')?.txHash
        if (tx) {
          setFillTx(tx)
          setStatus('filled')
          if (pollTimer.current) clearInterval(pollTimer.current)
        }
      } catch {
        /* transient poll failure — keep trying */
      }
    }, 5000)
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [status, orderUid, apiBase])

  // Only CoW is submittable here; other protocols render nothing rather than
  // offering a button that can't finish.
  if (order.protocol !== 'cow') return null
  const typedData = order.typedData as CowTypedData
  const receiver = typeof typedData?.message?.receiver === 'string' ? typedData.message.receiver : ''

  const sign = async () => {
    setError('')
    if (!isConnected || !address) {
      setError('Connect the wallet that owns this order first.')
      return
    }
    // Guardrails pinned receiver = requester, so the signer must be the receiver.
    if (receiver && address.toLowerCase() !== receiver.toLowerCase()) {
      setError(`Connected wallet ${address.slice(0, 6)}… ≠ order owner ${receiver.slice(0, 6)}…`)
      return
    }
    try {
      setStatus('signing')
      // The order's EIP-712 domain carries chainId — Coinbase Wallet refuses
      // typed-data signatures when the active network doesn't match (and
      // reports it as "User rejected"). No-op when already on Base; same
      // switch-then-act idiom as LaunchToken/StakeToken.
      await switchChainAsync({ chainId }).catch(() => {})
      let signature: `0x${string}`
      try {
        signature = await signTypedDataAsync(
          typedData as unknown as Parameters<typeof signTypedDataAsync>[0],
        )
      } catch (e) {
        // The WALLET refused the typed data (chain mismatch, unsupported
        // method, estimate…) — file it as a wallet-refused row so it reaches
        // /dashboard/failures; a human "no" is dropped inside the beacon.
        // Relay errors below are the order book's, not the wallet's.
        reportWalletRefusal({
          wallet: address, artifact: 'cow-order', buildPath: 'native-swap-cow',
          connector: connector?.id ?? connector?.name, chainId: connectedChain?.id,
          ask: summary ?? 'CoW order', detail: walletErrorWords(e),
        })
        throw e
      }
      setStatus('placing')
      const res = await fetch('/api/cow/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chainId,
          order: typedData.message,
          signature,
          from: address,
          appDataJson: order.appDataJson,
          quoteId: order.quoteId,
          mode: typedData.message.feeAmount === '0' ? 'limit' : 'swap',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Order rejected.')
      const placedExplorerUrl = typeof data.explorerUrl === 'string' ? data.explorerUrl : null
      const placedOrderUid = typeof data.orderUid === 'string' ? data.orderUid : null
      setExplorerUrl(placedExplorerUrl)
      setOrderUid(placedOrderUid)
      setStatus('open')
      onPlaced?.({ orderUid: placedOrderUid, explorerUrl: placedExplorerUrl })
    } catch (e) {
      const msg = e instanceof Error ? walletErrorWords(e) : 'Signing failed.'
      setError(
        /rejected|denied/i.test(msg)
          ? 'Signature rejected in the wallet — nothing was placed. (If you didn’t cancel: check the wallet is on Base.)'
          : msg,
      )
      setStatus('error')
    }
  }

  const stepState = (step: Status): 'done' | 'active' | 'pending' => {
    if (status === 'filled') return 'done' // terminal — every step completed
    const cur = ORDER.indexOf(status === 'error' ? 'idle' : (status as (typeof ORDER)[number]))
    const idx = ORDER.indexOf(step as (typeof ORDER)[number])
    if (idx < cur) return 'done'
    if (idx === cur) return 'active'
    return 'pending'
  }

  const inFlight = status === 'signing' || status === 'placing'
  const started = status !== 'idle' && status !== 'error'

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      {/* Progress stepper — visible once signing starts */}
      {started && (
        <div className="flex items-center gap-1.5 text-[11px] mono flex-wrap">
          {STEPS.map((s, i) => {
            const st = stepState(s.key)
            return (
              <span key={s.key} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-[color:var(--line-2)] px-0.5">—</span>}
                {st === 'done' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : st === 'active' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[color:var(--fg)]" />
                ) : (
                  <Circle className="w-3 h-3 text-[color:var(--line-2)]" />
                )}
                <span className={st === 'pending' ? 'text-[color:var(--muted-2)]' : 'text-[color:var(--fg)]'}>
                  {s.label}
                </span>
                {s.key === 'open' && explorerUrl && st !== 'pending' && (
                  <a href={explorerUrl} target="_blank" rel="noopener noreferrer" title="Track the order on CoW Explorer"
                    className="inline-flex items-center text-[color:var(--muted)] hover:text-[color:var(--fg)]">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {s.key === 'filled' && fillTx && (
                  <a href={`${TX_EXPLORER[chainId] ?? TX_EXPLORER[8453]}${fillTx}`} target="_blank" rel="noopener noreferrer"
                    title="Settlement transaction on Basescan"
                    className="inline-flex items-center text-[color:var(--muted)] hover:text-[color:var(--fg)]">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </span>
            )
          })}
        </div>
      )}

      {status === 'filled' ? (
        <div className="flex items-center gap-2 text-[12px]">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="text-emerald-400 font-medium">Swap settled on-chain</span>
          {summary && <span className="text-[color:var(--muted)] truncate">— {summary}</span>}
        </div>
      ) : status === 'open' ? (
        <div className="flex items-center gap-2 text-[12px] text-[color:var(--muted)]">
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
          Order is live on the book — waiting for a solver to fill it…
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void sign()}
            disabled={inFlight}
            className={SIGN_CTA_CLASS}
            title="Sign this CoW order with your wallet and place it on the order book"
          >
            {inFlight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
            {status === 'signing' ? 'Confirm in your wallet…' : status === 'placing' ? 'Placing order…' : status === 'error' ? 'Retry — sign & place order' : 'Sign & place order'}
          </button>
          {error && <span className="text-[12px] text-red-400">{error}</span>}
        </div>
      )}
    </div>
  )
}
