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
// Squad polish R1 (FLOW-MOBILE, 2026-10-13) ADDED, all optional: `size:
// 'half'` (a detent — half the viewport, the body scrolls), `actions` (a
// control beside the close button), `description` (one muted line under the
// title, the dialog's aria-describedby), `journey` (data-journey on the
// panel, rule C), `dismissible` (false = the owner closes it: a signing step
// mid-flight; no scrim tap, Escape, swipe, back or ✕) and `SHEET_ROW`, the
// one class for a 52px menu row (icon · words · chevron) so every lane's
// sheet lists look like the spine's MORE sheet.
//
// At lg and up a bottom sheet renders as a centered dialog, so a modal can
// adopt it on every breakpoint without a second component.
//
// The back gesture and the swipe are HOOKS (components/mobile/useBackToClose,
// useSwipeToClose), so an overlay that cannot be a Sheet (the sign-in door,
// ChatSignInGate) wears the same two behaviors from the same implementation.
// On a phone an open sheet owns ONE history entry marked `{ sheet: <key> }`
// (Next's patched pushState copies its own `__NA` + tree into that object,
// so a popstate onto the previous entry is a same-URL restore, never a
// reload — a state WITHOUT `__NA` would reload; read lib/app-tab-url.ts).
// The entry's life — and the HANDOFF race, where one tap closes sheet A and
// opens sheet B in the same commit — is lib/sheet-history's job: a closing
// sheet's entry is popped on the next tick unless the next sheet takes it
// over, so a chain of handoffs is one entry and back closes what is open.

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SHEET_MOTION_MS } from '@/lib/phone-shell'
import { useBackToClose } from './useBackToClose'
import { useSwipeToClose } from './useSwipeToClose'
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
   *  the whole screen below the safe area. 'half' is a detent: half the
   *  viewport, the body scrolls (the order ticket, a long picker). */
  size?: 'auto' | 'full' | 'half'
  /** A control rendered in the head beside the close button (a "Done", a
   *  "Clear", a segmented switch). Needs a `title`. */
  actions?: React.ReactNode
  /** One muted line under the title; the dialog's accessible description. */
  description?: React.ReactNode
  /** `data-journey` on the panel (rule C: every control names its verb). */
  journey?: string
  /** Default true. False: nothing dismisses it but the owner flipping
   *  `open` — no scrim tap, Escape, swipe, back gesture; the ✕ is hidden. */
  dismissible?: boolean
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

/** ONE menu row for a sheet's list (icon · words · chevron, 52px, the
 *  spine's MORE rows): `<button className={SHEET_ROW}>`. Children: an icon,
 *  then a `<span className="min-w-0">` holding `.sheet__rowtitle` +
 *  `.sheet__rowsub`. Every lane's sheet lists wear it (rule B4). */
export const SHEET_ROW =
  'sheet__row flex w-full items-center gap-3 rounded-xl px-3 py-2 min-h-[52px] text-left text-[color:var(--muted)] hover:bg-[var(--surf-2)] hover:text-[color:var(--fg)] active:bg-[var(--surf-1)] transition-colors select-none'

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
  actions,
  description,
  journey,
  dismissible = true,
}: SheetProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = `${titleId}-desc`
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

  // A non-dismissible sheet ignores every gesture; only the owner closes it.
  const dismiss = (reason: SheetCloseReason) => {
    if (!dismissible) return
    closeRef.current(reason)
  }
  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss

  // ── The back gesture (phone only): one history entry through lib/sheet-
  // history, so a handoff between two sheets shares one entry and back
  // closes the top one. Released on the effect's cleanup when `open` flips.
  // A non-dismissible sheet owns no entry (back would pop an entry and
  // leave the sheet up).
  useBackToClose(open && dismissible, dismiss, historyKey)
  // ── Swipe to dismiss on the grabber and the head; the panel follows.
  const { handleProps: swipeHandlers } = useSwipeToClose(panelRef, dismiss, side)
  const dragHandlers = dismissible ? swipeHandlers : {}

  // ── Open-time wiring: focus in, Escape, the tab trap, the scroll lock;
  // focus out on close.
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
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      html.style.overflow = prevOverflow
      opener?.focus?.({ preventScroll: true })
    }
  }, [open])

  if (!mounted || phase === 'closed') return null

  return createPortal(
    <div className="sheet" data-sheet={id} data-side={side} data-size={size} data-phase={phase} data-dismissible={dismissible ? undefined : 'false'}>
      <div className="sheet__scrim" aria-hidden onClick={() => dismiss('scrim')} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        data-journey={journey}
        className={cn('sheet__panel', className)}
      >
        {side === 'bottom' && <div className="sheet__grabber" aria-hidden {...dragHandlers} />}
        {title ? (
          <div className="sheet__head" {...dragHandlers}>
            <div className="sheet__titles">
              <h2 id={titleId} className="sheet__title">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="sheet__desc">
                  {description}
                </p>
              ) : null}
            </div>
            {actions ? <div className="sheet__actions">{actions}</div> : null}
            {dismissible ? (
              <button type="button" onClick={() => dismiss('button')} aria-label="Close" data-journey="Close sheet" className="sheet__close">
                <X width={18} height={18} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="sheet__body">{children}</div>
        {footer ? <div className="sheet__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
