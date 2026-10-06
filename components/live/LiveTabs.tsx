'use client'

// The /live views (2026-10-06): Tape · The Front · The Siege · The Map. One
// strip, rendered in each view's own bar. A tab is a real link (`?view=`),
// so a view can be shared and the back button works; the armies, the window
// and the pick mode ride along when a battle view hands off to another.
// The battle views keep those in the URL with replaceState, which the
// router never sees, so the href is read off the address bar at click time
// (the rendered href is the no-JS fallback).

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { LIVE_VIEWS, type LiveView } from '@/lib/battle'

const CARRIED = ['t', 'since', 'pick'] as const

function hrefFor(id: LiveView, search: string): string {
  const params = new URLSearchParams(search)
  const q = new URLSearchParams()
  for (const k of CARRIED) {
    const v = params.get(k)
    if (v) q.set(k, v)
  }
  if (id !== 'tape') q.set('view', id)
  const s = q.toString()
  return `/live${s ? `?${s}` : ''}`
}

export default function LiveTabs({ view }: { view: LiveView }) {
  const router = useRouter()
  const params = useSearchParams()
  const rendered = params?.toString() ?? ''
  return (
    <nav className="live__views" aria-label="Live views">
      {LIVE_VIEWS.map((v) => (
        <Link
          key={v.id}
          href={hrefFor(v.id, rendered)}
          className={`live__view${view === v.id ? ' is-on' : ''}`}
          aria-current={view === v.id ? 'page' : undefined}
          prefetch={false}
          title={v.blurb}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
            e.preventDefault()
            router.push(hrefFor(v.id, window.location.search))
          }}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  )
}
