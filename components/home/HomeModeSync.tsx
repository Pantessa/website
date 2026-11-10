'use client'

// The home's posture after mount (squad landing, 2026-11-10; lane HERO owns
// this file). The inline script (lib/home-mode HOME_MODE_BOOTSTRAP) sets
// `data-home` on <html> before first paint on a real page load. A SOFT
// navigation to `/` runs no inline script, so the same rule runs here, in a
// layout effect, before the browser paints the new page. It also listens
// for the visitor's own choice (the tour's "hide" / "show the tour"
// controls write HOME_TOUR_PREF_KEY and dispatch `pantessa:home-mode`).

import { useLayoutEffect } from 'react'
import { walletRemembered } from '@/lib/app-entry'
import { HOME_MODE_ATTR, HOME_TOUR_PREF_KEY, HOME_VISITS_KEY, homeModeFrom, noteVisit, parseVisits, type HomeMode } from '@/lib/home-mode'

/** The event a control dispatches after it writes the preference. */
export const HOME_MODE_EVENT = 'pantessa:home-mode'

function readMode(): HomeMode {
  try {
    const L = window.localStorage
    const today = new Date().toISOString().slice(0, 10)
    const before = parseVisits(L.getItem(HOME_VISITS_KEY))
    const after = noteVisit(before, today)
    if (after !== before) L.setItem(HOME_VISITS_KEY, JSON.stringify(after))
    return homeModeFrom({ pref: L.getItem(HOME_TOUR_PREF_KEY), visitDays: after.n, walletRemembered: walletRemembered((k) => L.getItem(k)) })
  } catch {
    return 'new'
  }
}

/** Write the visitor's choice and re-apply the posture now. */
export function setTourPref(pref: 'open' | 'closed'): void {
  try {
    window.localStorage.setItem(HOME_TOUR_PREF_KEY, pref)
  } catch {
    /* storage refused: the choice lasts for this page only */
  }
  document.documentElement.setAttribute(HOME_MODE_ATTR, pref === 'open' ? 'new' : 'return')
  window.dispatchEvent(new Event(HOME_MODE_EVENT))
}

export default function HomeModeSync() {
  useLayoutEffect(() => {
    const apply = () => document.documentElement.setAttribute(HOME_MODE_ATTR, readMode())
    apply()
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === HOME_TOUR_PREF_KEY) apply()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return null
}
