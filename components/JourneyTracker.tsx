'use client'

// The journey log's eyes on the page (lib/journey.ts does the sending).
// Mounted once in the root layout. No UI.
//
//   view   — every route the visitor actually lands on (never a prefetch)
//   leave  — when they leave it: seconds on the page, how far they scrolled,
//            and whether a hand ever touched it (what separates a person who
//            bounced from a script that loaded and left)
//   click  — presses on our own buttons and links, by the label we wrote
//   error / api-error — what broke in front of them
//
// The flows screen (/dashboard/admin/flows) reads these back as a timeline.

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { isAdminAddress } from '@/lib/admin'
import { flushJourney, labelOfClick, markTeamBrowser, observeFetch, shouldLogScriptError, trackJourney } from '@/lib/journey'
import { useSession } from '@/lib/session'

const MAX_ERRORS_PER_LOAD = 8

export default function JourneyTracker() {
  const pathname = usePathname()
  const { address } = useSession()
  // The page currently being timed.
  const page = useRef<{ path: string; visibleSince: number | null; scroll: number; input: boolean } | null>(null)

  // An admin signed in here once: this browser is the team's from now on.
  useEffect(() => {
    if (isAdminAddress(address)) markTeamBrowser()
  }, [address])

  // view + leave, per route.
  useEffect(() => {
    if (!pathname) return
    const closePage = () => {
      const p = page.current
      if (!p || p.visibleSince == null) return
      const ms = Date.now() - p.visibleSince
      p.visibleSince = null
      trackJourney('leave', null, { ms, scroll: Math.round(p.scroll), input: p.input }, p.path)
    }
    closePage()
    page.current = { path: pathname, visibleSince: Date.now(), scroll: 0, input: false }
    trackJourney('view', null, undefined, pathname)
  }, [pathname])

  // Page-lifetime listeners: mounted once.
  useEffect(() => {
    const restoreFetch = observeFetch()
    const seenErrors = new Set<string>()

    const touch = () => {
      if (page.current) page.current.input = true
    }
    let ticking = false
    const onScroll = () => {
      touch()
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const p = page.current
        if (!p) return
        const doc = document.documentElement
        const full = doc.scrollHeight - window.innerHeight
        const pct = full > 0 ? Math.min(100, (window.scrollY / full) * 100) : 0
        if (pct > p.scroll) p.scroll = pct
      })
    }
    const onClick = (e: MouseEvent) => {
      touch()
      const hit = labelOfClick(e.target)
      if (hit) trackJourney('click', hit.label, hit.detail)
    }
    const onVisibility = () => {
      const p = page.current
      if (!p) return
      if (document.visibilityState === 'hidden') {
        if (p.visibleSince != null) {
          trackJourney('leave', null, { ms: Date.now() - p.visibleSince, scroll: Math.round(p.scroll), input: p.input }, p.path)
          p.visibleSince = null
        }
        flushJourney(true)
      } else if (p.visibleSince == null) {
        // Back on the tab: time the rest of the stay as its own stretch, so
        // the stretches add up to the time they really spent here.
        p.visibleSince = Date.now()
      }
    }
    const onPageHide = () => {
      const p = page.current
      if (p && p.visibleSince != null) {
        trackJourney('leave', null, { ms: Date.now() - p.visibleSince, scroll: Math.round(p.scroll), input: p.input }, p.path)
        p.visibleSince = null
      }
      flushJourney(true)
    }
    const report = (message: string, source?: string | null, line?: number) => {
      if (seenErrors.size >= MAX_ERRORS_PER_LOAD || !shouldLogScriptError(message, source)) return
      const key = `${message}|${source ?? ''}|${line ?? ''}`
      if (seenErrors.has(key)) return
      seenErrors.add(key)
      const file = (source ?? '').split('/').pop()?.split('?')[0] ?? ''
      trackJourney('error', message, { ...(file ? { src: file.slice(0, 60) } : {}), ...(line ? { line } : {}) })
    }
    const onError = (e: ErrorEvent) => report(e.message, e.filename, e.lineno)
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason
      report(r instanceof Error ? `${r.name}: ${r.message}` : typeof r === 'string' ? r : 'Unhandled promise rejection')
    }

    const passive = { passive: true } as const
    window.addEventListener('scroll', onScroll, passive)
    window.addEventListener('pointermove', touch, { passive: true, once: true })
    window.addEventListener('touchstart', touch, { passive: true, once: true })
    window.addEventListener('keydown', touch, { passive: true, once: true })
    document.addEventListener('click', onClick, { capture: true, passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pointermove', touch)
      window.removeEventListener('touchstart', touch)
      window.removeEventListener('keydown', touch)
      document.removeEventListener('click', onClick, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      restoreFetch()
    }
  }, [])

  return null
}
