'use client'

// Sign & execute a Hyperliquid L1 action (the SignOrderButton twin for HL).
// The relay (/api/hl/submit) recovers the signer, re-guards against the
// live market, re-gates the spend policy, and only then lets the venue see
// it. IOC orders settle instantly — no fill polling needed.
//
// TWO ways the wallet says yes to an L1 action (order / leverage):
//   direct    — the wallet signs the venue's phantom-agent typed data
//               (domain chainId 1337) itself. Rabby, raw keys, the harness.
//   delegated — MetaMask (and any wallet policing EIP-712 domain hygiene)
//               REFUSES that payload before a popup opens: `Provided chainId
//               "1337" must match the active chainId "4663"` — found live
//               2026-08-17 on the "Close SYRUP" chip. So the wallet signs a
//               chain-agnostic personal_sign CONSENT over the action's own
//               hash, and the wallet's approved Pantessa agent (the guardian
//               delegation — trade-only, never withdraw) signs the venue
//               bytes server-side. First time only, the wallet approves that
//               agent (the venue's own "enable trading" step, typed data on
//               the wallet's OWN chain — every wallet signs it).
// Path choice is deterministic: an active delegation → delegated (one
// popup, any wallet, any chain); else try direct, and a chain-mismatch
// refusal (which never showed the user anything) switches to delegated in
// the SAME gesture. Still one signature per action.
//
// Up to three signatures ride one card, each behind its OWN user gesture (a
// popup fired after an awaited submit is the known Coinbase second-signature
// breaker): 1) the one-time builder-fee cap approval (user-signed, built
// CLIENT-side because its EIP-712 domain carries the wallet's chainId),
// 2) the guarded leverage set on explicit-leverage asks, 3) the order.
// The card self-advances as each lands.

import { useEffect, useState } from 'react'
import { useAccount, useChainId, useSignMessage, useSignTypedData } from 'wagmi'
import { CheckCircle2, ExternalLink, Loader2, PenLine, ShieldCheck } from 'lucide-react'
import type { Eip712OrderRequest } from '@/lib/transaction-layer'
import {
  approveBuilderFeeArtifacts,
  classifyHlSignFailure,
  hlActionSummary,
  hlConsentMessage,
  isUserRejectedSignError,
  type HlWireAction,
} from '@/lib/hyperliquid-exec'
import { reportWalletRefusal, walletErrorWords, type WalletArtifact } from '@/lib/wallet-refusal'
import { SIGN_CTA_CLASS } from '@/lib/sign-cta'

type Status = 'idle' | 'signing' | 'submitting' | 'enabling' | 'filled' | 'error'
type Delegation = 'unknown' | 'active' | 'none'

interface L1Step {
  action: HlWireAction
  nonce: number
  typedData: { domain: object; types: object; primaryType: string; message: object }
  expected: { coin: string; kind?: string; isBuy?: boolean; leverage?: number }
  artifact: WalletArtifact
  failLabel: string
}

