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
import { useAccount } from 'wagmi'
import { isAdminAddress } from '@/lib/admin'
import { flushJourney, journeyOff, labelOfClick, markTeamBrowser, observeFetch, setJourneyWallet, shouldLogScriptError, trackJourney } from '@/lib/journey'
import { useSession } from '@/lib/session'

const MAX_ERRORS_PER_LOAD = 8

export default function JourneyTracker() {
  const pathname = usePathname()
  const { address } = useSession()
  const { address: wallet, connector } = useAccount()
  // The page currently being timed.
  const page = useRef<{ path: string; visibleSince: number | null; scroll: number; input: boolean } | null>(null)
  // Has this page load seen a press yet? A wallet that shows up before one
  // came back on its own (wagmi's reconnect); after one, the visitor connected it.
  const pressed = useRef(false)
  // Re-arms the once-only input listeners; set by the listener effect below.
  const armInput = useRef<() => void>(() => {})

  // The wallet rides every batch from the moment it is here. Read straight
  // off wagmi: its onConnect callback does not fire for every reconnect, and
  // a returning wallet is exactly the person whose timeline needs a name.
  const lastWallet = useRef<string | null>(null)
  useEffect(() => {
    const now = wallet ? wallet.toLowerCase() : null
    if (now === lastWallet.current) return
    const before = lastWallet.current
    lastWallet.current = now
    setJourneyWallet(now)
    if (now) trackJourney('event', 'wallet_seen', { connector: connector?.name ?? 'unknown', returning: !pressed.current, switched: before !== null })
    else if (before) trackJourney('event', 'wallet_gone')
  }, [wallet, connector])

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
    // "A hand touched it" is judged per page, so each page listens afresh.
    armInput.current()
    trackJourney('view', null, undefined, pathname)
  }, [pathname])

  // Page-lifetime listeners: mounted once. Not at all on /embed or for a
  // browser that opted out: nothing is wrapped, nothing listens.
  useEffect(() => {
    if (journeyOff()) return
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
      pressed.current = true
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
    // Once per page, not once per load: pointermove fires by the hundred, and
    // one is all a page needs. addEventListener ignores a duplicate, so
    // re-arming a listener that has not fired yet is harmless.
    const arm = () => {
      window.addEventListener('pointermove', touch, { passive: true, once: true })
      window.addEventListener('touchstart', touch, { passive: true, once: true })
      window.addEventListener('keydown', touch, { passive: true, once: true })
    }
    armInput.current = arm
    arm()
    window.addEventListener('scroll', onScroll, passive)
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
      armInput.current = () => {}
      restoreFetch()
    }
  }, [])

  return null
}
