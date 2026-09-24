'use client'

// THE phone overlay (squad mobile-native, 2026-09-24, Nate: "if a nav draw is
// open and a user taps outside it should close the draw, by default should be
// closed with easy way to access the info"). Every secondary panel on a phone
// — the chat list, the apps picker, the links list, MORE, a job's detail, the
// ask door, the account menu — is ONE of these, so every one of them closes
// the same ways: a tap outside it (the scrim), Escape, the close button, a
// swipe down (left for a side sheet) on its grabber or head, and the phone's
// back gesture. Nothing opens a sheet on its own: a sheet is always the
// answer to a labeled tap.
//
// Contract (lanes build against it; SHELL owns the internals and may ADD
// props, never rename or remove one): open · onClose · title · ariaLabel ·
// side · size · footer · children · className · id. SHELL round 1 added the
// dismiss REASON to onClose (`() => void` consumers stay valid).
//
// At lg and up a bottom sheet renders as a centered dialog, so a modal can
// adopt it on every breakpoint without a second component.
//
// The back gesture: on a phone, an open sheet owns ONE history entry marked
// `{ sheet: <key> }` (Next's patched pushState copies its own `__NA` + tree
// into that object, so a popstate onto the previous entry is a same-URL
// restore, never a reload — a state WITHOUT `__NA` would reload; read
// lib/app-tab-url.ts). Back pops it and closes the sheet on the same page.
// The entry's life — and the HANDOFF race, where one tap closes sheet A and
// opens sheet B in the same commit — is lib/sheet-history's job: a closing
// sheet's entry is popped on the next tick unless the next sheet takes it
// over, so a chain of handoffs is one entry and back closes what is open.

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SHEET_MOTION_MS, isPhoneViewport, shouldDismissDrag } from '@/lib/phone-shell'
import { sheetHistory } from '@/lib/sheet-history'
import './mobile.css'

/** Why a sheet closed. `back` is the phone's back gesture, `swipe` a drag
 *  past the threshold; the rest are what they say. */
export type SheetCloseReason = 'scrim' | 'escape' | 'button' | 'swipe' | 'back'

export type SheetProps = {
  open: boolean
  /** Called for every dismissal: scrim tap, Escape, the close button, a swipe,
   *  the back gesture — with the reason (ADDED in SHELL round 1; a plain
   *  `() => void` still type-checks). The owner flips `open`. */
  onClose: (reason?: SheetCloseReason) => void
  /** Visible header text, and the dialog's accessible name. */
  title?: React.ReactNode
  /** Accessible name when there is no visible title. */
  ariaLabel?: string
  /** 'bottom' (default) rises from the bottom edge. 'left' is a side drawer
   *  (the chat list from a conversation) and dismisses the same ways. */
  side?: 'bottom' | 'left'
  /** 'auto' (default) fits its content up to the top safe area. 'full' takes
   *  the whole screen below the safe area. */
  size?: 'auto' | 'full'
  /** Pinned under the scrolling body, above the home indicator. */
  footer?: React.ReactNode
  children: React.ReactNode
  /** Extra class on the panel. */
  className?: string
  /** Rendered as data-sheet="<id>", the hook drives and pins find it by. */
  id?: string
}

