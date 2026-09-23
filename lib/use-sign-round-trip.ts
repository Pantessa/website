'use client'

// The browser half of lib/sign-round-trip: a sign surface calls `ask()` right
// before it fires a wallet method and `settle()` when the promise settles;
// the hook watches the page leave for the wallet app and come back
// (visibilitychange + pageshow — a bfcache restore fires pageshow only), and
// ticks so `verdict` moves from `waiting` to `offer-reopen` on its own.
//
// Nothing here fires a wallet method. `reopen()` is the one control the hook
// offers for an open request the visitor came back to: bring the wallet app
// forward again (the request is already queued in it). For the MetaMask SDK
// lane that is a `metamask://` launch through lib/wallet-handoff, which runs
// inside the tap that pressed the button. Other mobile lanes get the words
// and no button until the handoff API can replay their last link (SIGN.md
// NEEDS → CONNECT).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { requestWalletAppOpen } from '@/lib/wallet-handoff'
import {
  IDLE_TRIP,
  platformOf,
  returnVerdict,
  roundTripReduce,
  type Platform,
  type SignRoundTrip,
} from '@/lib/sign-round-trip'

/** wagmi's id for the MetaMask SDK connector (the phone lane). */
export const METAMASK_SDK_CONNECTOR_ID = 'metaMaskSDK'

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
  const { connector } = useAccount()
  const [trip, setTrip] = useState<SignRoundTrip>(IDLE_TRIP)
  const [now, setNow] = useState(() => Date.now())
  const tripRef = useRef(trip)
  tripRef.current = trip

  const ask = useCallback(() => setTrip((t) => roundTripReduce(t, { type: 'ask', at: Date.now() })), [])
  const settle = useCallback(() => setTrip((t) => roundTripReduce(t, { type: 'resolved' })), [])
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
  const isSdkLane = connector?.id === METAMASK_SDK_CONNECTOR_ID
  const reopenApp = platform === 'phone' && isSdkLane ? 'MetaMask' : null

  // A bare scheme link brings the app forward with its queue intact; the
  // handoff holder's link belt accepts it. Runs inside the button's tap.
  const reopen = useCallback(() => {
    if (!reopenApp) return
    requestWalletAppOpen('metamask://')
  }, [reopenApp])

  return { trip, verdict, platform, reopenApp, ask, settle, reset, reopen }
}