export default function SignHlActionButton({
  order,
  onPlaced,
}: {
  order: Eip712OrderRequest
  onPlaced?: (info: { explorerUrl?: string; detail?: string; valueUsd?: number | null }) => void
}) {
  const { address, connector } = useAccount()
  const chainId = useChainId()
  const { signTypedDataAsync } = useSignTypedData()
  const { signMessageAsync } = useSignMessage()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [fill, setFill] = useState<{ totalSz: string; avgPx: string } | null>(null)
  const [explorerUrl, setExplorerUrl] = useState('')
  const [feeDone, setFeeDone] = useState(false)
  const [preDone, setPreDone] = useState(false)
  const [delegation, setDelegation] = useState<Delegation>('unknown')
  // The wallet needs the one-time agent approval before it can act — set
  // when the relay says so (409 delegation-required) or when a direct sign
  // hit the chain-mismatch wall with no delegation on file.
  const [needsEnable, setNeedsEnable] = useState(false)
  const [viaAgent, setViaAgent] = useState(false)

  const isTestnet = order.hl?.isTestnet === true

  // Which path this wallet takes: an active Pantessa agent → delegated,
  // one popup, on any chain. Public read by address (connect-to-act).
  useEffect(() => {
    if (!address) return
    let alive = true
    fetch(`/api/hl/delegation?wallet=${address}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { active?: boolean } | null) => {
        if (alive) setDelegation(d?.active ? 'active' : 'none')
      })
      .catch(() => {
        if (alive) setDelegation('none')
      })
    return () => {
      alive = false
    }
  }, [address])

  if (order.protocol !== 'hyperliquid' || !order.hl) return null
  const hl = order.hl
  const feeStep = hl.feeApproval && !feeDone ? hl.feeApproval : null
  const pre = !feeStep && hl.pre && !preDone ? hl.pre : null
  // Step numbering over whichever extras this build carries.
  const totalSteps = 1 + (hl.feeApproval ? 1 : 0) + (hl.pre ? 1 : 0)
  const currentStep = feeStep ? 1 : pre ? 1 + (hl.feeApproval ? 1 : 0) : totalSteps

  const walletMeta = () => ({ wallet: address, connector: connector?.id ?? connector?.name, chainId })

  /** Run a wallet prompt; an error thrown by the WALLET is tagged so `fail`
   *  reports it as a wallet refusal (relay/venue errors are not the wallet). */
  const walletSign = async <T,>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      ;(err as Error & { fromWallet?: boolean }).fromWallet = true
      throw err
    }
  }

  /** Venue strings → the honest human line. Hyperliquid answers EVERY L1
   *  action on an account with no deposit — even approving the trading
   *  agent — with the raw "Must deposit before performing actions"; a fresh
   *  wallet on the delegated door met exactly that (QA strict-wallet drive,
   *  squad 2026-08-18). The deposit ask below round-trips the chat's own HL
   *  deposit grammar (lib/hyperliquid-exec.ts parseHlIntent) → guarded USDC
   *  transfer to the official bridge; in organic traffic the build's
   *  has-collateral guard offers it before any card renders. */
  const humanizeVenueError = (msg: string): string =>
    /must deposit/i.test(msg)
      ? 'Your Hyperliquid account has no deposit yet, so the venue refuses every action — including approving the trading agent. Ask the chat to “deposit 10 usdc to hyperliquid” first (a plain USDC transfer to the official bridge on Arbitrum, credited in under a minute), then press this again.'
      : msg

  const fail = (e: unknown, fallback: string, artifact: WalletArtifact, ask: string) => {
    const msg = e instanceof Error ? e.message : ''
    setError(isUserRejectedSignError(msg) ? 'Signature request declined.' : humanizeVenueError(msg) || fallback)
    setStatus('error')
    if (msg && (e as { fromWallet?: boolean } | null)?.fromWallet && !isUserRejectedSignError(msg)) {
      reportWalletRefusal({ ...walletMeta(), artifact, ask, detail: walletErrorWords(e), buildPath: 'native-hl-exec' })
    }
  }

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
      const signature = await walletSign(() => signTypedDataAsync({ ...typedData, message } as Parameters<typeof signTypedDataAsync>[0]))
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
      fail(e, 'Fee approval failed.', 'hl-order', `approve the ${hl.feeApproval.maxFeeRate} builder-fee cap`)
    }
  }

  /** The one-time venue approval of the wallet's Pantessa agent — typed data
   *  on the wallet's OWN chain, so every wallet signs it. */
  const enableTrading = async (): Promise<boolean> => {
    if (!address) return false
    setStatus('enabling')
    const created = await fetch('/api/hl/delegation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: address, signatureChainId: chainId }),
    })
    const cj = (await created.json().catch(() => ({}))) as { active?: boolean; id?: string; typedData?: { domain: object; types: object; primaryType: string; message: Record<string, unknown> }; error?: string }
    if (!created.ok) throw new Error(cj.error || 'Could not start the agent approval.')
    if (cj.active) {
      setDelegation('active')
      setNeedsEnable(false)
      return true
    }
    if (!cj.id || !cj.typedData) throw new Error('Could not start the agent approval.')
    // uint64 nonce must go to the wallet as a BigInt.
    const message = { ...cj.typedData.message, nonce: BigInt(cj.typedData.message.nonce as number) }
    const signature = await walletSign(() => signTypedDataAsync({ ...cj.typedData, message } as Parameters<typeof signTypedDataAsync>[0]))
    const activated = await fetch('/api/hl/delegation', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: cj.id, from: address, signature }),
    })
    const aj = (await activated.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!activated.ok) throw new Error(aj.error || 'The venue rejected the agent approval.')
    setDelegation('active')
    setNeedsEnable(false)
    return true
  }

  /** Delegated path: consent (personal_sign, chain-agnostic) → the relay's
   *  agent signs the venue bytes. Returns the relay's JSON or throws. */
  const submitDelegated = async (step: L1Step) => {
    if (!address) throw new Error('Connect your wallet first.')
    const consent = hlConsentMessage({ from: address, action: step.action, nonce: step.nonce, isTestnet, expected: step.expected })
    setStatus('signing')
    const consentSignature = await walletSign(() => signMessageAsync({ message: consent }))
    setStatus('submitting')
    const res = await fetch('/api/hl/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'delegated', action: step.action, nonce: step.nonce, isTestnet, expected: step.expected, consentSignature, from: address }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; code?: string }
    if (res.status === 409 && data.code === 'delegation-required') {
      setDelegation('none')
      setNeedsEnable(true)
      throw new Error(data.error || 'Enable trading once, then retry.')
    }
    if (!res.ok) throw new Error(data.error || step.failLabel)
    setViaAgent(true)
    return data
  }

  /** Direct path: the wallet signs the venue's typed data itself. */
  const submitDirect = async (step: L1Step) => {
    if (!address) throw new Error('Connect your wallet first.')
    setStatus('signing')
    const signature = await walletSign(() => signTypedDataAsync(step.typedData as Parameters<typeof signTypedDataAsync>[0]))
    setStatus('submitting')
    const res = await fetch('/api/hl/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: step.action, nonce: step.nonce, isTestnet, expected: step.expected, signature, from: address }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string }
    if (!res.ok) throw new Error(data.error || step.failLabel)
    return data
  }

  /** The path decision, per step: delegation active → delegated; else direct,
   *  and a chain-mismatch refusal (no popup was ever shown) → delegated in the
   *  same gesture — enabling trading first when the wallet has no agent yet. */
  const runStep = async (step: L1Step) => {
    if (delegation === 'active') return submitDelegated(step)
    try {
      return await submitDirect(step)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (classifyHlSignFailure(msg) !== 'switch-to-delegated') throw e
      // Log the wall as a data point (which wallets police the domain chain),
      // then take the door the venue itself designed.
      reportWalletRefusal({ ...walletMeta(), artifact: step.artifact, ask: `${hlActionSummary(step.action, step.expected)} (direct typed-data path — switched to delegated)`, detail: walletErrorWords(e), buildPath: 'native-hl-exec' })
      // Re-read (the mount-time read may still be in flight): no agent on
      // file → the one-time approval first, in this same gesture.
      const check = await fetch(`/api/hl/delegation?wallet=${address}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      if ((check as { active?: boolean } | null)?.active) setDelegation('active')
      else await enableTrading()
      return submitDelegated(step)
    }
  }

  const signPre = async () => {
    if (!address || !hl.pre) {
      setError(address ? 'Missing leverage step.' : 'Connect your wallet first — it is your Hyperliquid account.')
      return
    }
    setError('')
    const step: L1Step = {
      action: hl.pre.action as HlWireAction,
      nonce: hl.pre.nonce,
      typedData: hl.pre.typedData as L1Step['typedData'],
      expected: { coin: hl.expected.coin, leverage: hl.pre.expected.leverage },
      artifact: 'hl-leverage',
      failLabel: 'Leverage update failed.',
    }
    try {
      if (needsEnable) await enableTrading()
      await runStep(step)
      setPreDone(true)
      setStatus('idle')
    } catch (e) {
      fail(e, 'Leverage update failed.', 'hl-leverage', hlActionSummary(step.action, step.expected))
    }
  }

  const sign = async () => {
    if (!address) {
      setError('Connect your wallet first — it is your Hyperliquid account.')
      return
    }
    setError('')
    const step: L1Step = {
      action: hl.action as HlWireAction,
      nonce: hl.nonce,
      typedData: order.typedData as L1Step['typedData'],
      expected: { coin: hl.expected.coin, kind: hl.expected.kind, isBuy: hl.expected.isBuy },
      artifact: 'hl-order',
      failLabel: 'Submit failed.',
    }
    try {
      if (needsEnable) await enableTrading()
      const data = (await runStep(step)) as {
        filled?: { totalSz: string; avgPx: string } | null
        valueUsd?: number | null
        explorerUrl?: string
      }
      setFill(data.filled ?? null)
      setExplorerUrl(data.explorerUrl ?? '')
      setStatus('filled')
      onPlaced?.({
        explorerUrl: data.explorerUrl,
        detail: data.filled ? `${hl.expected.kind} ${hl.expected.coin} filled ${data.filled.totalSz} @ ${data.filled.avgPx}` : `${hl.expected.kind} ${hl.expected.coin}`,
        valueUsd: data.valueUsd ?? null,
      })
    } catch (e) {
      fail(e, 'Order failed.', 'hl-order', hlActionSummary(step.action, step.expected))
    }
  }

  const inFlight = status === 'signing' || status === 'submitting' || status === 'enabling'
  const retry = status === 'error' ? 'Retry — sign' : 'Sign'
  const stepTag = totalSteps > 1 ? ` ${currentStep}/${totalSteps} ·` : ''
  const buttonLabel = inFlight
    ? status === 'enabling'
      ? 'Approve the Pantessa agent in your wallet…'
      : status === 'signing'
        ? 'Confirm in your wallet…'
        : feeStep
          ? 'Approving fee cap…'
          : pre
            ? 'Setting leverage…'
            : 'Executing…'
    : needsEnable
      ? `Enable trading — one-time approval, then ${feeStep ? 'approve the fee cap' : pre ? `set ${pre.expected.leverage}x leverage` : 'sign & execute'}`
      : feeStep
        ? `${retry}${stepTag} approve the ${feeStep.maxFeeRate} fee cap (one-time)`
        : pre
          ? `${retry}${stepTag} set ${pre.expected.leverage}x leverage`
          : totalSteps > 1
            ? `${retry}${stepTag} place the order`
            : status === 'error'
              ? 'Retry — sign & execute'
              : 'Sign & execute'

  const buttonTitle = needsEnable
    ? 'Hyperliquid needs a one-time approval of a trade-only Pantessa agent on your account (it can never withdraw) — the same "enable trading" step the Hyperliquid app asks for. After that, one signature per action.'
    : feeStep
      ? `One-time approval capping the builder fee at ${feeStep.maxFeeRate} for Pantessa — after this, orders carry it with no extra signature`
      : pre
        ? `Sign the ${pre.expected.leverage}x leverage update first, then the order`
        : delegation === 'active'
          ? 'Sign the consent for exactly this action; your approved Pantessa agent submits it to Hyperliquid'
          : 'Sign this Hyperliquid order with your wallet and execute it'

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      {status === 'filled' ? (
        <div className="flex items-center gap-2 text-[12px]">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="text-emerald-400 font-medium">
            {fill ? `Filled ${fill.totalSz} ${hl.expected.coin} @ ${fill.avgPx}` : 'Order accepted (unfilled — IOC expired)'}
          </span>
          {viaAgent && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--muted)]" title="Your consent signature authorized this exact action; your approved Pantessa agent submitted it.">
              <ShieldCheck className="w-3 h-3" /> via your Pantessa agent
            </span>
          )}
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
            data-hl-path={delegation === 'active' ? 'delegated' : needsEnable ? 'enable' : 'direct'}
            className={SIGN_CTA_CLASS}
            title={buttonTitle}
          >
            {inFlight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : needsEnable ? <ShieldCheck className="w-3.5 h-3.5" /> : <PenLine className="w-3.5 h-3.5" />}
            {buttonLabel}
          </button>
          {error && <span className="text-[12px] text-red-400">{error}</span>}
        </div>
      )}
    </div>
  )
}
