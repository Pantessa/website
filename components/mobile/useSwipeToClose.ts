'use client'

// Swipe to dismiss (squad mobile-native, 2026-09-24, SHELL): the Sheet's
// drag, as a hook any overlay can wear — touch AND mouse (pointer events),
// the panel following the finger, lib/phone-shell shouldDismissDrag deciding
// on release (a quarter of the panel, min 80px, or a flick), and the exit
// motion starting from wherever the finger left the panel (`--sheet-from` on
// the panel, read by mobile.css's exit keyframes).
//
//   const { handleProps } = useSwipeToClose(panelRef, onClose, side)
//
// `panelRef` is the element that moves; spread `handleProps` on the drag
// SURFACE (a grabber, a head — never a scrolling body, which pans). A bottom
// overlay is dragged down, a left one left. Phone posture only: at lg+ the
// handlers are inert.

import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { isPhoneViewport, shouldDismissDrag } from '@/lib/phone-shell'

/** Controls a drag must never steal a press from. */
export const INTERACTIVE = 'button, a, input, textarea, select, label, summary, [role="button"], [role="switch"], [role="link"], [role="menuitem"], [contenteditable="true"]'

export type SwipeHandleProps = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
}

export function useSwipeToClose(panelRef: RefObject<HTMLElement | null>, onClose: (reason: 'swipe') => void, side: 'bottom' | 'left' = 'bottom'): { handleProps: SwipeHandleProps } {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const drag = useRef<{ id: number; start: number; last: number; lastT: number; v: number } | null>(null)
  const axis = (e: ReactPointerEvent) => (side === 'bottom' ? e.clientY : e.clientX)
  const toward = (from: number, to: number) => (side === 'bottom' ? to - from : from - to) // positive = toward dismiss

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (!isPhoneViewport() || !panelRef.current) return
    // A press that starts on a control INSIDE the handle (the head's close X,
    // a link in a title) is that control's, never a drag: capturing the
    // pointer here retargeted the pointerup to the head and the X's click
    // never fired — every titled Sheet's X was dead (CHAT measured it).
    if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return
    const p = axis(e)
    drag.current = { id: e.pointerId, start: p, last: p, lastT: performance.now(), v: 0 }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* a synthetic pointer without capture support still drags */
    }
    panelRef.current.style.transition = 'none'
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    const panel = panelRef.current
    if (!d || d.id !== e.pointerId || !panel) return
    const p = axis(e)
    const now = performance.now()
    const inst = toward(d.last, p) / Math.max(1, now - d.lastT)
    d.v = d.v * 0.6 + inst * 0.4
    d.last = p
    d.lastT = now
    const shown = Math.max(0, toward(d.start, p))
    panel.style.transform = side === 'bottom' ? `translateY(${shown}px)` : `translateX(${-shown}px)`
  }
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const panel = panelRef.current
    if (!panel) return
    const delta = toward(d.start, axis(e))
    const size = side === 'bottom' ? panel.offsetHeight : panel.offsetWidth
    if (e.type !== 'pointercancel' && shouldDismissDrag(delta, d.v, size)) {
      panel.style.setProperty('--sheet-from', `${Math.max(0, delta)}px`)
      panel.style.transform = ''
      panel.style.transition = ''
      onCloseRef.current('swipe')
      return
    }
    panel.style.transition = 'transform 180ms cubic-bezier(.32,.72,0,1)'
    panel.style.transform = ''
    window.setTimeout(() => {
      if (panelRef.current) panelRef.current.style.transition = ''
    }, 200)
  }
  return { handleProps: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end } }
}
