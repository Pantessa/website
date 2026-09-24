'use client'

// THE phone overlay (squad mobile-native, 2026-09-24, Nate: "if a nav draw is
// open and a user taps outside it should close the draw, by default should be
// closed with easy way to access the info"). Every secondary panel on a phone
// — the chat list, the apps picker, the links list, MORE, a job's detail, the
// ask door, the account menu — is ONE of these, so every one of them closes
// the same ways: a tap outside it (the scrim), Escape, the close button, and
// (SHELL, round 1) a swipe down and the back gesture. Nothing opens a sheet on
// its own: a sheet is always the answer to a labeled tap.
//
// Contract (lanes build against it; SHELL owns the internals and may ADD
// props, never rename or remove one): open · onClose · title · ariaLabel ·
// side · size · footer · children · className · id.
//
// At lg and up a bottom sheet renders as a centered dialog, so a modal can
// adopt it on every breakpoint without a second component.

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import './mobile.css'

export type SheetProps = {
  open: boolean
  /** Called for every dismissal: scrim tap, Escape, the close button (and,
   *  from SHELL round 1, swipe and back). The owner flips `open`. */
  onClose: () => void
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
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // Consumers pass inline lambdas: read the latest through a ref so the
  // open effect below runs once per opening, not once per render (a re-run
  // would yank focus back to the panel mid-typing).
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.({ preventScroll: true })
    }
  }, [open])

  if (!mounted || !open) return null

  return createPortal(
    <div className="sheet" data-sheet={id} data-side={side} data-size={size}>
      <div className="sheet__scrim" aria-hidden onClick={() => closeRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        className={cn('sheet__panel', className)}
      >
        {side === 'bottom' && <div className="sheet__grabber" aria-hidden />}
        {title ? (
          <div className="sheet__head">
            <h2 id={titleId} className="sheet__title">
              {title}
            </h2>
            <button type="button" onClick={() => closeRef.current()} aria-label="Close" className="sheet__close">
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
