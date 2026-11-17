'use client'

// YOUR APPS: the row that decides the page (squad apps-page). Every app that
// is on is a pressed chip with its mark; a tap removes it. The apps that are
// off fill only the room the row has left (measured, so the row is ONE line
// at every width), an app just removed first so it is one tap from back;
// everything else is in the tray under "Browse all": the whole free fleet,
// the paid catalog, each app's page, and "Add your own MCP". Nothing the old
// drawer list (components/AppsRailTab) could do is lost.
//
// If even the on-chips do not fit, the list scrolls sideways inside itself;
// "Browse all" and the right-hand controls never scroll away.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Info, LayoutGrid, Plus } from 'lucide-react'
import BrandIcon from '@/components/BrandIcon'
import AddMcpModal from '@/components/AddMcpModal'
import { cleanServerName, cn } from '@/lib/utils'
import { offeredApps, rowPlan, trayApps, trayLine, trayPrice, type TrayView } from '@/lib/apps-dock'
import type { McpServer } from '@/lib/store'
import { useAppSet } from '@/components/apps/useAppSet'
import './dock.css'

/** The list's flex gap, px (dock.css `.apgd-list`). */
const CHIP_GAP = 8
/** "Browse all" as its icon alone, px (dock.css). */
const BROWSE_COMPACT = 38

export default function AppChips({ right }: { right?: React.ReactNode }) {
  const { servers, active, toggle } = useAppSet()
  const [trayOpen, setTrayOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  // Apps removed from the row this visit, newest first: they lead the
  // offered chips so a removal is undone with one tap.
  const [recent, setRecent] = useState<string[]>([])

  const activeIds = useMemo(() => active.map((s) => s.id), [active])
  const offered = useMemo(() => {
    const on = new Set(activeIds)
    const back = recent.map((id) => servers.find((s) => s.id === id)).filter((s): s is McpServer => !!s && !on.has(s.id))
    const backIds = new Set(back.map((s) => s.id))
    return [...back, ...offeredApps(servers, activeIds).filter((s) => !backIds.has(s.id))]
  }, [servers, activeIds, recent])

  const remove = (s: McpServer) => {
    setRecent((r) => [s.id, ...r.filter((id) => id !== s.id)].slice(0, 4))
    toggle(s)
  }

  // ── One line: measure what fits ─────────────────────────────────────────
  const listRef = useRef<HTMLDivElement>(null)
  const [plan, setPlan] = useState({ compact: false, fit: 0, overflowing: false })
  const { compact, fit, overflowing } = plan
  const measure = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const on = [...list.querySelectorAll<HTMLElement>('[data-chip-kind="on"]')]
    const off = [...list.querySelectorAll<HTMLElement>('[data-chip-kind="off"]')]
    const browse = list.querySelector<HTMLElement>('[data-chip-kind="browse"]')
    const isCompact = list.hasAttribute('data-compact')
    // A compact chip keeps its name in the DOM, out of the flow but still
    // measurable, so both widths are known in either state (one flex gap
    // sits between the mark and the name).
    const nameW = (el: HTMLElement) => (el.querySelector<HTMLElement>('.apgd-chip__name')?.offsetWidth ?? 0) + CHIP_GAP
    const next = rowPlan({
      width: list.clientWidth,
      onFull: on.map((el) => (isCompact ? el.offsetWidth + nameW(el) : el.offsetWidth)),
      onCompact: on.map((el) => (isCompact ? el.offsetWidth : el.offsetWidth - nameW(el))),
      // "Browse all" keeps its words measurable too (padding 14 + border 1 a side).
      browse: (browse?.querySelector<HTMLElement>('.apgd-browse__label')?.offsetWidth ?? 60) + 30,
      browseCompact: BROWSE_COMPACT,
      offered: off.map((el) => el.offsetWidth),
      gap: CHIP_GAP,
    })
    setPlan((p) => (p.compact === next.compact && p.fit === next.fit && p.overflowing === next.overflowing ? p : next))
  }, [])
  useLayoutEffect(() => {
    measure()
  }, [measure, active, offered])
  useEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(list)
    // The marks load late and change a chip's width.
    for (const el of list.querySelectorAll('[data-chip-kind]')) ro.observe(el)
    return () => ro.disconnect()
  }, [measure, active, offered])

  // ── The tray closes on Esc and on a click outside the row and the tray ──
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!trayOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !addOpen) setTrayOpen(false)
    }
    const onDown = (e: PointerEvent) => {
      if (addOpen) return
      const t = e.target as Node | null
      if (t && rootRef.current?.contains(t)) return
      setTrayOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [trayOpen, addOpen])

  return (
    <div ref={rootRef} className="apg-chips apgd-chips" data-apps-chips="">
      <div className="apg-chips__row apgd-row">
        <span className="apg-eyebrow apg-chips__label apgd-label">Your apps</span>
        <div
          ref={listRef}
          className="apgd-list"
          role="group"
          aria-label="Apps on this page"
          data-overflowing={overflowing ? '' : undefined}
          data-compact={compact ? '' : undefined}
          data-apps-fit={fit}
        >
          {active.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed="true"
              onClick={() => remove(s)}
              title={`${cleanServerName(s.name)} is on this page. Click to remove it.`}
              aria-label={cleanServerName(s.name)}
              className="apg-chip apg-chip--on"
              data-apps-chip={s.slug}
              data-chip-kind="on"
            >
              <BrandIcon server={s} size={16} />
              <span className="apgd-chip__name">{cleanServerName(s.name)}</span>
              <span aria-hidden className="apg-chip__x">
                ×
              </span>
            </button>
          ))}
          {offered.map((s, i) => {
            const shown = i < fit && !overflowing && !compact
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed="false"
                onClick={() => toggle(s)}
                title={`Add ${cleanServerName(s.name)} to this page`}
                className={cn('apg-chip', !shown && 'apgd-chip--spare')}
                data-apps-chip={shown ? s.slug : undefined}
                data-apps-spare={shown ? undefined : s.slug}
                data-chip-kind="off"
                tabIndex={shown ? undefined : -1}
                aria-hidden={shown ? undefined : true}
              >
                <BrandIcon server={s} size={16} />
                <span>{cleanServerName(s.name)}</span>
                <span aria-hidden className="apg-chip__x">
                  +
                </span>
              </button>
            )
          })}
          <button
            type="button"
            aria-expanded={trayOpen}
            aria-controls="apgd-tray"
            onClick={() => setTrayOpen((v) => !v)}
            className={cn('apg-chip apg-chip--browse apgd-browse', trayOpen && 'apg-chip--open')}
            data-apps-browse=""
            data-chip-kind="browse"
            aria-label={trayOpen ? 'Close the list of apps' : 'Browse all apps'}
            title={trayOpen ? 'Close' : 'Browse all apps'}
          >
            <LayoutGrid width={15} height={15} aria-hidden className="apgd-browse__icon" />
            <span className="apgd-browse__label">{trayOpen ? 'Close' : 'Browse all'}</span>
          </button>
        </div>
        {right && <div className="apg-chips__right">{right}</div>}
      </div>
      {trayOpen && <Tray activeIds={activeIds} servers={servers} onToggle={toggle} onAddOwn={() => setAddOpen(true)} />}
      {/* Owned by the row, not the tray, so closing the tray never drops a
          half-filled form. Portaled by the modal itself. */}
      <AddMcpModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

