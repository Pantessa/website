'use client'

// The soft keyboard, read the only way a page can (squad mobile-native,
// 2026-09-24): it shrinks the VISUAL viewport while the layout viewport stays
// (iOS Safari), so the covered pixels are the difference. The composer rides
// on top of it and the tab bar steps aside while it's up, the way a native
// app's tab bar does.
//
// SHELL owns this hook (baseline from the contract commit): it may ADD fields,
// never rename or remove `open` / `inset`.

import { useEffect, useState } from 'react'
import { KEYBOARD_MIN_PX, keyboardInset } from '@/lib/phone-shell'

export function useSoftKeyboard(): { open: boolean; inset: number } {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const read = () => setInset(keyboardInset(window.innerHeight, vv.height, vv.offsetTop))
    read()
    vv.addEventListener('resize', read)
    vv.addEventListener('scroll', read)
    return () => {
      vv.removeEventListener('resize', read)
      vv.removeEventListener('scroll', read)
    }
  }, [])
  return { open: inset >= KEYBOARD_MIN_PX, inset }
}
