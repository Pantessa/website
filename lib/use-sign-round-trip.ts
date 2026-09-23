'use client'

// The browser half of lib/sign-round-trip: a sign surface calls `ask()` right
// before it fires a wallet method and `settle()` when the promise settles;
// the hook watches the page leave for the wallet app and come back
// (visibilitychange + pageshow — a bfcache restore fires pageshow only), and
// ticks so `verdict` moves from `waiting` to `offer-reopen` on its own.
//
// Nothing here fires a wallet method. `reopen()` is the one control the hook
// offers for an open request the visitor came back to: bring the wallet app
// forward again — CONNECT's `openWalletApp()` replays the last link the SDK
// asked for (the request is already queued in the app). `settle()` also tells
// the holder the request is over (`walletAppRequestSettled`) so the global
// card and the remembered link clear with it.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { openWalletApp, subscribeWalletAppOpen, walletAppLastLink, walletAppRequestSettled } from '@/lib/wallet-handoff'
import {
  IDLE_TRIP,
  platformOf,
  returnVerdict,
  roundTripReduce,
  type Platform,
  type SignRoundTrip,
} from '@/lib/sign-round-trip'

const noLink = () => null

/** The link the SDK last asked to open, while its request may still be
 *  waiting in the wallet app (lib/wallet-handoff). Null on a desktop, on a
 *  non-SDK lane, and once the request settled. */
export function useWalletAppLastLink(): { link: string; app: string } | null {
  return useSyncExternalStore(subscribeWalletAppOpen, walletAppLastLink, noLink)
}

/** The platform, read AFTER mount so a server render never disagrees with
 *  the client (the UA is a browser fact). Desktop until then. */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>('desktop')
  useEffect(() => {
    setPlatform(platformOf(typeof navigator === 'undefined' ? null : navigator.userAgent))
  }, [])
  return platform
}

export function useSignRoundTrip(): {
  trip: SignRoundTrip
  verdict: 'none' | 'waiting' | 'offer-reopen'
  platform: Platform
  /** The wallet app the reopen control names, or null when there is none to open. */
  reopenApp: string | null
  ask: () => void
  settle: () => void
  reset: () => void
  reopen: () => void
} {
  const platform = usePlatform()
  const last = useWalletAppLastLink()
  const [trip, setTrip] = useState<SignRoundTrip>(IDLE_TRIP)
  const [now, setNow] = useState(() => Date.now())

  const ask = useCallback(() => setTrip((t) => roundTripReduce(t, { type: 'ask', at: Date.now() })), [])
  const settle = useCallback(() => {
    setTrip((t) => roundTripReduce(t, { type: 'resolved' }))
    // The wallet answered (or refused): nothing is waiting in the app.
    walletAppRequestSettled()
  }, [])
  const reset = useCallback(() => setTrip(IDLE_TRIP), [])

  // Leave / return.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      const at = Date.now()
      setTrip((t) => roundTripReduce(t, { type: document.visibilityState === 'hidden' ? 'hidden' : 'visible', at }))
    }
    const onPageShow = () => setTrip((t) => roundTripReduce(t, { type: 'visible', at: Date.now() }))
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  // Tick only while a request is open — the verdict is a function of time.
  const live = trip.state === 'asked' || trip.state === 'in-app' || trip.state === 'returned'
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])

  const verdict = returnVerdict(trip, now)
  const reopenApp = last?.app ?? null

  // Runs inside the button's tap: the activation the browser held out for.
  const reopen = useCallback(() => {
    openWalletApp()
  }, [])

  return { trip, verdict, platform, reopenApp, ask, settle, reset, reopen }
}
