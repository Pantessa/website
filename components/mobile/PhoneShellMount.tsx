'use client'

// The phone shell's one global mount (squad mobile-native, 2026-09-24; SHELL
// owns it). Mounted once in app/layout.tsx. No UI. Three jobs:
//
//   1. The keyboard → the document. `html[data-keyboard]` and `--kb-inset`
//      (lib/phone-shell KEYBOARD_ATTR / KB_INSET_VAR) reflect useSoftKeyboard,
//      so app/native-shell.css can shrink the frame onto the keyboard and hide
//      the tab bar while it's up.
//   2. Route scroll memory for the frame's scroller (lib/app-scroller). The
//      browser restores the WINDOW's position on back/forward and a reload;
//      an inner scroller gets nothing, and a same-segment push (/t/AAPL →
//      /t/TSLA re-renders the same DOM) would even keep the old position. So:
//      a push lands at the top, back/forward and a reload restore what was
//      remembered for that path + search (sessionStorage, per tab), and a
//      REPLACE keeps the scroll (lib/phone-shell scrollKindFor: the chat's
//      /chat → /chat/<id> catch-up after its first turn is a replaceState, and
//      it used to read as a push and scroll the thread to 0 — CHAT's finding).
//      The kind is read off history itself: pushState / replaceState are
//      wrapped (by METHOD, whichever side of Next's own patch we land on —
//      only calls that change the pathname count) and popstate is watched.
//   3. `theme-color` follows the SITE theme: the head's meta is written by
//      THEME_BOOTSTRAP (app/layout.tsx) before first paint and on every
//      data-theme change; this mount only asserts it exists after hydration
//      (a belt for a head that lost the script).

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { appScrollTop, hasAppScroller, scrollAppTo } from '@/lib/app-scroller'
import { KB_INSET_VAR, KEYBOARD_ATTR, historyUrlChangesPath, scrollKindFor, scrollMemoryKey, themeColorFor, type HistoryOp } from '@/lib/phone-shell'
import { useSoftKeyboard } from './useSoftKeyboard'

function KeyboardReflector() {
  const { open, inset } = useSoftKeyboard()
  useEffect(() => {
    const el = document.documentElement
    if (open) {
      el.setAttribute(KEYBOARD_ATTR, '1')
      el.style.setProperty(KB_INSET_VAR, `${inset}px`)
    } else {
      el.removeAttribute(KEYBOARD_ATTR)
      el.style.setProperty(KB_INSET_VAR, '0px')
    }
    return () => {
      el.removeAttribute(KEYBOARD_ATTR)
      el.style.removeProperty(KB_INSET_VAR)
    }
  }, [open, inset])
  return null
}

function readMemory(key: string): number | null {
  try {
    const v = sessionStorage.getItem(key)
    if (v == null) return null
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}
function writeMemory(key: string, top: number) {
  try {
    if (top > 0) sessionStorage.setItem(key, String(Math.round(top)))
    else sessionStorage.removeItem(key)
  } catch {
    /* private mode: no memory, no harm */
  }
}

function ScrollMemory() {
  const pathname = usePathname()
  // The last pathname-changing history op since the last route effect.
  const lastOp = useRef<HistoryOp>(null)
  // The pathname the screen showed at the last route effect.
  const seenPath = useRef<string | null>(null)
  const first = useRef(true)

  useEffect(() => {
    seenPath.current ??= window.location.pathname
    const h = window.history
    const origPush = h.pushState
    const origReplace = h.replaceState
    const mark = (op: HistoryOp, url: string | URL | null | undefined) => {
      if (historyUrlChangesPath(window.location.pathname, url, window.location.href)) lastOp.current = op
    }
    const pushWrapped = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      mark('push', url)
      return origPush.call(this, data, unused, url)
    }
    const replaceWrapped = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      mark('replace', url)
      return origReplace.call(this, data, unused, url)
    }
    h.pushState = pushWrapped
    h.replaceState = replaceWrapped
    const onPop = () => {
      // The URL has already moved when popstate fires; a same-path pop (a
      // sheet's history entry) is no screen change.
      if (window.location.pathname !== seenPath.current) lastOp.current = 'pop'
    }
    window.addEventListener('popstate', onPop)
    // Record the live position of the frame's scroller, per screen. The
    // window's own position is the browser's business.
    let raf = 0
    const onScroll = (e: Event) => {
      const t = e.target
      if (!(t instanceof HTMLElement) || !t.hasAttribute('data-app-scroll')) return
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        writeMemory(scrollMemoryKey(location.pathname, location.search), appScrollTop())
      })
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      // Unwrap only if nobody wrapped over us since.
      if (h.pushState === pushWrapped) h.pushState = origPush
      if (h.replaceState === replaceWrapped) h.replaceState = origReplace
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('scroll', onScroll, { capture: true })
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    if (!pathname) return
    let how: 'restore' | 'top' | 'keep'
    if (first.current) {
      first.current = false
      // The first paint: a reload or a back/forward arrival restores; a fresh
      // load is already at the top.
      const nav = performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined
      how = nav && (nav.type === 'reload' || nav.type === 'back_forward') ? 'restore' : 'keep'
    } else {
      how = scrollKindFor(lastOp.current)
    }
    lastOp.current = null
    seenPath.current = pathname
    if (!hasAppScroller()) return
    if (how === 'keep') return
    if (how === 'top') {
      // A new screen starts at its top (the DOM may be reused: /t/AAPL → /t/TSLA).
      scrollAppTo(0, 'auto')
      return
    }
    const key = scrollMemoryKey(location.pathname, location.search)
    const want = readMemory(key)
    if (want == null) return
    // Restore once the screen has its height: now, and again as data lands.
    let tries = 0
    let timer = 0
    const attempt = () => {
      if (!hasAppScroller()) return
      scrollAppTo(want, 'auto')
      if (Math.abs(appScrollTop() - want) <= 2 || ++tries >= 6) return
      timer = window.setTimeout(attempt, 120 * tries)
    }
    const r = requestAnimationFrame(attempt)
    return () => {
      cancelAnimationFrame(r)
      window.clearTimeout(timer)
    }
  }, [pathname])
  return null
}

function ThemeColorBelt() {
  useEffect(() => {
    const head = document.head
    if (head.querySelector('meta[name="theme-color"]:not([media])')) return
    const m = document.createElement('meta')
    m.name = 'theme-color'
    m.content = themeColorFor(document.documentElement.dataset.theme)
    head.insertBefore(m, head.firstChild)
  }, [])
  return null
}

export default function PhoneShellMount() {
  return (
    <>
      <KeyboardReflector />
      <ScrollMemory />
      <ThemeColorBelt />
    </>
  )
}
