'use client'

// The guide's record as a React subscription. One store (lib/guide holds the
// cache and the listeners); every seat and every spine dot reads the same
// reference and re-renders on a write. The server snapshot is the frozen
// fresh record, so a server render — and React's hydration render — never
// disagree with the HTML (a seat still gates on useHydrated before it shows
// anything: a crawler never sees a tip).

import { useSyncExternalStore } from 'react'
import { GUIDE_FRESH, getGuideState, subscribeGuide, type GuideState } from '@/lib/guide'

const server = () => GUIDE_FRESH

export function useGuideState(): GuideState {
  return useSyncExternalStore(subscribeGuide, getGuideState, server)
}
