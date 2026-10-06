'use client'

// The /live views (2026-10-06): Tape · The Front · The Siege · The Map. One
// strip, rendered in each view's own bar. A tab is a real link (`?view=`),
// so a view can be shared and the back button works; the armies and the
// window ride along when a battle view hands off to another.

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { LIVE_VIEWS, type LiveView } from '@/lib/battle'

export default function LiveTabs({ view }: { view: LiveView }) {
  const params = useSearchParams()
  const carry = new URLSearchParams()
  for (const k of ['t', 'since', 'pick']) {
    const v = params?.get(k)
    if (v) carry.set(k, v)
  }
  return (
    <nav className="live__views" aria-label="Live views">
      {LIVE_VIEWS.map((v) => {
        const q = new URLSearchParams(carry)
        if (v.id !== 'tape') q.set('view', v.id)
        const s = q.toString()
        return (
          <Link key={v.id} href={`/live${s ? `?${s}` : ''}`} className={`live__view${view === v.id ? ' is-on' : ''}`} aria-current={view === v.id ? 'page' : undefined} prefetch={false} title={v.blurb}>
            {v.label}
          </Link>
        )
      })}
    </nav>
  )
}
