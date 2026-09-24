// When the landing's phone CTA bar shows (squad mobile-native, 2026-09-24).
//
// The landing is a brochure page: its DOCUMENT scrolls, and on iOS 26 Safari
// collapses its toolbar while the document scrolls DOWN. A `position: fixed;
// bottom: 0` bar then stays where the toolbar used to be, floating ~70px up
// with the page scrolling under it (the same drift Nate saw on the tab bar).
// Safari's toolbar is expanded exactly when the reader scrolls UP (and at the
// top), so the bar shows only then: past the hero and moving up. Moving down
// it steps away, which is also what a native app's bottom bar does while you
// read. Android's Chrome hides and restores its URL bar by the same rule.
//
// Pure: the component feeds it scroll positions; the harness pins it.

/** Show once the hero (this share of the first viewport) has scrolled past,
 *  so the bar doesn't double up with the hero's own CTAs. */
export const CTA_HERO_SHARE = 0.6

/** A scroll smaller than this is a finger resting, not a direction. Slow
 *  scrolls fire many small events, so they add up against the ANCHOR (the
 *  position of the last decision) rather than being compared one by one. */
export const CTA_JITTER_PX = 6

export type CtaBarState = {
  /** Whether the bar shows. */
  shown: boolean
  /** Scroll position the next move is measured from. */
  anchorY: number
}

/** The bar's state after the page scrolled to `y` (px from the top) in a
 *  viewport `viewH` tall. */
export function ctaBarStep(prev: CtaBarState, y: number, viewH: number): CtaBarState {
  if (y <= viewH * CTA_HERO_SHARE) return { shown: false, anchorY: y }
  const dy = y - prev.anchorY
  if (Math.abs(dy) < CTA_JITTER_PX) return prev
  return { shown: dy < 0, anchorY: y }
}

/** The state on arrival: hidden, anchored where the page opened. */
export function ctaBarInitial(y: number): CtaBarState {
  return { shown: false, anchorY: y }
}
