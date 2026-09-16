'use client'
// The arrival moment — what the visitor sees on /chat when a chip they clicked
// on /markets is about to run (or just ran). CORE mounts it once, above the
// thread, with the intent it took; UX owns this file's body and its lifetime.
//
// It is a SYSTEM ROW in the thread, not a modal: the Emerald Cut brewing
// (bands lighting outer → inner, the watchlist rail's idiom) beside the ask
// in the chat's display face, an eyebrow that names the page they left, and
// one honest line underneath. The visitor tapped a chip a second ago; this
// row is how the app says it caught the ball before the composer fires on
// its own.
//
// Lifetime (all of it lives here, CORE only passes the phase):
//   holding  → the cascade runs; the sub says it sends itself once the
//              wallet is ready. After ARRIVAL_HOLD_TIMEOUT_MS with no fire
//              the row goes QUIET (`waiting`): stone still, "Ready when you
//              are." — it never claims a run that hasn't happened.
//   sent     → the stone settles fully lit with one pulse, the pill reads
//              SENT; after the first assistant turn lands (and at least
//              ARRIVAL_SENT_LINGER_MS) the row fades and hands control back
//              through onDismiss.
//   dismiss  → rendered only when CORE passes onDismiss. In holding/waiting
//              CORE drops the pending fire, so the label says "Don't run it";
//              in sent it is a plain "Dismiss" that fades first.
// Reduced motion: no cascade, no pulse, no rise — opacity only (arrival.css).
//
// Squad ARRIVAL (2026-09-16) — UX owns this file.

import { useEffect, useRef, useState } from 'react'
import { PantessaMark } from '@/components/Logo'
import { useYeetfulStore } from '@/lib/store'
import type { ArrivalIntent } from '@/lib/arrival-intent'
import {
  ARRIVAL_DISMISS_LABEL,
  ARRIVAL_EYEBROW,
  ARRIVAL_FADE_MS,
  ARRIVAL_HOLD_TIMEOUT_MS,
  ARRIVAL_SENT_LINGER_MS,
  ARRIVAL_STATE_WORD,
  ARRIVAL_SUB,
  arrivalAskLine,
  arrivalSourceLabel,
  arrivalStatusText,
  arrivalView,
} from '@/lib/arrival-copy'
import './arrival.css'

/** `holding` = waiting for the wallet / servers to settle; `sent` = the turn fired. */
export type ArrivalPhase = 'holding' | 'sent'

export type ArrivalBannerProps = {
  intent: ArrivalIntent
  phase: ArrivalPhase
  onDismiss?: () => void
}

/** Assistant turns in the current thread — the signal that the reply landed. */
function useAssistantTurns(): number {
  return useYeetfulStore((s) => {
    const chat = s.chats.find((c) => c.id === s.currentChatId)
    if (!chat) return 0
    let n = 0
    for (const m of chat.messages) if (m.role === 'assistant') n++
    return n
  })
}

export default function ArrivalBanner({ intent, phase, onDismiss }: ArrivalBannerProps) {
  // The honest edge: holding past the timeout with no fire → quiet.
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    if (phase !== 'holding') return
    const t = window.setTimeout(() => setTimedOut(true), ARRIVAL_HOLD_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [phase])
  const view = arrivalView(phase, timedOut)

  // Fade after the first assistant turn that lands AFTER the send — a thread
  // the visitor already had (restored currentChatId) may hold older replies,
  // so the baseline is the count at the moment the phase flipped to sent.
  const turns = useAssistantTurns()
  const sentAtRef = useRef<number | null>(null)
  const baselineRef = useRef<number>(0)
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)
  useEffect(() => {
    if (phase !== 'sent' || sentAtRef.current != null) return
    sentAtRef.current = Date.now()
    baselineRef.current = turns
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])
  useEffect(() => {
    if (phase !== 'sent' || leaving || gone) return
    if (turns <= baselineRef.current) return
    const since = Date.now() - (sentAtRef.current ?? Date.now())
    const wait = Math.max(0, ARRIVAL_SENT_LINGER_MS - since)
    const t = window.setTimeout(() => setLeaving(true), wait)
    return () => window.clearTimeout(t)
  }, [phase, turns, leaving, gone])

  // The exit: CSS fades for ARRIVAL_FADE_MS, then the row is gone and CORE is
  // told so it can unmount (a missing onDismiss just leaves it unmounted here).
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss
  useEffect(() => {
    if (!leaving) return
    const t = window.setTimeout(() => {
      setGone(true)
      onDismissRef.current?.()
    }, ARRIVAL_FADE_MS)
    return () => window.clearTimeout(t)
  }, [leaving])

  if (gone) return null

  const ask = arrivalAskLine(intent.text)
  const source = arrivalSourceLabel(intent.from)
  const dismiss = () => {
    // Before the fire, CORE's dismiss DROPS the pending send — leave at once,
    // no fade, so nothing on screen suggests it might still run.
    if (view !== 'sent') {
      setGone(true)
      onDismiss?.()
      return
    }
    setLeaving(true)
  }

  return (
    <div
      className={`arrival arrival--${view}${leaving ? ' arrival--leaving' : ''}`}
      data-arrival={view}
      role="status"
      aria-live="polite"
    >
      <span className="arrival__mark" aria-hidden>
        <PantessaMark size={36} weight="mark" bandClassName="arrival__band" />
      </span>
      <div className="arrival__body">
        <div className="arrival__eyebrow" aria-hidden>
          <span className="arrival__from">{source === 'Markets' ? ARRIVAL_EYEBROW : `From ${source}`}</span>
          <span className="arrival__state">
            <span className="arrival__dot" />
            {ARRIVAL_STATE_WORD[view]}
          </span>
        </div>
        <p className="arrival__ask" aria-hidden>
          {ask}
        </p>
        <p className="arrival__sub" aria-hidden>
          {ARRIVAL_SUB[view]}
        </p>
        <span className="sr-only">{arrivalStatusText(view, intent.from, intent.text)}</span>
      </div>
      {onDismiss && (
        <button type="button" className="arrival__x" aria-label={ARRIVAL_DISMISS_LABEL[view]} title={ARRIVAL_DISMISS_LABEL[view]} onClick={dismiss}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}
