'use client'

// Multi-step transaction chain — ONE self-advancing card for approve → swap
// (and any future multi-step action). The trap this kills: step 1's green
// "Confirmed on-chain" reads as DONE, and first-time users walk away without
// ever signing the swap. Here every step is visible up front, the current
// step reuses <SendTxButton> (same Sign → Broadcast → Confirmed stepper), and
// when a step confirms the next one appears in place — nothing to retype.
//
// Steps marked by the server's `refresh` recipe are REBUILT right before
// they're offered (POST /api/tx/refresh): a fresh quote AND a fresh
// guardrails run — prices move while approvals mine, and the policy gate
// must re-fire per step, not once per chain. If the re-quote fails we fall
// back to the prebuilt transaction: its slippage bound means a stale quote
// reverts, it never fills badly.

import { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { CheckCircle2, Circle, Link2, Loader2, ShieldX, ExternalLink } from 'lucide-react'
import SendTxButton from '@/components/SendTxButton'
import type { TxChainRequest, TxChainStep } from '@/lib/transaction-layer'
import { chainById } from '@/lib/chains'

// Explorer links come from the app chain registry (lib/chains); this local
// map only covers non-registry chains the app can still broadcast on.
const TX_EXPLORER: Record<number, string> = {
  84532: 'https://sepolia.basescan.org/tx/',
}

type Phase = 'sign' | 'refreshing' | 'blocked' | 'done'

export default function SendTxChain({
  chain,
  onCompleted,
}: {
  chain: TxChainRequest
  /** Fires once, when the FINAL step confirms — the whole chain is done and
   * the money has actually moved (telemetry hooks here, not on approves).
   * `txs` carries EVERY confirmed step's hash + chain + title, in order, so
   * callers can persist the full signing log (job results, message meta). */
  onCompleted?: (info: { hash: string; chainId: number; txs: Array<{ hash: string; chainId: number; title: string }> }) => void
}) {
  const { address } = useAccount()
  const [steps, setSteps] = useState<TxChainStep[]>(chain.steps)
  const [current, setCurrent] = useState(0)
  const [phase, setPhase] = useState<Phase>('sign')
  const [hashes, setHashes] = useState<Record<number, string>>({})
  const [note, setNote] = useState('')

  // Re-quote one step server-side (fresh quote + guardrails + revert dry-run).
  // Returns false when the step was withheld (blocked) — callers stop there.
  const refreshStep = async (index: number): Promise<boolean> => {
    if (!chain.refresh || chain.refresh.stepIndex !== index || !address) return true
    setPhase('refreshing')
    setNote('')
    let gotFresh = false
    // The just-confirmed allowance can take a moment to be visible to the
    // builder's RPC — retry briefly on `pending` before falling back.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch('/api/tx/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: chain.refresh.kind, ...chain.refresh.params, from: address }),
        })
        const data = (await res.json()) as {
          tx?: TxChainStep['tx']
          summary?: string
          blocked?: boolean
          blockKind?: string
          reasons?: string
          pending?: boolean
          error?: string
          validUntil?: number | null
        }
        if (data.blocked) {
          // Withhold the step and say WHO refused: the user's own policy
          // (fixable on the Dashboard) vs the chain itself (an on-chain
          // revert — pointing at the Dashboard here sent a user hunting for
          // a spend limit that was never involved).
          setPhase('blocked')
          setNote(
            data.blockKind === 'execution'
              ? `the swap can't execute on-chain: ${data.reasons ?? 'the rebuilt transaction would revert'}. This isn't your spend policy — no limit needs changing`
              : `refused by your guardrails on the fresh quote: ${data.reasons ?? 'a safety check failed'}. Manage limits on the Dashboard`,
          )
          return false
        }
        if (data.tx) {
          const fresh = data.tx
          const freshValidUntil = typeof data.validUntil === 'number' ? data.validUntil : undefined
          setSteps((s) => s.map((st, i) => (i === index ? { ...st, tx: fresh, validUntil: freshValidUntil } : st)))
          if (data.summary) setNote(`Re-quoted: ${data.summary}`)
          gotFresh = true
          break
        }
        if (data.pending && attempt < 4) {
          await new Promise((r) => setTimeout(r, 2500))
          continue
        }
        break
      } catch {
        break
      }
    }
    if (!gotFresh) {
      const vu = steps[index]?.validUntil
      if (typeof vu === 'number' && vu * 1000 <= Date.now()) {
        // The prebuilt calldata is DEAD (deadline passed — approvals may have
        // lapsed with it) and no fresh build came back. Offering it anyway is
        // the $32M-fee wallet dead-end — withhold and say what to do.
        setPhase('blocked')
        setNote('this quote expired while the card sat unsigned. Ask for the swap again and a fresh card will be built')
        return false
      }
      // Still-live prebuilt tx → fall back to it (slippage-bounded).
      setNote('Using the original quote — the live re-quote was unavailable. The slippage bound still protects the price.')
    }
    setPhase('sign')
    setRefreshTick((t) => t + 1)
    return true
  }

  const advance = async (confirmedIndex: number, hash: string) => {
    const all = { ...hashes, [confirmedIndex]: hash }
    setHashes(all)
    const next = confirmedIndex + 1
    if (next >= steps.length) {
      setPhase('done')
      onCompleted?.({
        hash,
        chainId: steps[confirmedIndex].tx.chainId ?? 8453,
        txs: steps
          .map((s, i) => ({ hash: all[i], chainId: s.tx.chainId ?? 8453, title: s.title }))
          .filter((t): t is { hash: string; chainId: number; title: string } => !!t.hash),
      })
      return
    }
    // Advance FIRST so refresh states (spinner / a withheld shield) paint on
    // the incoming step — a block used to render on the just-CONFIRMED step,
    // reading as if the signed approval had failed.
    setCurrent(next)
    // Re-quote the incoming step when the server marked it refreshable.
    await refreshStep(next)
  }

  // Deadline watch: prebuilt calldata DIES at validUntil (the swap deadline).
  // If the card sits unsigned past it, the wallet's gas estimate reverts and
  // MetaMask's fee fallback shows the Arbitrum 2^50 block-gas sentinel as a
  // "$32M network fee" (the 2026-07-14 AAPL incident). Re-quote ~90s before
  // the deadline — and keep retrying past it — so the offered tx is always
  // live. refreshTick re-arms the timer after every refresh attempt.
  const [refreshTick, setRefreshTick] = useState(0)
  const refreshing = useRef(false)
  const lastAttempt = useRef(0)
  const currentValidUntil = steps[current]?.validUntil
  useEffect(() => {
    if (phase === 'done' || phase === 'blocked') return
    if (!chain.refresh || chain.refresh.stepIndex !== current || !address) return
    if (!currentValidUntil) return
    const msUntilStale = (currentValidUntil - 90) * 1000 - Date.now()
    // Overdue: fire NOW on first arm, then back off to 60s between retries
    // (a failed re-quote leaves validUntil unchanged — never tight-loop it).
    const delay = msUntilStale > 0 ? msUntilStale : Date.now() - lastAttempt.current < 55_000 ? 60_000 : 0
    const t = setTimeout(() => {
      if (refreshing.current) return
      refreshing.current = true
      lastAttempt.current = Date.now()
      void refreshStep(current).finally(() => {
        refreshing.current = false
      })
    }, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, currentValidUntil, phase, refreshTick, address])

  const explorerFor = (step: TxChainStep) => {
    const id = step.tx.chainId ?? 8453
    return chainById(id)?.explorerTx ?? TX_EXPLORER[id] ?? 'https://basescan.org/tx/'
  }

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] mono text-[color:var(--muted)]">
        <Link2 className="w-3.5 h-3.5" />
        <span>
          {phase === 'done'
            ? `All ${steps.length} steps confirmed`
            : `Step ${Math.min(current + 1, steps.length)} of ${steps.length}`}
        </span>
      </div>

      <ol className="space-y-1.5">
        {steps.map((step, i) => {
          const isDone = i < current || phase === 'done'
          const isCurrent = i === current && phase !== 'done'
          return (
            <li key={i} className="text-[12px]">
              <div className="flex items-center gap-2">
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4 text-[color:var(--done)] flex-shrink-0" />
                ) : isCurrent && phase === 'refreshing' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[color:var(--fg)] flex-shrink-0" />
                ) : isCurrent && phase === 'blocked' ? (
                  <ShieldX className="w-4 h-4 text-[color:var(--fail)] flex-shrink-0" />
                ) : (
                  <Circle className={`w-3.5 h-3.5 flex-shrink-0 ${isCurrent ? 'text-[color:var(--fg)]' : 'text-[color:var(--line-2)]'}`} />
                )}
                <span className={isDone ? 'text-[color:var(--done)]' : isCurrent ? 'text-[color:var(--fg)]' : 'text-[color:var(--muted-2)]'}>
                  {step.title}
                </span>
                {isDone && hashes[i] && (
                  <a
                    href={`${explorerFor(step)}${hashes[i]}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View this step on the block explorer"
                    className="inline-flex items-center text-[color:var(--muted)] hover:text-[color:var(--fg)]"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {isCurrent && phase === 'refreshing' && (
                <div className="ml-6 text-[11px] text-[color:var(--muted)]">Re-quoting with a fresh price…</div>
              )}
              {isCurrent && phase === 'blocked' && (
                <div className="ml-6 text-[11px] text-[color:var(--fail)]">
                  Withheld — {note}. This step was not signed{i > 0 ? '; your earlier confirmed steps stand' : ''}.
                </div>
              )}
              {isCurrent && phase === 'sign' && (
                <div className="ml-6">
                  {note && <div className="text-[11px] text-[color:var(--muted)] mb-1">{note}</div>}
                  {/* keyed by step so the inner Sign→Broadcast→Confirmed stepper resets per step.
                      Steps after the first auto-request the wallet signature on mount — the user
                      already committed by signing step 1; popup follows popup, no button hunt. */}
                  <SendTxButton
                    key={i}
                    tx={step.tx}
                    summary={step.title}
                    autoFire={i > 0}
                    onConfirmed={(hash) => void advance(i, hash)}
                    refusalArtifact="tx-chain"
                    refusalBuildPath={chain.refresh?.kind}
                  />
                  {/* The auto-advance reads as "why twice?" to a first-timer:
                      say up front that the next popup follows on its own. */}
                  {i < steps.length - 1 && (
                    <div className="mt-1 text-[11px] text-[color:var(--muted-2)]">
                      Once this confirms, the next step ({steps[i + 1].title}) opens in your wallet automatically — no button hunt.
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {phase === 'done' && (
        <div className="text-[12px]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[color:var(--done)] flex-shrink-0" />
            <span className="text-[color:var(--done)] font-medium">Done — every step confirmed on-chain</span>
          </div>
          {/* The receipt line WRAPS (was truncate): the summary carries the
              amount out ("→ ~0.0052 ETH, min received …") — the closest thing
              to "you now hold X" without a fresh balance RPC. */}
          {chain.summary && <div className="mt-0.5 ml-6 text-[color:var(--muted)]">{chain.summary}</div>}
        </div>
      )}
    </div>
  )
}
