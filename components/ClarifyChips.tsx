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

import { useEffect, useRef, useState } from 'react'
import { HelpCircle, ChevronRight, ArrowRight, CreditCard, Loader2, Check } from 'lucide-react'
import { useAccount, useSignMessage } from 'wagmi'
import type { ClarifyRequest, ClarifyOption } from '@/lib/clarify'
import { fundingPathOf, type FundingPath } from '@/lib/funding-path'
import { startOnrampSession } from '@/lib/onramp-client'
import { arrivalPhrase, clearFundWait, loadFundWait, saveFundWait, type Arrival, type FundWait } from '@/lib/funding-arrival'
import { useFundingArrival } from '@/lib/use-funding-arrival'
import { ONRAMP_NETWORK_LABEL } from '@/lib/onramp'

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
  // ── The wait for the money (lib/funding-arrival). Written when the on-ramp
  // tab opens, persisted so a reload picks it back up, watched by the hook
  // below; the resume fires ITSELF when the balance rises. Until 2026-09-08
  // this chip only hoped the user would come back and press "Funded it".
  const [wait, setWait] = useState<FundWait | null>(null)
  const firedRef = useRef(false)
  // The landing, kept by THIS component: the watcher below is switched off
  // once the resume has fired, and its state resets with it — the alert must
  // outlive that (the first drive showed the banner for one render).
  const [landed, setLanded] = useState<Arrival | null>(null)
  const [fired, setFired] = useState(false)

  // A stored wait for this wallet that matches one of these chips (same
  // resume) restores the waiting state — the user came back to the tab, or
  // reloaded, after paying. Keyed on the resumes, not the clarify object,
  // so a re-render can't re-run it.
  const resumesKey = clarify.options.map((o) => (o.fund ? `${o.fund.network}:${o.resume}` : '')).join('|')
  useEffect(() => {
    if (!address) return
    const w = loadFundWait(address)
    if (!w) return
    const i = clarify.options.findIndex((o) => o.fund && o.resume === w.resume && o.fund.network === w.network)
    if (i < 0) return
    setWait((cur) => (cur && cur.openedAt === w.openedAt ? cur : w))
    setOpened(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, resumesKey])

  const watch = useFundingArrival(wait, opened !== null && !!wait && !fired)
  useEffect(() => {
    if (watch.status === 'arrived' && watch.arrival) setLanded(watch.arrival)
  }, [watch.status, watch.arrival])

  // Continue the ask the moment the money is here — but only in front of the
  // user: the tab must be visible and the chat idle. A turn that starts while
  // they are still on the Stripe tab is a surprise; one that waits for them
  // is the point.
  useEffect(() => {
    if (watch.status !== 'arrived' || !wait || firedRef.current || disabled) return
    const fire = () => {
      if (firedRef.current) return
      firedRef.current = true
      setFired(true)
      clearFundWait(wait.address)
      onPick(wait.resume)
    }
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      fire()
      return
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') fire()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [watch.status, wait, disabled, onPick])

  async function startFunding(o: ClarifyOption, i: number) {
    if (!o.fund) return
    if (!address) {
      setError('Connect a wallet first — the funds need somewhere to land.')
      return
    }
    setError(null)
    setFunding(i)
    // Called synchronously off the click: startOnrampSession opens the tab as
    // its first statement, and a popup opened after an `await` is no longer a
    // user gesture. It signs the consent, mints the Stripe session and hands
    // the user off; it never throws.
    const res = await startOnrampSession({ address, fund: o.fund, signMessage: signMessageAsync })
    setFunding(null)
    if (res.ok) {
      const w: FundWait = {
        address: address.toLowerCase(),
        network: o.fund.network,
        resume: o.resume,
        label: o.label,
        baselineEth: null,
        baselineStable: null,
        openedAt: Date.now(),
      }
      firedRef.current = false
      saveFundWait(w)
      setWait(w)
      setOpened(i)
    } else setError(res.error)
  }

  /** The user says it's there (or wants to try anyway) — same continuation,
   *  by hand. Clears the wait so the watcher can't fire it a second time. */
  function continueNow(o: ClarifyOption) {
    firedRef.current = true
    setFired(true)
    clearFundWait(address)
    onPick(o.resume)
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
            const arrived = waiting && !!landed
            const chainName = ONRAMP_NETWORK_LABEL[o.fund.network] ?? o.fund.network
            return (
              <div key={`${o.label}-${i}`} className="space-y-1">
                {/* The alert: money landed. The resume fires the moment this
                    tab is in front — say both, and keep saying it after. */}
                {arrived && landed && (
                  <div className="flex items-start gap-2 rounded-lg border border-[color:var(--accent)]/50 bg-[color:var(--accent)]/[0.08] px-3 py-2 text-[12px]">
                    <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[color:var(--accent)]" strokeWidth={3} />
                    <span className="text-[color:var(--fg)]">
                      <span className="font-semibold">{arrivalPhrase(landed, watch.stableSymbol)} landed on {chainName}.</span>{' '}
                      <span className="text-[color:var(--muted)]">
                        {fired ? <>Ready to keep going — picked up &ldquo;{o.resume}&rdquo; below.</> : <>Ready to keep going — picking up &ldquo;{o.resume}&rdquo;.</>}
                      </span>
                    </span>
                  </div>
                )}
                {!(waiting && fired) && (
                <button
                  onClick={() => (waiting ? continueNow(o) : void startFunding(o, i))}
                  disabled={disabled || busy}
                  title={waiting ? o.resume : `Add funds, then: ${o.resume}`}
                  className="group flex items-center gap-2 w-full text-left text-[12px] px-3 py-2 max-lg:min-h-10 rounded-lg border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] disabled:opacity-50 transition-colors"
                >
                  {busy || (waiting && watch.status === 'watching') ? (
                    <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-[color:var(--muted-2)]" />
                  ) : (
                    <CreditCard className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--accent)]" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-[color:var(--fg)] font-medium">
                      {arrived ? 'Keep going now' : waiting ? 'Funded it — pick up where I left off' : o.label}
                    </span>
                  </span>
                </button>
                )}
                {waiting && !arrived && !fired && (
                  <div className="px-1 text-[11px] text-[color:var(--muted-2)]">
                    {watch.status === 'timeout'
                      ? `Stopped watching ${chainName} after a while — when the purchase lands, press the button above.`
                      : watch.failures >= 3
                        ? `${chainName} isn’t answering right now — still trying. Press the button above once it’s there.`
                        : `Stripe opened in a new tab — finish the purchase there, then come back. Watching ${chainName} for the funds — this continues on its own when they land${watch.lastReadAt ? ` · checked ${Math.max(1, Math.round((Date.now() - new Date(watch.lastReadAt).getTime()) / 1000))}s ago` : ''}.`}
                  </div>
                )}
              </div>
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