type Phase = 'closed' | 'open' | 'closing'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function Sheet({
  open,
  onClose,
  title,
  ariaLabel,
  side = 'bottom',
  size = 'auto',
  footer,
  children,
  className,
  id,
}: SheetProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const historyKey = `sheet:${id ?? titleId}`
  // Consumers pass inline lambdas: read the latest through a ref so the
  // open effect below runs once per opening, not once per render (a re-run
  // would yank focus back to the panel mid-typing).
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // ── The phase machine: mounted while open, kept for the exit motion, then
  // gone. Reduced motion skips the exit phase entirely.
  const [phase, setPhase] = useState<Phase>('closed')
  useEffect(() => {
    if (open) {
      setPhase('open')
      return
    }
    setPhase((p) => (p === 'open' ? (reducedMotion() ? 'closed' : 'closing') : p))
  }, [open])
  useEffect(() => {
    if (phase !== 'closing') return
    const t = window.setTimeout(() => setPhase('closed'), SHEET_MOTION_MS)
    return () => window.clearTimeout(t)
  }, [phase])

  // ── The history entry (phone only), owned through lib/sheet-history so a
  // handoff between two sheets shares one entry and back closes the top one.
  const ownedRef = useRef(false)
  const dismiss = (reason: SheetCloseReason) => {
    if (ownedRef.current) {
      ownedRef.current = false
      try {
        sheetHistory().closed(historyKey, reason === 'back' ? 'back' : 'other')
      } catch {
        /* a sandboxed history: the entry stays, harmless */
      }
    }
    closeRef.current(reason)
  }
  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss

  // ── Open-time wiring: focus in, Escape, the tab trap, the scroll lock, the
  // history entry; focus out and the entry's consumption on close.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first && first !== panel.querySelector('.sheet__close') ? first : panel).focus({ preventScroll: true })
    })
    const trapTab = (e: KeyboardEvent) => {
      const panel = panelRef.current
      if (!panel) return
      const nodes = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (!nodes.length) {
        e.preventDefault()
        panel.focus({ preventScroll: true })
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && panel.contains(active)
      if (e.shiftKey && (active === first || active === panel || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        dismissRef.current('escape')
        return
      }
      if (e.key === 'Tab') trapTab(e)
    }
    document.addEventListener('keydown', onKey)
    // A document that still scrolls (desktop, brochure pages) holds still
    // under the sheet; inside a phone frame it already does.
    const html = document.documentElement
    const prevOverflow = html.style.overflow
    html.style.overflow = 'hidden'
    // The back gesture (phone only): claim an entry; the coordinator calls
    // us back when the entry is popped.
    if (isPhoneViewport()) {
      try {
        sheetHistory().opened({
          key: historyKey,
          onBack: () => {
            ownedRef.current = false
            dismissRef.current('back')
          },
        })
        ownedRef.current = true
      } catch {
        ownedRef.current = false
      }
    }
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      html.style.overflow = prevOverflow
      // Closed by the owner (open → false) without one of our dismissals, or
      // unmounted while open: release the entry (popped on the next tick
      // unless another sheet takes it over; never if the page moved on).
      if (ownedRef.current) {
        ownedRef.current = false
        try {
          sheetHistory().closed(historyKey, 'other')
        } catch {
          /* leave the entry */
        }
      }
      opener?.focus?.({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Swipe to dismiss: a pointer drag on the grabber or the head. The panel
  // follows the finger; on release lib/phone-shell decides (distance or
  // flick), and the exit motion starts from where the finger left it.
  const drag = useRef<{ id: number; start: number; last: number; lastT: number; v: number } | null>(null)
  const axis = (e: ReactPointerEvent) => (side === 'bottom' ? e.clientY : e.clientX)
  const toward = (from: number, to: number) => (side === 'bottom' ? to - from : from - to) // positive = toward dismiss
  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (!isPhoneViewport()) return
    const p = axis(e)
    drag.current = { id: e.pointerId, start: p, last: p, lastT: performance.now(), v: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
    const panel = panelRef.current
    if (panel) panel.style.transition = 'none'
  }
  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const p = axis(e)
    const now = performance.now()
    const inst = toward(d.last, p) / Math.max(1, now - d.lastT)
    d.v = d.v * 0.6 + inst * 0.4
    d.last = p
    d.lastT = now
    const shown = Math.max(0, toward(d.start, p))
    const panel = panelRef.current
    if (panel) panel.style.transform = side === 'bottom' ? `translateY(${shown}px)` : `translateX(${-shown}px)`
    rootRef.current?.style.setProperty('--sheet-drag', String(shown))
  }
  const onDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const panel = panelRef.current
    if (!panel) return
    const delta = toward(d.start, axis(e))
    const size = side === 'bottom' ? panel.offsetHeight : panel.offsetWidth
    if (e.type !== 'pointercancel' && shouldDismissDrag(delta, d.v, size)) {
      rootRef.current?.style.setProperty('--sheet-from', `${Math.max(0, delta)}px`)
      panel.style.transform = ''
      panel.style.transition = ''
      dismiss('swipe')
      return
    }
    panel.style.transition = `transform 180ms cubic-bezier(.32,.72,0,1)`
    panel.style.transform = ''
    rootRef.current?.style.setProperty('--sheet-drag', '0')
    window.setTimeout(() => {
      if (panelRef.current) panelRef.current.style.transition = ''
    }, 200)
  }
  const dragHandlers = {
    onPointerDown: onDragStart,
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragEnd,
  }

  if (!mounted || phase === 'closed') return null

  return createPortal(
    <div ref={rootRef} className="sheet" data-sheet={id} data-side={side} data-size={size} data-phase={phase}>
      <div className="sheet__scrim" aria-hidden onClick={() => dismiss('scrim')} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        className={cn('sheet__panel', className)}
      >
        {side === 'bottom' && <div className="sheet__grabber" aria-hidden {...dragHandlers} />}
        {title ? (
          <div className="sheet__head" {...dragHandlers}>
            <h2 id={titleId} className="sheet__title">
              {title}
            </h2>
            <button type="button" onClick={() => dismiss('button')} aria-label="Close" className="sheet__close">
              <X width={18} height={18} />
            </button>
          </div>
        ) : null}
        <div className="sheet__body">{children}</div>
        {footer ? <div className="sheet__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
