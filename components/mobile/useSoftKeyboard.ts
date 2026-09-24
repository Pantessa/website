'use client'

// The soft keyboard, read the only way a page can (squad mobile-native,
// 2026-09-24): it shrinks the VISUAL viewport while the layout viewport stays
// (iOS Safari, and Chrome on Android since 108 — `interactive-widget`
// defaults to resizes-visual on both), so the covered pixels are the
// difference. The composer rides on top of it and the tab bar steps aside
// while it's up, the way a native app's tab bar does.
//
// SHELL owns this hook (baseline from the contract commit): it may ADD fields,
// never rename or remove `open` / `inset`.
//
// iOS 26 leaves `visualViewport.offsetTop` stuck where the keyboard panned the
// page (mastodon#36144: a 20px gap after the keyboard closes). Every reading
// here is one decision (lib/phone-shell keyboardState), and when the keyboard
// goes away with the offset still set, the page is panned back to 0 — a
// document that never scrolls has nowhere else to be.

import { useEffect, useState } from 'react'
import { isPhoneViewport, keyboardState } from '@/lib/phone-shell'

export function useSoftKeyboard(): { open: boolean; inset: number } {
  const [state, setState] = useState<{ open: boolean; inset: number }>({ open: false, inset: 0 })
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let last = { open: false, inset: 0 }
    const read = () => {
      const next = keyboardState(window.innerHeight, vv.height, vv.offsetTop)
      if (next.open === last.open && next.inset === last.inset) return
      const closed = last.open && !next.open
      last = next
      setState(next)
      if (closed) settle()
    }
    // A stale pan after the keyboard closes: pan back. Twice, because Safari
    // reports the close before it finishes animating the viewport.
    let t1 = 0
    let t2 = 0
    const settle = () => {
      if (!isPhoneViewport()) return
      const back = () => {
        if ((window.visualViewport?.offsetTop ?? 0) > 0 || window.scrollY > 0) window.scrollTo(0, 0)
      }
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      t1 = window.setTimeout(back, 60)
      t2 = window.setTimeout(back, 320)
    }
    const onFocusOut = () => {
      // The field is gone; if nothing else takes focus the keyboard is
      // closing. Read again after the browser has moved the viewport — and
      // pan back ONLY if a keyboard was up (on a desktop every blur lands
      // here with no keyboard; scrolling that page to 0 would be a bug).
      const wasOpen = last.open
      window.setTimeout(() => {
        read()
        if (wasOpen && !last.open) settle()
      }, 80)
    }
    read()
    vv.addEventListener('resize', read)
    vv.addEventListener('scroll', read)
    document.addEventListener('focusout', onFocusOut, true)
    return () => {
      vv.removeEventListener('resize', read)
      vv.removeEventListener('scroll', read)
      document.removeEventListener('focusout', onFocusOut, true)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])
  return state
}
