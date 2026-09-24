// What the current screen scrolls (squad mobile-native, 2026-09-24).
//
// On a phone an app surface is a frame (lib/phone-shell): the document never
// scrolls, one inner element does. On desktop the same pages scroll the
// window. Every scroll consumer (the journey log's depth, a scroll-into-view,
// "tap the lit tab to go to the top", scroll restoration) asks this module
// instead of reading `window.scrollY`, so it keeps working in both postures.
//
// SHELL owns the internals and may ADD exports, never rename or remove one.

import { SCROLL_ATTR } from '@/lib/phone-shell'

function scrollerElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector<HTMLElement>(`[${SCROLL_ATTR}]`)
  if (!el) return null
  // The attribute is present on both postures; the element only scrolls where
  // the frame's CSS makes it a scroll container (below lg).
  const oy = getComputedStyle(el).overflowY
  return oy === 'auto' || oy === 'scroll' ? el : null
}

/** The element the current screen scrolls: the frame's scroller on a phone,
 *  otherwise the window. */
export function getAppScroller(): HTMLElement | Window {
  return scrollerElement() ?? window
}

/** How far the current screen is scrolled from its top. */
export function appScrollTop(): number {
  const el = scrollerElement()
  return el ? el.scrollTop : typeof window === 'undefined' ? 0 : window.scrollY
}

/** Scroll the current screen to `top`. */
export function scrollAppTo(top: number, behavior: ScrollBehavior = 'auto'): void {
  if (typeof window === 'undefined') return
  getAppScroller().scrollTo({ top, behavior })
}

/** Subscribe to the current screen's scrolling in either posture. One
 *  capture-phase listener on the document hears the window AND any inner
 *  scroller (scroll events don't bubble, but they do capture), so the
 *  subscription survives the scroller being swapped by a navigation.
 *  Returns the unsubscribe. */
export function onAppScroll(cb: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  const handler = (e: Event) => {
    const t = e.target
    if (t === document || t === document.documentElement || (t instanceof HTMLElement && t.hasAttribute(SCROLL_ATTR))) cb()
  }
  document.addEventListener('scroll', handler, { capture: true, passive: true })
  return () => document.removeEventListener('scroll', handler, { capture: true })
}
