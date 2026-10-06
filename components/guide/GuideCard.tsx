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
// The card decides nothing. lib/guide picked the hint; the seat (GuideSeat)
// owns the record and the journey events and hands the card its handlers.
// GUIDE lane owns this file.

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
}

const OFF_LABEL = 'Don’t show tips'

export default function GuideCard({ hint, ctx, onCta, onDismiss, onOff, onAsk }: GuideCardProps) {
  const cta = guideCta(hint, ctx)
  const n = guideIndexOf(hint.id)
  const titleId = `guide-${hint.id}-title`

  const scrollTo = (selector: string) => {
    const el = document.querySelector<HTMLElement>(selector)
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  const action = (() => {
    if (!cta) return null
    const common = { className: 'guide__cta', 'data-guide-cta': cta.kind } as const
    switch (cta.kind) {
      case 'href':
        return (
          <a {...common} href={cta.value} onClick={() => onCta(cta)}>
            {cta.label}
          </a>
        )
      case 'spine':
        return (
          <SpineLink {...common} href={cta.value} prefetch={false} onClick={() => onCta(cta)}>
            {cta.label}
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
            {cta.label}
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
            {cta.label}
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
            {cta.label}
          </button>
        )
    }
  })()

  return (
    <aside className="guide" role="note" aria-labelledby={titleId} data-guide={hint.id}>
      <span className="guide__mark" aria-hidden>
        <PantessaMark size={20} />
      </span>
      <div className="guide__body">
        <div className="guide__eyebrow" aria-hidden>
          GUIDE · {n}/{GUIDE_TOTAL}
        </div>
        <p id={titleId} className="guide__title">
          {renderGuideText(hint.title, ctx)}
        </p>
        <p className="guide__text">{renderGuideText(hint.body, ctx)}</p>
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
        </div>
      </div>
    </aside>
  )
}
