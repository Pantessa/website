'use client'

// "Sign order" — turns a guardrailed CoW order (built by the swap fast-path,
// carried on Message.meta.orderRequest) into a wallet signature and relays it
// to the CoW order book via /api/cow/submit. The OWNER signs with their own
// wallet — the server never signs, and the submit route re-gates the spend
// policy before relaying. Mirrors SignVoteButton.

import { useState } from 'react'
import { useAccount, useSignTypedData } from 'wagmi'
import { Loader2, PenLine, CheckCircle2, ExternalLink } from 'lucide-react'
import type { Eip712OrderRequest } from '@/lib/transaction-layer'

type Status = 'idle' | 'signing' | 'submitting' | 'done' | 'error'

interface CowTypedData {
  domain: Record<string, unknown>
  primaryType: string
  types: Record<string, unknown>
  message: { receiver?: string; sellAmount?: string; buyAmount?: string; feeAmount?: string } & Record<string, unknown>
}

export default function SignOrderButton({ order, summary }: { order: Eip712OrderRequest; summary?: string }) {
  const { address, isConnected } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null)

  // Only CoW is submittable today; other protocols render nothing rather
  // than offering a button that can't finish.
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
      const signature = await signTypedDataAsync(
        typedData as unknown as Parameters<typeof signTypedDataAsync>[0],
      )
      setStatus('submitting')
      const res = await fetch('/api/cow/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chainId: order.chainId ?? 8453,
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
      setExplorerUrl(typeof data.explorerUrl === 'string' ? data.explorerUrl : null)
      setStatus('done')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Signing failed.'
      setError(/rejected|denied/i.test(msg) ? 'Signature rejected — nothing was placed.' : msg)
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div className="mt-2.5 pt-2 border-t border-[var(--line)] flex items-center gap-2 text-[12px]">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <span className="text-emerald-400 font-medium">Order placed</span>
        {summary && <span className="text-[color:var(--muted)] truncate">— {summary}</span>}
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[color:var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[color:var(--fg)] flex-shrink-0"
          >
            track <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => void sign()}
          disabled={status === 'signing' || status === 'submitting'}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white disabled:opacity-50 transition-colors"
          title="Sign this CoW order with your wallet and place it on the order book"
        >
          {status === 'signing' || status === 'submitting' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <PenLine className="w-3.5 h-3.5" />
          )}
          {status === 'signing' ? 'Sign in wallet…' : status === 'submitting' ? 'Placing order…' : 'Sign & place order'}
        </button>
        {error && <span className="text-[12px] text-red-400">{error}</span>}
      </div>
    </div>
  )
}