function Tray({
  servers,
  activeIds,
  onToggle,
  onAddOwn,
}: {
  servers: McpServer[]
  activeIds: string[]
  onToggle: (s: McpServer) => void
  onAddOwn: () => void
}) {
  const [view, setView] = useState<TrayView>('free')
  const list = useMemo(() => trayApps(servers, activeIds, view), [servers, activeIds, view])
  return (
    <section id="apgd-tray" className="apgd-tray" aria-label="Add an app" data-apps-tray="">
      <div className="apgd-tray__head">
        <div className="apgd-tray__title">
          <h2 className="apgd-tray__h">Add an app</h2>
          <p className="apgd-tray__sub">Each one adds its own section to the page and joins the chat.</p>
        </div>
        <div className="apgd-switch" role="tablist" aria-label="Free or paid apps">
          <button type="button" role="tab" aria-selected={view === 'free'} onClick={() => setView('free')} className="apgd-switch__btn" data-tray-view="free">
            Free
          </button>
          <button type="button" role="tab" aria-selected={view === 'paid'} onClick={() => setView('paid')} className="apgd-switch__btn" data-tray-view="paid">
            Paid
          </button>
        </div>
      </div>
      <div className="apgd-tray__grid" data-tray-count={list.length}>
        {list.map((s) => {
          const name = cleanServerName(s.name)
          const price = trayPrice(s)
          return (
            <div key={s.id} className="apgd-app" data-tray-app={s.slug}>
              <span className="apgd-app__mark" aria-hidden>
                <BrandIcon server={s} size={20} />
              </span>
              <span className="apgd-app__text">
                <span className="apgd-app__name">
                  {name}
                  {price && <span className="apgd-app__price">{price}</span>}
                </span>
                <span className="apgd-app__line">{trayLine(s)}</span>
              </span>
              <Link href={`/servers/${s.slug}`} target="_blank" className="apgd-app__info" aria-label={`About ${name}`} title={`About ${name}: tools, pricing, reputation`}>
                <Info width={15} height={15} aria-hidden />
              </Link>
              <button type="button" className="apg-btn apgd-app__add" onClick={() => onToggle(s)} aria-label={`Add ${name} to the page`} data-tray-add={s.slug}>
                Add
              </button>
            </div>
          )
        })}
        {list.length === 0 && (
          <p className="apgd-tray__none">{view === 'free' ? 'Every free app is already on the page.' : 'No paid apps are loaded.'}</p>
        )}
        <div className="apgd-app apgd-app--own">
          <span className="apgd-app__mark" aria-hidden>
            <Plus width={18} height={18} />
          </span>
          <span className="apgd-app__text">
            <span className="apgd-app__name">Your own MCP</span>
            <span className="apgd-app__line">Paste a server address and pick its tools.</span>
          </span>
          <button type="button" className="apg-btn apgd-app__add" onClick={onAddOwn} data-sheet-open="addmcp" data-tray-own="">
            Add your own
          </button>
        </div>
      </div>
    </section>
  )
}
