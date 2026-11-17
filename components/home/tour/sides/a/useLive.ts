'use client'

// THE TOUR · SIDES-A's live reads (squad landing, 2026-11-10). Two small
// hooks every miniature in this lane shares, so the rule is written once:
// a panel reads a cached route ONLY while it is on screen and the tab is in
// view (the home opens no stream; components/home/TheRead.tsx is the model).
// A read that fails keeps the last good answer and says so through `failed`.

import { useEffect, useRef, useState, type RefObject } from 'react'

/** A ref for the miniature's root, and whether it is worth reading for: the
 *  element is on screen (or about to be) and the tab is visible. */
export function useOnScreen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [seen, setSeen] = useState(false)
  const [tab, setTab] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver((entries) => setSeen(entries.some((e) => e.isIntersecting)), { rootMargin: '160px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    const read = () => setTab(document.visibilityState === 'visible')
    read()
    document.addEventListener('visibilitychange', read)
    return () => document.removeEventListener('visibilitychange', read)
  }, [])
  return [ref, seen && tab]
}

/** One cached route, re-read every `everyMs` while `active`. `accept` turns
 *  the body into the value or NULL (a body that is not an answer). Coming
 *  back on screen inside the interval does not re-read early. */
export function usePolled<T>(url: string, everyMs: number, active: boolean, accept: (body: unknown) => T | null): { data: T | null; failed: boolean } {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const acceptRef = useRef(accept)
  const lastAt = useRef(0)
  useEffect(() => {
    acceptRef.current = accept
  })
  useEffect(() => {
    if (!active) return
    let alive = true
    let timer: ReturnType<typeof setInterval> | undefined
    const pull = async () => {
      lastAt.current = Date.now()
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const next = acceptRef.current(await res.json())
        if (!alive) return
        if (next === null) setFailed(true)
        else {
          setData(next)
          setFailed(false)
        }
      } catch {
        if (alive) setFailed(true)
      }
    }
    const first = setTimeout(
      () => {
        void pull()
        timer = setInterval(() => void pull(), everyMs)
      },
      lastAt.current === 0 ? 0 : Math.max(0, everyMs - (Date.now() - lastAt.current)),
    )
    return () => {
      alive = false
      clearTimeout(first)
      if (timer) clearInterval(timer)
    }
  }, [url, everyMs, active])
  return { data, failed }
}
