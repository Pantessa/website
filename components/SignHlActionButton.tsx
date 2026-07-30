'use client'

// Sign & execute a Hyperliquid L1 action (the SignOrderButton twin for HL).
// The wallet signs the EIP-712 phantom-agent payload the server derived from
// the action; the relay (/api/hl/submit) recovers the signer, re-guards
// against the live market, re-gates the spend policy, and only then lets the
// venue see it. IOC orders settle instantly — no fill polling needed.
//
// Up to three signatures ride one card, each behind its OWN user gesture (a
// popup fired after an awaited submit is the known Coinbase second-signature
// breaker): 1) the one-time builder-fee cap approval (user-signed, built
// CLIENT-side because its EIP-712 domain carries the wallet's chainId),
// 2) the guarded leverage set on explicit-leverage asks, 3) the order.
// The card self-advances as each lands.

import { useState } from 'react'
import { useAccount, useChainId, useSignTypedData } from 'wagmi'
import { CheckCircle2, ExternalLink, Loader2, PenLine } from 'lucide-react'
import type { Eip712OrderRequest } from '@/lib/transaction-layer'
import { approveBuilderFeeArtifacts } from '@/lib/hyperliquid-exec'

type Status = 'idle' | 'signing' | 'submitting' | 'filled' | 'error'

export default function SignHlActionButton({
  order,
  onPlaced,
}: {
  order: Eip712OrderRequest
  onPlaced?: (info: { explorerUrl?: string; detail?: string; valueUsd?: number | null }) => void
}) {
  const { address } = useAccount()
  const chainId = useChainId()
  const { signTypedDataAsync } = useSignTypedData()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [fill, setFill] = useState<{ totalSz: string; avgPx: string } | null>(null)
  const [explorerUrl, setExplorerUrl] = useState('')
  const [feeDone, setFeeDone] = useState(false)
  const [preDone, setPreDone] = useState(false)

  if (order.protocol !== 'hyperliquid' || !order.hl) return null
  const hl = order.hl
  const feeStep = hl.feeApproval && !feeDone ? hl.feeApproval : null
  const pre = !feeStep && hl.pre && !preDone ? hl.pre : null
  // Step numbering over whichever extras this build carries.
  const totalSteps = 1 + (hl.feeApproval ? 1 : 0) + (hl.pre ? 1 : 0)
  const currentStep = feeStep ? 1 : pre ? 1 + (hl.feeApproval ? 1 : 0) : totalSteps

  const signFee = async () => {
    if (!address || !hl.feeApproval) {
      setError(address ? 'Missing fee-approval step.' : 'Connect your wallet first — it is your Hyperliquid account.')
      return
    }
    setError('')
    setStatus('signing')
    try {
      // Built HERE because the user-signed domain pins the wallet's chainId;
      // the relay re-derives the same payload from the action and re-guards
      // recipient + rate before the venue sees it.
      const { action, typedData } = approveBuilderFeeArtifacts({ nonce: Date.now(), signatureChainId: chainId, isTestnet: hl.isTestnet })
      const message = { ...typedData.message, nonce: BigInt(action.nonce) }
      const signature = await signTypedDataAsync({ ...typedData, message } as Parameters<typeof signTypedDataAsync>[0])
      setStatus('submitting')
      const res = await fetch('/api/hl/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, nonce: action.nonce, isTestnet: hl.isTestnet, signature, from: address }),
      })
      const data = (await res.json()) as { status?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Fee approval failed.')
      setFeeDone(true)
      setStatus('idle')
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(/rejected|denied/i.test(msg) ? 'Signature request declined.' : msg || 'Fee approval failed.')
      setStatus('error')
    }
  }

  const signPre = async () => {
    if (!address || !hl.pre) {
      setError(address ? 'Missing leverage step.' : 'Connect your wallet first — it is your Hyperliquid account.')
      return
    }
    setError('')
    setStatus('signing')
    try {
      const td = hl.pre.typedData as { domain: object; types: object; primaryType: string; message: object }
      const signature = await signTypedDataAsync(td as Parameters<typeof signTypedDataAsync>[0])
      setStatus('submitting')
      const res = await fetch('/api/hl/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: hl.pre.action,
          nonce: hl.pre.nonce,
          isTestnet: hl.isTestnet,
          expected: hl.pre.expected,
          signature,
          from: address,
        }),
      })
      const data = (await res.json()) as { status?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Leverage update failed.')
      setPreDone(true)
      setStatus('idle')
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(/rejected|denied/i.test(msg) ? 'Signature request declined.' : msg || 'Leverage update failed.')
      setStatus('error')
    }
  }

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
  const retry = status === 'error' ? 'Retry — sign' : 'Sign'
  const stepTag = totalSteps > 1 ? ` ${currentStep}/${totalSteps} ·` : ''
  const buttonLabel = inFlight
    ? status === 'signing'
      ? 'Sign in wallet…'
      : feeStep
        ? 'Approving fee cap…'
        : pre
          ? 'Setting leverage…'
          : 'Executing…'
    : feeStep
      ? `${retry}${stepTag} approve the ${feeStep.maxFeeRate} fee cap (one-time)`
      : pre
        ? `${retry}${stepTag} set ${pre.expected.leverage}x leverage`
        : totalSteps > 1
          ? `${retry}${stepTag} place the order`
          : status === 'error'
            ? 'Retry — sign & execute'
            : 'Sign & execute'

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
          {hl.feeApproval && feeDone && (
            <span className="inline-flex items-center gap-1 text-[12px] text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> {hl.feeApproval.maxFeeRate} fee cap approved
            </span>
          )}
          {hl.pre && preDone && (
            <span className="inline-flex items-center gap-1 text-[12px] text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> {hl.pre.expected.leverage}x leverage set
            </span>
          )}
          <button
            onClick={() => void (feeStep ? signFee() : pre ? signPre() : sign())}
            disabled={inFlight}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 max-lg:min-h-10 rounded-full border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white disabled:opacity-50 transition-colors"
            title={
              feeStep
                ? `One-time approval capping the builder fee at ${feeStep.maxFeeRate} for Yeetful — after this, orders carry it with no extra signature`
                : pre
                  ? `Sign the ${pre.expected.leverage}x leverage update first, then the order`
                  : 'Sign this Hyperliquid order with your wallet and execute it'
            }
          >
            {inFlight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
            {buttonLabel}
          </button>
          {error && <span className="text-[12px] text-red-400">{error}</span>}
        </div>
      )}
    </div>
  )
}
