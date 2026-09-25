'use client'

// The back gesture closes an overlay and stays on the page (squad
// mobile-native, 2026-09-24, SHELL). The Sheet uses this; an overlay that
// cannot be a Sheet (the unified sign-in door with its own keyboard-fit
// layout, ChatSignInGate's takeover) uses the same hook, so every overlay on
// a phone shares ONE history coordinator (lib/sheet-history) — including the
// handoff fix: one tap closing overlay A and opening overlay B in the same
// commit shares one history entry, and back closes B.
//
//   useBackToClose(open, onClose, key)
//
// While `open` (phone posture only), the overlay owns one history entry
// marked `{ sheet: key }`. The back gesture pops it and calls
// `onClose('back')`; the owner flips `open`. Any other close (the owner
// flips `open` for a scrim tap, Escape, a swipe…) releases the entry on the
// effect's cleanup — popped on the next tick unless the next overlay takes
// it over. `key` must be stable for the overlay's life (a useId, a literal).

import { useEffect, useRef } from 'react'
import { isPhoneViewport } from '@/lib/phone-shell'
import { sheetHistory } from '@/lib/sheet-history'

export function useBackToClose(open: boolean, onClose: (reason: 'back') => void, key: string): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open || !isPhoneViewport()) return
    let owned = false
    try {
      sheetHistory().opened({
        key,
        onBack: () => {
          owned = false
          onCloseRef.current('back')
        },
      })
      owned = true
    } catch {
      owned = false
    }
    return () => {
      if (!owned) return
      owned = false
      try {
        sheetHistory().closed(key, 'other')
      } catch {
        /* a sandboxed history: the entry stays, harmless */
      }
    }
  }, [open, key])
}
