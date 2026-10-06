'use client'

// THE GUIDE CARD (squad front-door, 2026-10-06). A NOTE in the markets look,
// never a modal, never a tour overlay, never a scrim: the Emerald Cut mark,
// a mono eyebrow (GUIDE · n/N), the lesson in the chat's display face, one
// muted line under it, the one action as an accent chip, "Got it" as a text
// button, and "Don't show tips" behind a ⋯ (a <details>, so no portal and
// nothing positioned outside the card). role="note", no aria-live: it is
// something to read when you get to it, not an announcement. Reduced motion
// drops the entrance (guide.css). Dark + light from the site tokens.
//
// `compact` (the HOME seat; MOBILE's phone budget on `/`): under 640px the
// same markup lays out as ONE ROW ≤64px — mark · n/N + title (two lines at
// most) · the CTA chip wearing its short label · an × that is "Got it". The
// body line, the text "Got it" and the ⋯ step aside there; wider than 640px
// the compact card is the full card. CSS lays the row out; the chip's words
// are picked here (one text node per posture, from the same media query),
// because the journey tracker logs a click by the control's text — two
// labels in the DOM, one hidden, read as one doubled label (QA's nit, R2).
//
// The card decides nothing. lib/guide picked the hint; the seat (GuideSeat)
// owns the record and the journey events and hands the card its handlers.
// GUIDE lane owns this file.

import { useEffect, useState } from 'react'
import { useAskDoor } from '@/lib/ask-door'
import { guideCta, guideIndexOf, GUIDE_TOTAL, renderGuideText, type GuideCta, type GuideCtx, type GuideHint } from '@/lib/guide'
import { PantessaMark } from '@/components/Logo'
import SpineLink from '@/components/SpineLink'
import './guide.css'

export type GuideCardProps = {
  hint: GuideHint
  ctx: GuideCtx
  /** The card's action was used (the seat records it and lets the card go). */
  onCta: (cta: GuideCta) => void
  onDismiss: () => void
  onOff: () => void
  /** Sends an ask-shaped CTA through the connect-to-act door (the seat owns
   *  the door). Only `kind: 'ask'` CTAs need it. */
  onAsk?: (ask: string) => void
  /** One row ≤64px under 640px (the home seat on a phone). */
  compact?: boolean
}

const OFF_LABEL = 'Don’t show tips'

/** The compact row's breakpoint — the same query guide.css lays the row out
 *  under, so the words and the layout can never disagree. */
export const GUIDE_COMPACT_MQ = '(max-width: 640px)'

/** True while a compact card is laid out as the one row (viewport under the
 *  breakpoint); false otherwise, and before the first client read. */
function useCompactRow(compact: boolean): boolean {
  const [row, setRow] = useState(false)
  useEffect(() => {
    if (!compact) return
    const mq = window.matchMedia(GUIDE_COMPACT_MQ)
    const read = () => setRow(mq.matches)
    read()
    mq.addEventListener('change', read)
    return () => mq.removeEventListener('change', read)
  }, [compact])
  return compact && row
}

export default function GuideCard({ hint, ctx, onCta, onDismiss, onOff, onAsk, compact = false }: GuideCardProps) {
  const cta = guideCta(hint, ctx)
  const n = guideIndexOf(hint.id)
  const titleId = `guide-${hint.id}-title`
  const row = useCompactRow(compact)

  const scrollTo = (selector: string) => {
    const el = document.querySelector<HTMLElement>(selector)
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  // The chip's words: ONE text node — the short label while the compact row
  // is laid out, the full label otherwise. What is on screen is what the
  // journey tracker logs (lib/journey labelOfClick reads the control's text).
  const words = cta ? (row && cta.short ? cta.short : cta.label) : null

  const action = (() => {
    if (!cta) return null
    const common = { className: 'guide__cta', 'data-guide-cta': cta.kind } as const
    switch (cta.kind) {
      case 'href':
        return (
          <a {...common} href={cta.value} onClick={() => onCta(cta)}>
            {words}
          </a>
        )
      case 'spine':
        return (
          <SpineLink {...common} href={cta.value} prefetch={false} onClick={() => onCta(cta)}>
            {words}
          </SpineLink>
        )
      case 'door':
        return (
          <button
            {...common}
            type="button"
            onClick={() => {
              onCta(cta)
              // A DRAFT, never a send: on /t the door is docked into Ask the
              // chart, so this focuses its composer with the question typed.
              useAskDoor.getState().openDoor(cta.value)
            }}
          >
            {words}
          </button>
        )
      case 'ask':
        return (
          <button
            {...common}
            type="button"
            onClick={() => {
              onCta(cta)
              onAsk?.(cta.value)
            }}
          >
            {words}
          </button>
        )
      case 'scroll':
        return (
          <button
            {...common}
            type="button"
            onClick={() => {
              onCta(cta)
              scrollTo(cta.value)
            }}
          >
            {words}
          </button>
        )
    }
  })()

  return (
    <aside className={compact ? 'guide guide--compact' : 'guide'} role="note" aria-labelledby={titleId} data-guide={hint.id}>
      <span className="guide__mark" aria-hidden>
        <PantessaMark size={20} />
      </span>
      <div className="guide__body">
        <div className="guide__eyebrow" aria-hidden>
          GUIDE · {n}/{GUIDE_TOTAL}
        </div>
        <p id={titleId} className="guide__title">
          <span className="guide__num" aria-hidden>
            {n}/{GUIDE_TOTAL} ·{' '}
          </span>
          {renderGuideText(hint.title, ctx)}
        </p>
        <p className="guide__text">{renderGuideText(hint.body, ctx)}</p>
      </div>
      <div className="guide__acts">
        {action}
        <button type="button" className="guide__got" onClick={onDismiss}>
          Got it
        </button>
        <details className="guide__more">
          <summary className="guide__dots" aria-label="More options" title="More options">
            <span aria-hidden>···</span>
          </summary>
          <button type="button" className="guide__off" onClick={onOff}>
            {OFF_LABEL}
          </button>
        </details>
        {compact && (
          <button type="button" className="guide__x" aria-label="Got it" title="Got it" onClick={onDismiss}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </aside>
  )
}
