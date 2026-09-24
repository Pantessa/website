'use client'

// Mobile-only action bar. The hero CTAs scroll away on a phone, so past the
// fold a flat, full-width primary button rises from the bottom edge.
//
// When it shows (squad mobile-native, 2026-09-24): only past the hero AND
// while the reader scrolls UP (lib/cta-bar). The landing scrolls its
// DOCUMENT, and on iOS 26 Safari collapses its toolbar while that document
// scrolls down: a bar fixed to the bottom then stays where the toolbar used
// to be and floats ~70px up with the page running under it. Safari's toolbar
// is back exactly when the reader scrolls up, so that is when this bar rises,
// and it steps away on the way down, the way a native app's bottom bar does.
//
// It says what the hero's primary CTA says, Open Markets, and goes where a
// fresh login lands (2026-09-11). Markets are public, so a stranger walks
// straight in (SpineLink links a public page plainly). Beside it, Ask: the
// bar covers the floating Ask pill's corner of the screen while it's up, so
// it carries the pill's job itself (`data-mcta` on <html> says it's up).

import { useEffect, useState } from 'react'
import SpineLink from '@/components/SpineLink'
import { PantessaMark } from '@/components/Logo'
import { appScrollTop, onAppScroll } from '@/lib/app-scroller'
import { CTA_BAR_MQ, ctaBarInitial, ctaBarOnScreen, ctaBarStep, type CtaBarState } from '@/lib/cta-bar'
import { useAskDoor } from '@/lib/ask-door'

export default function MobileCtaBar() {
  const [state, setState] = useState<CtaBarState>(() => ctaBarInitial(0))
  const openDoor = useAskDoor((s) => s.openDoor)
  // Whether this viewport draws the bar at all (the CSS's own media query,
  // one constant). Re-read on a change: a rotate crosses 640px.
  const [fits, setFits] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(CTA_BAR_MQ)
    const read = () => setFits(mq.matches)
    read()
    mq.addEventListener('change', read)
    return () => mq.removeEventListener('change', read)
  }, [])
  // On screen = the scroll state says show AND the bar is drawn here. The
  // `data-mcta` flag the ask pill steps aside for says exactly this, or a
  // landscape phone scrolled up lost both the bar and the pill.
  const show = ctaBarOnScreen(state.shown, fits)

  useEffect(() => {
    setState(ctaBarInitial(appScrollTop()))
    const read = () => setState((prev) => ctaBarStep(prev, appScrollTop(), window.innerHeight))
    return onAppScroll(read)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (show) root.dataset.mcta = 'show'
    else delete root.dataset.mcta
    return () => {
      delete root.dataset.mcta
    }
  }, [show])

  return (
    <div className={`mcta${show ? ' is-show' : ''}`} aria-hidden={!show} data-mcta-bar>
      <SpineLink href="/markets" className="btn btn--solid mcta__go" tabIndex={show ? 0 : -1}>
        Open Markets
      </SpineLink>
      <button
        type="button"
        className="btn btn--ghost mcta__ask"
        tabIndex={show ? 0 : -1}
        onClick={() => openDoor()}
        aria-label="Ask Pantessa"
      >
        <PantessaMark size={18} />
        Ask
      </button>
    </div>
  )
}
