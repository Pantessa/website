// THE phone posture, defined once (squad mobile-native, 2026-09-24, Nate:
// "it needs to feel like a native mobile app when accessed from mobile").
//
// Below lg the spine is the bottom tab bar and every app surface is a FRAME:
// the document never scrolls, each screen has ONE inner scroller, and the bar
// sits on the bottom of the visible area. The reason is Safari on iOS 26: when
// the DOCUMENT scrolls, the browser collapses its toolbar, and a fixed or
// sticky bar anchored to the bottom stays where the toolbar used to be. It
// floats ~70px up with the page scrolling underneath it (Nate's /markets
// screenshot). A document that never scrolls never collapses the toolbar, so
// the bar has nowhere to drift.
//
// The contract is attributes, never a surface's own class names: a framed
// surface's outermost wrapper carries FRAME_ATTR, its scroll container carries
// SCROLL_ATTR, the spine's phone bar carries BAR_ATTR. SHELL's CSS and
// lib/app-scroller key off these.
//
// Pure: nothing touches the DOM at import time, so the harness pins it.

/** The phone/tablet posture: the spine is the bottom tab bar at or below this
 *  width. Tailwind's `lg` is 1024px, so this is `max-lg:` / `lg:hidden`. */
export const PHONE_MAX_PX = 1023
export const PHONE_MQ = `(max-width: ${PHONE_MAX_PX}px)`

/** The phone bar's measured height above the safe area: 48px of seat plus
 *  its own 1px top border (the mobile-onboarding squad measured it, 09-23). */
export const SPINE_BAR_PX = 49

/** On a framed surface's outermost wrapper. */
export const FRAME_ATTR = 'data-app-frame'
/** On the ONE element a framed screen scrolls. */
export const SCROLL_ATTR = 'data-app-scroll'
/** On the spine's phone tab bar (AppSpine's <nav>). */
export const BAR_ATTR = 'data-spine-bar'

/** True in a browser whose viewport is in the phone posture. False on the
 *  server, so a render never guesses. */
export function isPhoneViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_MQ).matches
}

/** Pixels the soft keyboard covers at the bottom of the layout viewport. The
 *  keyboard is what shrinks the VISUAL viewport while the layout viewport
 *  stays (iOS), and offsetTop is how far the browser panned the page to keep
 *  the focused field in view. */
export function keyboardInset(layoutHeight: number, visualHeight: number, visualOffsetTop: number): number {
  return Math.max(0, Math.round(layoutHeight - visualHeight - visualOffsetTop))
}

/** Past this many covered pixels it is a keyboard. A browser toolbar
 *  collapsing or expanding moves the viewport by well under 100px. */
export const KEYBOARD_MIN_PX = 120
