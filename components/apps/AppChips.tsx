'use client'

// YOUR APPS: the row that decides the page (squad apps-page; re-cut
// 2026-11-19, Nate: "Browse all seems hard to find as it's just more to
// read... we could just show the logo but then show the MCP title when in
// selecting more mode on the drop down").
//
// The apps that are on are MARKS (components/apps/AppMarks): no names in the
// row, so five apps take the room one named chip did. The only words left on
// the row's left are ONE button, "Add app", so it cannot be missed. It drops
// the picker (components/apps/AppPicker): every app spelled out with a
// switch, yours first, a search on top. Adding and removing both happen
// there; a press on a mark opens it on that app's row.
//
// The row is one line at every width (lib/apps-dock marksPlan): the button
// folds to its icon before any mark is hidden, and marks that still do not
// fit are counted in a "+N". Nothing the old tray could do is lost: the whole
// free fleet, the paid catalog and each app's page are in the picker.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { marksPlan } from '@/lib/apps-dock'
import AppMarks from '@/components/apps/AppMarks'
import AppPicker from '@/components/apps/AppPicker'
import { useAppSet } from '@/components/apps/useAppSet'
import './dock.css'
import './picker.css'

/** A mark's width and the gap after it, px (picker.css `.apgk-mark`, `.apgk-marks`). */
const MARK = 36
const MARK_GAP = 6
/** The button as its icon, and what surrounds its words (padding, icon, gap,
 *  border), px. Both carry the 4px by which the gap before the button is
 *  wider than the gap between marks (dock.css `.apgd-list`). */
const ADD_COMPACT = 42
const ADD_CHROME = 55
/** The picker's exit, ms (picker.css `apgk-close`). */
const CLOSE_MS = 140
/** The picker's widest, and the room it keeps from the row's edges, px. */
const POP_WIDTH = 540
const POP_EDGE = 12

type Phase = 'closed' | 'open' | 'closing'

export default function AppChips({ right }: { right?: React.ReactNode }) {
  const { servers, active, toggle } = useAppSet()
  const [phase, setPhase] = useState<Phase>('closed')
  const [focusSlug, setFocusSlug] = useState<string | undefined>()
  const [openCount, setOpenCount] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // ── One line: how many marks fit, and whether the button keeps its words ──
  const [plan, setPlan] = useState({ shown: Number.POSITIVE_INFINITY, more: 0, compact: false })
  // Where the picker hangs: under the marks, pulled in from the right edge
  // when the row is narrow; it grows out of the button (`origin`).
  const [pop, setPop] = useState({ left: POP_EDGE, origin: 40 })
  const measure = useCallback(() => {
    const list = listRef.current
    const root = rootRef.current
    if (!list || !root) return
    const label = addRef.current?.querySelector<HTMLElement>('.apgk-add__label')?.offsetWidth ?? 56
    const next = marksPlan({ width: list.clientWidth, count: active.length, mark: MARK, gap: MARK_GAP, add: label + ADD_CHROME, addCompact: ADD_COMPACT })
    setPlan((p) => (p.shown === next.shown && p.more === next.more && p.compact === next.compact ? p : next))
    const width = Math.min(POP_WIDTH, root.clientWidth - POP_EDGE * 2)
    const left = Math.max(POP_EDGE, Math.min(list.offsetLeft, root.clientWidth - width - POP_EDGE))
    const add = addRef.current
    const origin = add ? add.offsetLeft + add.offsetWidth / 2 - left : 40
    setPop((p) => (p.left === left && p.origin === origin ? p : { left, origin }))
  }, [active.length])
  useLayoutEffect(() => {
    measure()
  }, [measure, phase])
  useEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(list)
    return () => ro.disconnect()
  }, [measure])

  // ── Open and close ────────────────────────────────────────────────────────
  const open = (slug?: string) => {
    setFocusSlug(slug)
    setOpenCount((n) => n + 1)
    setPhase('open')
  }
  const close = useCallback((refocus = false) => {
    setPhase((p) => (p === 'open' ? 'closing' : p))
    if (refocus) addRef.current?.focus()
  }, [])
  useEffect(() => {
    if (phase !== 'closing') return
    const t = setTimeout(() => setPhase('closed'), CLOSE_MS)
    return () => clearTimeout(t)
  }, [phase])

  // Escape (the search clears itself first: it prevents the default) and a
  // press anywhere but the marks, the button and the picker close it.
  useEffect(() => {
    if (phase !== 'open') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close(!!popRef.current?.contains(document.activeElement))
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (t && (listRef.current?.contains(t) || popRef.current?.contains(t))) return
      close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [phase, close])

  const isOpen = phase === 'open'
  const label = isOpen ? 'Done' : active.length ? 'Add app' : 'Add an app'

  return (
    <div ref={rootRef} className="apg-chips apgd-chips" data-apps-chips="" data-picker={phase}>
      <div className="apg-chips__row apgd-row">
        <span className="apg-eyebrow apg-chips__label apgd-label">Your apps</span>
        <div ref={listRef} className="apgd-list" data-compact={plan.compact ? '' : undefined}>
          <AppMarks active={active} shown={Number.isFinite(plan.shown) ? plan.shown : undefined} onOpen={(slug) => (isOpen ? setFocusSlug(slug) : open(slug))} />
          <button
            ref={addRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-controls="apgk-pop"
            onClick={() => (isOpen ? close() : open())}
            className="apgk-add"
            data-apps-add=""
            aria-label={isOpen ? 'Close the app list' : 'Add or remove apps'}
            title={isOpen ? 'Close' : 'Add or remove apps'}
          >
            <span className="apgk-add__icon" aria-hidden>
              <Plus width={14} height={14} strokeWidth={2.4} />
            </span>
            <span className="apgk-add__label">{label}</span>
          </button>
        </div>
        {right && <div className="apg-chips__right">{right}</div>}
      </div>
      {phase !== 'closed' && (
        <div
          ref={popRef}
          id="apgk-pop"
          role="dialog"
          aria-label="Add or remove apps"
          className="apgk-pop"
          data-apps-pop=""
          data-state={phase}
          style={{ left: pop.left, ['--apgk-ox' as string]: `${pop.origin}px` }}
        >
          <AppPicker key={openCount} servers={servers} active={active} onToggle={toggle} focusSlug={focusSlug} autoFocus />
        </div>
      )}
    </div>
  )
}
