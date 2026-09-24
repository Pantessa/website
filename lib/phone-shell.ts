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

// ── SHELL round 1 additions (2026-09-24). Names are part of the contract:
// ADD only, never rename or remove.

/** On <html> while the soft keyboard is up (components/mobile/PhoneShellMount). */
export const KEYBOARD_ATTR = 'data-keyboard'
/** The covered pixels, as a CSS custom property on <html>: `--kb-inset: 312px`. */
export const KB_INSET_VAR = '--kb-inset'
/** The bar's measured height, for the one fallback where a bar is fixed
 *  (not a direct child of its frame). The in-flow bar needs no constant. */
export const SPINE_BAR_H_VAR = '--spine-bar-h'

/** The keyboard, decided from one visualViewport reading: open when the
 *  covered pixels reach KEYBOARD_MIN_PX. Pure, so the harness pins the
 *  threshold and the rounding. */
export function keyboardState(layoutHeight: number, visualHeight: number, visualOffsetTop: number): { open: boolean; inset: number } {
  const inset = keyboardInset(layoutHeight, visualHeight, visualOffsetTop)
  return { open: inset >= KEYBOARD_MIN_PX, inset: inset >= KEYBOARD_MIN_PX ? inset : 0 }
}

/** Route scroll memory (a push lands at the top, back/forward and a reload
 *  restore): one sessionStorage key per screen, path + search, never the
 *  hash (a hash jump is a scroll of its own). */
export const SCROLL_MEMORY_PREFIX = 'pantessa.scroll.v1:'
export function scrollMemoryKey(pathname: string, search: string): string {
  const q = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : ''
  return `${SCROLL_MEMORY_PREFIX}${pathname}${q}`
}

/** The document's `theme-color`, following the SITE theme (data-theme), not
 *  only the OS: the values are x402-design.css's --bg per theme (`:root`
 *  #000000, `[data-theme='light']` #fdfdfc — NOT globals.css's #09090b
 *  fallback, which the viewport meta had claimed since the theme shipped;
 *  measured against the served --bg 2026-09-24). app/layout.tsx's
 *  viewport.themeColor, THEME_BOOTSTRAP and app/manifest.ts all read this. */
export const THEME_COLORS = { dark: '#000000', light: '#fdfdfc' } as const
export function themeColorFor(theme: string | null | undefined): string {
  return theme === 'light' ? THEME_COLORS.light : THEME_COLORS.dark
}

/** The Sheet's dismiss decision after a drag on its grabber or head. A
 *  bottom sheet is dragged DOWN (delta = dy), a left sheet is dragged LEFT
 *  (delta = −dx): past a quarter of the panel (at least SHEET_DISMISS_MIN_PX),
 *  or a flick faster than SHEET_DISMISS_VELOCITY that moved at all. A drag
 *  in the wrong direction never dismisses. */
export const SHEET_DISMISS_MIN_PX = 80
export const SHEET_DISMISS_VELOCITY = 0.5 // px per ms
export const SHEET_MOTION_MS = 260
export function shouldDismissDrag(delta: number, velocityPxPerMs: number, panelSize: number): boolean {
  if (!(delta > 0)) return false
  const threshold = Math.max(SHEET_DISMISS_MIN_PX, panelSize * 0.25)
  if (delta >= threshold) return true
  return velocityPxPerMs >= SHEET_DISMISS_VELOCITY && delta >= 24
}

/** The z-index scale every phone layer sits on (documented once; CSS uses
 *  the literals). The ask pill floats over the page, the bar sits IN the
 *  frame (no z-index needed), modals cover the page, a sheet covers modals,
 *  the sign-in door covers everything. */
export const Z = { askPill: 35, spineBar: 50, askDoor: 60, modal: 70, dashDrawer: 80, sheet: 90, banner: 90, door: 100 } as const
