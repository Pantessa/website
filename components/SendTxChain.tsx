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

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { CheckCircle2, Circle, Link2, Loader2, ShieldX, ExternalLink } from 'lucide-react'
import SendTxButton from '@/components/SendTxButton'
import type { TxChainRequest, TxChainStep } from '@/lib/transaction-layer'

const TX_EXPLORER: Record<number, string> = {
  8453: 'https://basescan.org/tx/',
  1: 'https://etherscan.io/tx/',
  42161: 'https://arbiscan.io/tx/',
}

type Phase = 'sign' | 'refreshing' | 'blocked' | 'done'

export default function SendTxChain({ chain }: { chain: TxChainRequest }) {
  const { address } = useAccount()
  const [steps, setSteps] = useState<TxChainStep[]>(chain.steps)
  const [current, setCurrent] = useState(0)
  const [phase, setPhase] = useState<Phase>('sign')
  const [hashes, setHashes] = useState<Record<number, string>>({})
  const [note, setNote] = useState('')

  const advance = async (confirmedIndex: number, hash: string) => {
    setHashes((h) => ({ ...h, [confirmedIndex]: hash }))
    const next = confirmedIndex + 1
    if (next >= steps.length) {
      setPhase('done')
      return
    }
    // Re-quote the incoming step when the server marked it refreshable.
    if (chain.refresh && chain.refresh.stepIndex === next && address) {
      setPhase('refreshing')
      setNote('')
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
            reasons?: string
            pending?: boolean
            error?: string
          }
          if (data.blocked) {
            // Guardrails re-fired and refused — withhold the step, say why.
            setPhase('blocked')
            setNote(data.reasons ?? 'a safety check failed')
            return
          }
          if (data.tx) {
            const fresh = data.tx
            setSteps((s) => s.map((st, i) => (i === next ? { ...st, tx: fresh } : st)))
            if (data.summary) setNote(`Re-quoted: ${data.summary}`)
            break
          }
          if (data.pending && attempt < 4) {
            await new Promise((r) => setTimeout(r, 2500))
            continue
          }
          // error / exhausted retries → prebuilt tx (slippage-bounded).
          setNote('Using the original quote — the live re-quote was unavailable. The slippage bound still protects the price.')
          break
        } catch {
          setNote('Using the original quote — the live re-quote was unavailable. The slippage bound still protects the price.')
          break
        }
      }
      setPhase('sign')
    }
    setCurrent(next)
  }

  const explorerFor = (step: TxChainStep) => TX_EXPLORER[step.tx.chainId ?? 8453] ?? TX_EXPLORER[8453]

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
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : isCurrent && phase === 'refreshing' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[color:var(--fg)] flex-shrink-0" />
                ) : isCurrent && phase === 'blocked' ? (
                  <ShieldX className="w-4 h-4 text-red-400 flex-shrink-0" />
                ) : (
                  <Circle className={`w-3.5 h-3.5 flex-shrink-0 ${isCurrent ? 'text-[color:var(--fg)]' : 'text-[color:var(--line-2)]'}`} />
                )}
                <span className={isDone ? 'text-emerald-400' : isCurrent ? 'text-[color:var(--fg)]' : 'text-[color:var(--muted-2)]'}>
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
                <div className="ml-6 text-[11px] text-red-400">
                  Refused by your guardrails on the fresh quote: {note} — nothing was signed. Manage limits on the Dashboard.
                </div>
              )}
              {isCurrent && phase === 'sign' && (
                <div className="ml-6">
                  {note && <div className="text-[11px] text-[color:var(--muted)] mb-1">{note}</div>}
                  {/* keyed by step so the inner Sign→Broadcast→Confirmed stepper resets per step */}
                  <SendTxButton key={i} tx={step.tx} summary={step.title} onConfirmed={(hash) => void advance(i, hash)} />
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {phase === 'done' && (
        <div className="flex items-center gap-2 text-[12px]">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="text-emerald-400 font-medium">Done — every step confirmed on-chain</span>
          {chain.summary && <span className="text-[color:var(--muted)] truncate">— {chain.summary}</span>}
        </div>
      )}
    </div>
  )
}
