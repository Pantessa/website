'use client'

// Clarify chips (RR17) — the general "which one did you mean?" surface.
// Rendered when a routed turn returns a clarify artifact instead of picks:
// the planner judged a MONEY/GOVERNANCE target genuinely ambiguous and
// refused to guess (read-only asks never clarify — they best-guess and say
// so). Each chip carries the user's request FULLY RESOLVED with that
// choice; clicking sends it as the next message, so the route resumes as a
// perfectly normal turn (working context, guardrails, sign flow all see
// nothing special). Generalizes VoteCandidates' proven pattern.
//
// Funding chips get a ROUTE CARD instead of a bare label: the resume
// string is a strict grammar (the chip IS the contract), so
// lib/funding-path derives the actual money path — origin chain → bridge /
// swap legs → destination → the buy — and the user picks by seeing it.
// A resume that doesn't parse as funding legs ("Not now", planner
// clarifies, vote options) renders as the plain chip it always was.
//
// A chip carrying `fund` (lib/onramp) outranks both: the wallet is EMPTY, so
// no resume can succeed yet and no route exists to draw. It takes a free
// signature naming the destination wallet (personal_sign — an empty wallet
// pays no gas but can still prove it is the wallet, which is what the on-ramp
// route requires), opens the Stripe-hosted on-ramp, and then offers the very
// same resume: the ask survives the trip off-site, which is the whole point.
// We deliberately do NOT try to detect completion — Stripe settles in another
// tab on its own clock, so guessing fires the resume too early and walls the
// user a second time. The user tells us, we re-scan, the funding layer
// decides.

import { useState } from 'react'
import { HelpCircle, ChevronRight, ArrowRight, CreditCard, Loader2 } from 'lucide-react'
import { useAccount, useSignMessage } from 'wagmi'
import type { ClarifyRequest, ClarifyOption } from '@/lib/clarify'
import { fundingPathOf, type FundingPath } from '@/lib/funding-path'
import { startOnrampSession } from '@/lib/onramp-client'

function PathStrip({ path }: { path: FundingPath }) {
  return (
    <span className="flex flex-wrap items-center gap-y-1.5">
      {path.nodes.map((n, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && (
            <span className="flex flex-col items-center px-1.5 shrink-0">
              <span className="text-[8px] uppercase tracking-wider leading-none text-[color:var(--muted-2)]">{path.arrows[i - 1]}</span>
              <ArrowRight className="w-3 h-3 text-[color:var(--muted-2)]" />
            </span>
          )}
          {n.kind === 'chain' ? (
            <span className="flex flex-col rounded-md border border-[var(--line)] bg-[var(--surf-1)] px-2 py-1 leading-tight">
              <span className="text-[11px] font-medium text-[color:var(--fg)]">{n.title}</span>
              {n.detail && <span className="text-[10px] text-[color:var(--muted)]">{n.detail}</span>}
            </span>
          ) : (
            <span className="rounded-md border border-[var(--accent)] px-2 py-1 text-[11px] font-medium leading-tight text-[color:var(--accent)]">
              {n.title}
            </span>
          )}
        </span>
      ))}
    </span>
  )
}

export default function ClarifyChips({
  clarify,
  onPick,
  disabled,
}: {
  clarify: ClarifyRequest
  onPick: (resume: string) => void
  disabled?: boolean
}) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [funding, setFunding] = useState<number | null>(null)
  const [opened, setOpened] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function startFunding(o: ClarifyOption, i: number) {
    if (!o.fund) return
    if (!address) {
      setError('Connect a wallet first — the funds need somewhere to land.')
      return
    }
    setError(null)
    setFunding(i)
    // Called synchronously off the click: startOnrampSession opens the tab as
    // its first statement, and a popup opened after an await is no longer a
    // user gesture. It signs the consent, mints the Stripe session and hands
    // the user off; it never throws.
    const res = await startOnrampSession({ address, fund: o.fund, signMessage: signMessageAsync })
    setFunding(null)
    if (res.ok) setOpened(i)
    else setError(res.error)
  }

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      <div className="flex items-center gap-1.5 text-[12px] text-[color:var(--muted)]">
        <HelpCircle className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-[color:var(--fg)]">{clarify.question}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {clarify.options.map((o, i) => {
          if (o.fund) {
            const busy = funding === i
            const waiting = opened === i
            return (
              <button
                key={`${o.label}-${i}`}
                onClick={() => (waiting ? onPick(o.resume) : void startFunding(o, i))}
                disabled={disabled || busy}
                title={waiting ? o.resume : `Add funds, then: ${o.resume}`}
                className="group flex items-center gap-2 text-left text-[12px] px-3 py-2 max-lg:min-h-10 rounded-lg border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] disabled:opacity-50 transition-colors"
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-[color:var(--muted-2)]" />
                ) : (
                  <CreditCard className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--accent)]" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-[color:var(--fg)] font-medium">
                    {waiting ? 'Funded it — pick up where I left off' : o.label}
                  </span>
                </span>
              </button>
            )
          }
          const path = fundingPathOf(o.resume)
          if (path) {
            return (
              <button
                key={`${o.label}-${i}`}
                onClick={() => onPick(o.resume)}
                disabled={disabled}
                title={o.resume}
                className="group flex flex-col gap-1.5 text-left text-[12px] px-3 py-2.5 rounded-lg border border-[var(--line)] hover:border-[var(--line-2)] disabled:opacity-50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--muted-2)]" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-[color:var(--fg)] font-medium">{o.label}</span>
                    {i === 0 && <span className="text-[color:var(--muted-2)]"> — best guess</span>}
                  </span>
                </span>
                <PathStrip path={path} />
              </button>
            )
          }
          return (
            <button
              key={`${o.label}-${i}`}
              onClick={() => onPick(o.resume)}
              disabled={disabled}
              title={o.resume}
              className="group flex items-center gap-2 text-left text-[12px] px-3 py-2 max-lg:min-h-10 rounded-lg border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] disabled:opacity-50 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--muted-2)] group-hover:text-white" />
              <span className="min-w-0 flex-1 truncate">
                <span className="text-[color:var(--fg)] font-medium">{o.label}</span>
                {i === 0 && <span className="text-[color:var(--muted-2)]"> — best guess</span>}
              </span>
            </button>
          )
        })}
      </div>
      {error && <div className="text-[11px] text-[color:var(--sell)]">{error}</div>}
    </div>
  )
}
