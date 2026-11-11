'use client'

// A route that opens on a loading skeleton lands at its top (2026-11-11).
//
// Next scrolls a pushed page to the top by finding the first DOM node of the
// new segment. While the page loads, that segment is the loading.tsx fallback,
// and Next renders the fallback's stylesheet <link>s BEFORE the skeleton
// (layout-router's LoadingBoundary: styles, scripts, then the component).
// React hoists those links into <head>, so Next walks <head>, finds nothing
// visible and gives up; when the real page streams in it does not try again.
// A row clicked low on `/` (the Macro board) opened /t/<sym> clamped to the
// bottom of the short skeleton, and the browser's scroll anchoring kept it at
// the bottom while the page grew under it.
//
// This does the scroll Next skipped, only where Next would have scrolled: a
// client navigation (never the first load, whose position is the browser's),
// no #hash, and not a back/forward (the browser restores those). The window
// only: on a phone the document never scrolls and the frame's scroller is a
// new element that starts at 0 (PhoneShellMount owns its memory).

import { useLayoutEffect, useState } from 'react'
import { useHydrated } from '@/lib/use-hydrated'

/** A back/forward this recent is the browser's to place. */
export const POP_GRACE_MS = 1500

let poppedAt = Number.NEGATIVE_INFINITY
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    poppedAt = performance.now()
  })
}

export default function ArriveAtTop() {
  // False only when this mount is the first load's hydration.
  const hydrated = useHydrated()
  const [byNavigation] = useState(hydrated)
  useLayoutEffect(() => {
    if (!byNavigation) return
    if (window.location.hash) return
    if (performance.now() - poppedAt < POP_GRACE_MS) return
    if (window.scrollY > 0) window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [byNavigation])
  return null
}
