'use client'

// usePhoneSheet — ONE answer to "is this the phone posture?" for the markets
// surfaces (squad polish, 2026-10-13, MARKETS-MOBILE). THE RULEBOOK §B4:
// every secondary panel on a phone is a SHEET (components/mobile/Sheet) —
// the bell's popover, the order ticket, a ⋯ menu. The posture is the spine's
// own break (≤1023px = the bottom tab bar), read through matchMedia so a
// rotation or a resized window flips it live; the server snapshot is
// `false`, and every panel this gates opens only after a tap, so the first
// paint never differs between the server and the client.

import { useSyncExternalStore } from 'react'

export const PHONE_SHEET_QUERY = '(max-width: 1023px)'

const subscribe = (cb: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(PHONE_SHEET_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const read = () => (typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(PHONE_SHEET_QUERY).matches)
const serverRead = () => false

export function usePhoneSheet(): boolean {
  return useSyncExternalStore(subscribe, read, serverRead)
}
