'use client'

// Sign & execute a Hyperliquid L1 action (the SignOrderButton twin for HL).
// The wallet signs the EIP-712 phantom-agent payload the server derived from
// the action; the relay (/api/hl/submit) recovers the signer, re-guards
// against the live market, re-gates the spend policy, and only then lets the
// venue see it. IOC orders settle instantly — no fill polling needed.

import { useState } from 'react'
import { useAccount, useSignTypedData } from 'wagmi'
import { CheckCircle2, ExternalLink, Loader2, PenLine } from 'lucide-react'
import type { Eip712OrderRequest } from '@/lib/transaction-layer'

type Status = 'idle' | 'signing' | 'submitting' | 'filled' | 'error'

export default function SignHlActionButton({
  order,
  onPlaced,
}: {
  order: Eip712OrderRequest
  onPlaced?: (info: { explorerUrl?: string; detail?: string; valueUsd?: number | null }) => void
}) {
  const { address } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [fill, setFill] = useState<{ totalSz: string; avgPx: string } | null>(null)
  const [explorerUrl, setExplorerUrl] = useState('')

  if (order.protocol !== 'hyperliquid' || !order.hl) return null
  const hl = order.hl

  const sign = async () => {
    if (!address) {
      setError('Connect your wallet first — it is your Hyperliquid account.')
      return
    }
    setError('')
    setStatus('signing')
    try {
      const td = order.typedData as { domain: object; types: object; primaryType: string; message: object }
      const signature = await signTypedDataAsync(td as Parameters<typeof signTypedDataAsync>[0])
      setStatus('submitting')
      const res = await fetch('/api/hl/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: hl.action,
          nonce: hl.nonce,
          isTestnet: hl.isTestnet,
          expected: hl.expected,
          signature,
          from: address,
        }),
      })
      const data = (await res.json()) as {
        status?: string
        filled?: { totalSz: string; avgPx: string } | null
        valueUsd?: number | null
        explorerUrl?: string
        error?: string
      }
      if (!res.ok) throw new Error(data.error || 'Submit failed.')
      setFill(data.filled ?? null)
      setExplorerUrl(data.explorerUrl ?? '')
      setStatus('filled')
      onPlaced?.({
        explorerUrl: data.explorerUrl,
        detail: data.filled ? `${hl.expected.kind} ${hl.expected.coin} filled ${data.filled.totalSz} @ ${data.filled.avgPx}` : `${hl.expected.kind} ${hl.expected.coin}`,
        valueUsd: data.valueUsd ?? null,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(/rejected|denied/i.test(msg) ? 'Signature request declined.' : msg || 'Order failed.')
      setStatus('error')
    }
  }

  const inFlight = status === 'signing' || status === 'submitting'

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      {status === 'filled' ? (
        <div className="flex items-center gap-2 text-[12px]">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="text-emerald-400 font-medium">
            {fill ? `Filled ${fill.totalSz} ${hl.expected.coin} @ ${fill.avgPx}` : 'Order accepted (unfilled — IOC expired)'}
          </span>
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" title="View on Hyperliquid"
              className="inline-flex items-center text-[color:var(--muted)] hover:text-[color:var(--fg)]">
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void sign()}
            disabled={inFlight}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white disabled:opacity-50 transition-colors"
            title="Sign this Hyperliquid order with your wallet and execute it"
          >
            {inFlight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
            {status === 'signing' ? 'Sign in wallet…' : status === 'submitting' ? 'Executing…' : status === 'error' ? 'Retry — sign & execute' : 'Sign & execute'}
          </button>
          {error && <span className="text-[12px] text-red-400">{error}</span>}
        </div>
      )}
    </div>
  )
}
