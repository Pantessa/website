'use client'

// The home's posture after mount (squad landing, 2026-11-10; lane HERO owns
// this file). The inline script (lib/home-mode HOME_MODE_BOOTSTRAP) sets
// `data-home` on <html> before first paint on a real page load. A SOFT
// navigation to `/` runs no inline script, so the same rule runs here, in a
// layout effect, before the browser paints the new page. It also listens
// for the visitor's own choice (the tour's "hide" / "show the tour"
// controls and the hero's "Tour" door write HOME_TOUR_PREF_KEY through
// setTourPref, which dispatches `pantessa:home-mode`; another tab's choice
// arrives as a storage event).
//
// THE SESSION (lib/home-mode, "a signed-in session with no remembered
// wallet"): a session known at mount (a soft navigation from inside the
// app) folds the page before its first paint. One that resolves AFTER the
// page is drawn is only remembered for the next paint (HOME_USER_KEY) — a
// drawn page never changes posture by itself, so it cannot flash or jump.

import { useEffect, useLayoutEffect, useRef } from 'react'
import { walletRemembered } from '@/lib/app-entry'
import { useSession } from '@/lib/session'
import { HOME_MODE_ATTR, HOME_TOUR_PREF_KEY, HOME_USER_KEY, HOME_USER_MARK, HOME_VISITS_KEY, homeModeForPref, homeModeFrom, noteVisit, parseVisits, sessionMemo, type HomeMode } from '@/lib/home-mode'

/** The event a control dispatches after it writes the preference. */
export const HOME_MODE_EVENT = 'pantessa:home-mode'

function readMode(sessionKnown: boolean): HomeMode {
  try {
    const L = window.localStorage
    const today = new Date().toISOString().slice(0, 10)
    const before = parseVisits(L.getItem(HOME_VISITS_KEY))
    const after = noteVisit(before, today)
    if (after !== before) L.setItem(HOME_VISITS_KEY, JSON.stringify(after))
    return homeModeFrom({
      pref: L.getItem(HOME_TOUR_PREF_KEY),
      visitDays: after.n,
      walletRemembered: walletRemembered((k) => L.getItem(k)),
      sessionRemembered: sessionKnown || L.getItem(HOME_USER_KEY) === HOME_USER_MARK,
    })
  } catch {
    return 'new'
  }
}

/** Put a posture on the page; tell the listeners only when it changed. */
function applyMode(mode: HomeMode): void {
  const root = document.documentElement
  if (root.getAttribute(HOME_MODE_ATTR) === mode) return
  root.setAttribute(HOME_MODE_ATTR, mode)
  window.dispatchEvent(new Event(HOME_MODE_EVENT))
}

/** Write the visitor's choice and re-apply the posture now. */
export function setTourPref(pref: 'open' | 'closed'): void {
  try {
    window.localStorage.setItem(HOME_TOUR_PREF_KEY, pref)
  } catch {
    /* storage refused: the choice lasts for this page only */
  }
  document.documentElement.setAttribute(HOME_MODE_ATTR, homeModeForPref(pref))
  window.dispatchEvent(new Event(HOME_MODE_EVENT))
}

export default function HomeModeSync() {
  const { status } = useSession()
  // The session as this page MOUNTED with it: 'authed' only on a soft
  // navigation from inside the app (a real load starts at 'loading').
  const atMount = useRef(status)
  useLayoutEffect(() => {
    applyMode(readMode(atMount.current === 'authed'))
    // Another tab's choice. Nothing else re-reads the posture of a drawn page.
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === HOME_TOUR_PREF_KEY) applyMode(readMode(atMount.current === 'authed'))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  // The session, once known, is remembered for the NEXT paint of the home.
  useEffect(() => {
    const memo = sessionMemo(status)
    if (!memo) return
    try {
      if (memo === 'set') window.localStorage.setItem(HOME_USER_KEY, HOME_USER_MARK)
      else window.localStorage.removeItem(HOME_USER_KEY)
    } catch {
      /* storage refused: the next paint decides by the other rules */
    }
  }, [status])
  return null
}
