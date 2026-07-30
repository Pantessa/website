'use client'

// Shared client state for the links-first "Get started" journey (mint →
// share → funnel → conversion → claim). The dashboard checklist and the
// app rail's compact journey block read the SAME status endpoint and the
// SAME dismiss key — dismissing the journey on either surface dismisses it
// everywhere, and a step done is done everywhere.

import { useCallback, useEffect, useState } from 'react'

// v3: the chat/embed-era checklist (ask/sign/job/embed) was retired with the
// links-first repositioning — a fresh key so everyone sees the new flow
// once, even if they dismissed an older one.
export const ONBOARDING_DISMISS_KEY = 'yf_onboarding_dismissed_v3'

export interface OnboardingStatus {
  minted: boolean
  opened: boolean
  connected: boolean
  converted: boolean
  claimed: boolean
}

export const EMPTY_ONBOARDING: OnboardingStatus = {
  minted: false,
  opened: false,
  connected: false,
  converted: false,
  claimed: false,
}

export function onboardingDismissed(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissOnboarding(): void {
  try {
    localStorage.setItem(ONBOARDING_DISMISS_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** Live done-state from /api/dashboard/onboarding — null while loading (hold
 *  the paint: five unchecked steps ticking a beat later reads as flicker).
 *  A signed-out 401 resolves to EMPTY so guest surfaces can still decide. */
export function useOnboardingStatus() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null)

  const refresh = useCallback(() => {
    fetch('/api/dashboard/onboarding', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d ?? EMPTY_ONBOARDING))
      .catch(() => setStatus(EMPTY_ONBOARDING))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { status, refresh }
}
