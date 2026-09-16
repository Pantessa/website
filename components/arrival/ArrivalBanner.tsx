'use client'
// The arrival moment — what the visitor sees on /chat when a chip they clicked
// on /markets is about to run (or just ran). CORE mounts it once, above the
// thread, with the intent it took; UX owns this file's body and its lifetime.
//
// Squad ARRIVAL (2026-09-16) — UX owns this file. Stub committed by the
// coordinator so CORE can mount it from day one.

import type { ArrivalIntent } from '@/lib/arrival-intent'

/** `holding` = waiting for the wallet / servers to settle; `sent` = the turn fired. */
export type ArrivalPhase = 'holding' | 'sent'

export type ArrivalBannerProps = {
  intent: ArrivalIntent
  phase: ArrivalPhase
  onDismiss?: () => void
}

export default function ArrivalBanner(_props: ArrivalBannerProps) {
  return null // UX builds this
}
