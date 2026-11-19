'use client'

// THE APPS THAT ARE ON, AS THEIR MARKS (2026-11-19). One round mark per app:
// no name, no "x". The name is the tooltip and the accessible name, and it is
// spelled out in the picker (components/apps/AppPicker), which a press on any
// mark opens with that app's row lit. A mark never removes its app: an
// unlabeled button that deletes is a trap; the switch in the picker does it.
//
// Motion: an app that was just added pops into the row and the marks after it
// slide over; one that was removed shrinks out the same way. Both run whoever
// changed the set (the picker, or the chat turning an app on for an ask).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import BrandIcon from '@/components/BrandIcon'
import type { McpServer } from '@/lib/store'
import { cleanServerName } from '@/lib/utils'
import './picker.css'

/** How long a mark's entrance and exit hold their state, ms (picker.css). */
const MARK_MOTION_MS = 420

interface Gone {
  server: McpServer
  /** Where it sat, so it leaves from its own seat. */
  at: number
}

/** The set with its comings and goings: `fresh` ids were just added, `gone`
 *  were just removed and are still drawn while they shrink out. */
function usePresence(active: McpServer[]) {
  const prev = useRef<McpServer[] | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const [fresh, setFresh] = useState<string[]>([])
  const [gone, setGone] = useState<Gone[]>([])

  // Before paint: a removed mark is never missing for a frame.
  useLayoutEffect(() => {
    const before = prev.current
    prev.current = active
    if (!before) return
    const now = new Set(active.map((s) => s.id))
    const was = new Set(before.map((s) => s.id))
    const left = before.map((server, at) => ({ server, at })).filter((x) => !now.has(x.server.id))
    // The set arriving on load (nothing, then all of it) is not an "add".
    const came = before.length === 0 && active.length > 1 ? [] : active.filter((s) => !was.has(s.id)).map((s) => s.id)
    if (!left.length && !came.length) return
    const leftIds = new Set(left.map((x) => x.server.id))
    setGone((g) => [...g.filter((x) => !now.has(x.server.id) && !leftIds.has(x.server.id)), ...left])
    if (came.length) setFresh((f) => [...f.filter((id) => !came.includes(id)), ...came])
    const t = setTimeout(() => {
      timers.current.delete(t)
      setGone((g) => g.filter((x) => !leftIds.has(x.server.id)))
      setFresh((f) => f.filter((id) => !came.includes(id)))
    }, MARK_MOTION_MS)
    timers.current.add(t)
  }, [active])
  useEffect(() => {
    const all = timers.current
    return () => {
      for (const t of all) clearTimeout(t)
    }
  }, [])

  return { fresh, gone }
}

export default function AppMarks({
  active,
  shown,
  onOpen,
}: {
  active: McpServer[]
  /** Show only the first N (the row counts the rest as "+N"). Omit for all. */
  shown?: number
  /** Open the picker, on this app's row when a slug is given. */
  onOpen: (slug?: string) => void
}) {
  const { fresh, gone } = usePresence(active)
  const cap = shown ?? active.length
  const more = active.length - Math.min(cap, active.length)

  // The marks in order, each leaving one back in the seat it had.
  const seats: { server: McpServer; state: 'on' | 'new' | 'leaving' }[] = active
    .slice(0, cap)
    .map((server) => ({ server, state: fresh.includes(server.id) ? ('new' as const) : ('on' as const) }))
  for (const g of [...gone].sort((a, b) => a.at - b.at)) {
    if (g.at >= cap || active.some((s) => s.id === g.server.id)) continue
    seats.splice(Math.min(g.at, seats.length), 0, { server: g.server, state: 'leaving' })
  }

  return (
    <div className="apgk-marks" role="group" aria-label="Apps on this page" data-apps-marks={active.length}>
      {seats.map(({ server, state }) => {
        const name = cleanServerName(server.name)
        const leaving = state === 'leaving'
        return (
          <button
            key={server.id}
            type="button"
            className="apgk-mark"
            data-state={state}
            data-name={name}
            data-apps-mark={leaving ? undefined : server.slug}
            aria-label={`${name}, on this page. Open the app list.`}
            aria-hidden={leaving ? true : undefined}
            tabIndex={leaving ? -1 : undefined}
            disabled={leaving}
            onClick={() => onOpen(server.slug)}
          >
            <BrandIcon server={server} size={18} />
          </button>
        )
      })}
      {more > 0 && (
        <button type="button" className="apgk-mark apgk-mark--more" data-apps-more={more} data-name={`${more} more`} aria-label={`${more} more apps on this page. Open the app list.`} onClick={() => onOpen()}>
          +{more}
        </button>
      )}
    </div>
  )
}
