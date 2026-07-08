'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Activity, Gauge, Route } from 'lucide-react'
import Caret from '@/components/Caret'

/**
 * The "Research" mega-menu — a single top-level tab that reveals the three
 * "engine, examined" surfaces (Benchmarks · Tools · Activity) in a full-bleed
 * sheet that drops down from under the nav bar.
 *
 * Interaction: opens on hover (with intent delay so a diagonal cursor path to
 * the panel doesn't dismiss it) and on click/keyboard; closes on Escape,
 * outside click, route change, and mouse-leave. The panel + scrim are portaled
 * to <body> so the nav's backdrop-filter (which turns the sticky header into a
 * containing block for fixed descendants) can't trap or mis-size them.
 */

export const RESEARCH_ITEMS = [
  {
    href: '/benchmarks',
    label: 'Benchmarks',
    icon: Gauge,
    blurb: 'Routability grades for every MCP — A to F, scored live.',
  },
  {
    href: '/tools',
    label: 'Tools',
    icon: Route,
    blurb: 'Watch the router decide — every pick, endpoint, and resolve.',
  },
  {
    href: '/activity',
    label: 'Activity',
    icon: Activity,
    blurb: 'The live network — agents paying per call, in real time.',
  },
] as const

const RESEARCH_PATHS = RESEARCH_ITEMS.map((i) => i.href)

export default function NavResearch() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const isOn = RESEARCH_PATHS.some((p) => pathname.startsWith(p))

  useEffect(() => setMounted(true), [])

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }
  const scheduleOpen = () => {
    clearTimers()
    openTimer.current = setTimeout(() => setOpen(true), 55)
  }
  const scheduleClose = () => {
    clearTimers()
    closeTimer.current = setTimeout(() => setOpen(false), 170)
  }
  const closeNow = useCallback(() => {
    clearTimers()
    setOpen(false)
  }, [])

  // Close on route change.
  useEffect(() => {
    closeNow()
  }, [pathname, closeNow])

  // Escape + outside-click (the panel is portaled, so check both subtrees).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeNow()
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return
      closeNow()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, closeNow])

  useEffect(() => () => clearTimers(), [])

  return (
    <div
      className="navm"
      ref={wrapRef}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={`nav__tab navm__trigger ${isOn ? 'is-on' : ''} ${open ? 'is-active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (open ? closeNow() : (clearTimers(), setOpen(true)))}
      >
        Research
        <Caret className="navm__chev" />
      </button>

      {mounted &&
        createPortal(
          <>
            <div
              className={`navm__scrim ${open ? 'is-open' : ''}`}
              onMouseEnter={scheduleClose}
              onClick={closeNow}
              aria-hidden
            />
            <div
              ref={panelRef}
              className={`navm__panel ${open ? 'is-open' : ''}`}
              role="menu"
              aria-label="Research"
              onMouseEnter={clearTimers}
              onMouseLeave={scheduleClose}
            >
              <div className="navm__inner">
                <span className="navm__eyebrow mono">The engine, examined</span>
                <div className="navm__grid">
                  {RESEARCH_ITEMS.map(({ href, label, icon: Icon, blurb }, i) => (
                    <Link
                      key={href}
                      href={href}
                      role="menuitem"
                      className={`navm__card ${pathname.startsWith(href) ? 'is-on' : ''}`}
                      style={{ ['--i' as string]: i }}
                      onClick={closeNow}
                    >
                      <span className="navm__icon">
                        <Icon width={18} height={18} strokeWidth={2} />
                      </span>
                      <span className="navm__ctext">
                        <span className="navm__label">{label}</span>
                        <span className="navm__blurb">{blurb}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
