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
// A chip carrying `fund` (lib/onramp) is the same contract with two extra
// beats: the wallet is empty, so the resume CANNOT succeed yet. The chip takes
// a free signature naming the destination wallet (CDP requires the on-ramp
// route to know who is asking; an empty wallet can pay no gas but can still
// sign), opens the hosted on-ramp, and then offers the very same resume — the
// ask survives the trip off-site, which is the whole point. We deliberately do NOT
// try to detect completion: Coinbase settles in another tab on its own clock,
// so guessing produces a resume that fires too early and walls the user a
// second time. The user tells us, we re-scan, the funding layer decides.

import { useState } from 'react'
import { HelpCircle, ChevronRight, CreditCard, Loader2 } from 'lucide-react'
import { useAccount, useSignMessage } from 'wagmi'
import type { ClarifyRequest, ClarifyOption } from '@/lib/clarify'
import { onrampConsentMessage } from '@/lib/onramp'

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
    // Open the tab SYNCHRONOUSLY off the click, before any await: a popup
    // opened after an await is no longer a user gesture and gets blocked
    // (the same lesson as the Coinbase popup-after-await signature bug).
    const tab = window.open('', '_blank')
    try {
      // Prove the wallet before asking CDP for a token (their integration
      // review required it). personal_sign costs no gas, which is the only
      // reason an EMPTY wallet can do it — and the text names the destination,
      // so the prompt doubles as a confirmation of where the money lands.
      // Signs the values the SERVER will use: clarifyOf has already rounded
      // and range-clamped them, so the server's clamp is a no-op here, and if
      // it ever were not the re-derived consent would fail to match — closed.
      const issuedAt = Date.now()
      let signature: string
      try {
        signature = await signMessageAsync({
          message: onrampConsentMessage({ ...o.fund, address, issuedAt }),
        })
      } catch (e) {
        tab?.close()
        const why = e instanceof Error ? e.message : ''
        setError(
          /reject|denied|declined|cancell?ed/i.test(why)
            ? 'Funding needs that signature to confirm the destination wallet — it costs nothing and moves nothing.'
            : 'Could not confirm the destination wallet with your signature.',
        )
        return
      }

      const res = await fetch('/api/onramp/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, ...o.fund, issuedAt, signature }),
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        tab?.close()
        setError(data.error ?? 'Could not start the funding session.')
        return
      }
      if (tab) tab.location.href = data.url
      else window.location.href = data.url
      setOpened(i)
    } catch {
      tab?.close()
      setError('Could not start the funding session.')
    } finally {
      setFunding(null)
    }
  }

  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      <div className="flex items-center gap-1.5 text-[12px] text-[color:var(--muted)]">
        <HelpCircle className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-[color:var(--fg)]">{clarify.question}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {clarify.options.map((o, i) => {
          const isFund = Boolean(o.fund)
          const busy = funding === i
          const waiting = opened === i
          return (
            <button
              key={`${o.label}-${i}`}
              onClick={() => (isFund && !waiting ? void startFunding(o, i) : onPick(o.resume))}
              disabled={disabled || busy}
              title={waiting ? o.resume : isFund ? `Add funds, then: ${o.resume}` : o.resume}
              className="group flex items-center gap-2 text-left text-[12px] px-3 py-2 max-lg:min-h-10 rounded-lg border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] disabled:opacity-50 transition-colors"
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-[color:var(--muted-2)]" />
              ) : isFund ? (
                <CreditCard className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--accent)]" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--muted-2)] group-hover:text-white" />
              )}
              <span className="min-w-0 flex-1 truncate">
                <span className="text-[color:var(--fg)] font-medium">
                  {waiting ? 'Funded it — pick up where I left off' : o.label}
                </span>
                {i === 0 && !isFund && <span className="text-[color:var(--muted-2)]"> — best guess</span>}
              </span>
            </button>
          )
        })}
      </div>
      {error && <div className="text-[11px] text-[color:var(--sell)]">{error}</div>}
    </div>
  )
}
