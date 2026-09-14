'use client'

// Connect to act on a public page (2026-09-14, Nate: "I don't think the user
// should have to connect wallet to view the charts and market, but only on an
// action item 'buy $10 of APPLE'"). The markets pages are open to everyone
// (lib/app-entry isPublicAppPath); the wallet is asked for at the action.
// `act(ask)` follows lib/act-gate actStep:
//
//  · a connected wallet: the action runs now
//  · nobody here: the ask is held and the unified door opens on its
//    connect-only lanes (rule 6: every lane stops at the connect, no SIWE)
//  · a remembered wallet still coming back: the ask waits for it, and the
//    door opens only if nothing does
//
// The held ask runs the moment a wallet lands, whichever lane brought it. A
// door closed with nothing still connecting drops the ask (lib/wallet-reconnect
// connectAskReleased, the chat's connect gate's rule), so a later connect
// never fires something the visitor walked away from. The Google lane reloads
// the page: a `resumable` page takes its ask back from lib/act-gate's record.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import { CreateAccountModal } from '@/components/CreateAccountButton'
import { ACT_RESUME_EVENT, ACT_RESUME_KEY, actStep, takeActResume } from '@/lib/act-gate'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { useSession } from '@/lib/session'
import { CONNECT_ASK_RELEASE_GRACE_MS, connectAskReleased, hasStoredWalletConnection } from '@/lib/wallet-reconnect'

type Door = { ask: string; redirectTo: string }

export function useConnectToAct({
  run,
  redirectFor,
  resumable = false,
}: {
  /** Performs the action for a connected wallet. */
  run: (ask: string) => void
  /** Where the door's lanes that navigate (email, Google) land: the page
   *  that carries the action on. */
  redirectFor: (ask: string) => string
  /** This page runs a held ask itself, so the Google lane's ask comes back
   *  to it after the redirect. A page whose continuation is a URL (a /chat
   *  prefill) leaves this off: the redirect already carries the ask. */
  resumable?: boolean
}): { act: (ask: string) => void; door: ReactNode } {
  const { walletAddress, signedOut } = useSession()
  const { status: walletStatus } = useAccount()
  const { openConnectModal, connectModalOpen } = useConnectModal()
  const [held, setHeld] = useState<string | null>(null)
  const [door, setDoor] = useState<Door | null>(null)
  // The door was offered for the held ask. From then on, the door and the
  // wallet list going away with nothing connecting means no.
  const [offered, setOffered] = useState(false)

  // The caller's closures are fresh every render; the effects run the latest.
  const runRef = useRef(run)
  const redirectRef = useRef(redirectFor)
  useEffect(() => {
    runRef.current = run
    redirectRef.current = redirectFor
  })

  const offerDoor = useCallback(
    (ask: string) => {
      setOffered(true)
      // The unified door when the embedded wallet is on; without it, the
      // wallet list is the only connect-only lane (the chat's connect gate
      // does the same).
      if (cdpEnabled) setDoor({ ask, redirectTo: redirectRef.current(ask) })
      else openConnectModal?.()
    },
    [openConnectModal],
  )

  const act = useCallback(
    (ask: string) => {
      const step = actStep({ walletAddress, signedOut })
      if (step === 'run') {
        setHeld(null)
        runRef.current(ask)
        return
      }
      setHeld(ask)
      setOffered(false)
      if (step === 'door') offerDoor(ask)
    },
    [walletAddress, signedOut, offerDoor],
  )

  // A wallet lands: the held ask runs. Nobody came back: offer the door once.
  useEffect(() => {
    if (held === null) return
    if (walletAddress) {
      setHeld(null)
      setDoor(null)
      runRef.current(held)
      return
    }
    if (signedOut && !offered) offerDoor(held)
  }, [held, walletAddress, signedOut, offered, offerDoor])

  // The visitor said no: the door and the wallet list are gone and nothing is
  // connecting. The grace covers the beat between the door closing and the
  // list opening.
  useEffect(() => {
    if (held === null || !offered) return
    let stored = false
    try {
      stored = hasStoredWalletConnection(window.localStorage)
    } catch {
      // storage blocked: nothing stored to wait for
    }
    const released = connectAskReleased({
      pending: true,
      hasAddress: !!walletAddress,
      doorOpen: door !== null,
      listOpen: !!connectModalOpen,
      walletStatus,
      storedConnection: stored,
      handshakeInFlight: false,
    })
    if (!released) return
    const t = window.setTimeout(() => setHeld(null), CONNECT_ASK_RELEASE_GRACE_MS)
    return () => window.clearTimeout(t)
  }, [held, offered, walletAddress, door, connectModalOpen, walletStatus])

  // The Google lane's way back (lib/act-gate): the page it routed to takes the
  // ask. Checked once a wallet is here, and again on the event CdpOAuthReturn
  // fires for a page that is already up.
  useEffect(() => {
    if (!resumable || !walletAddress) return
    const take = () => {
      let raw: string | null = null
      try {
        raw = window.sessionStorage.getItem(ACT_RESUME_KEY)
      } catch {
        return
      }
      const { ask, clear } = takeActResume(raw, window.location.pathname, Date.now())
      if (clear) {
        try {
          window.sessionStorage.removeItem(ACT_RESUME_KEY)
        } catch {
          // storage blocked: the record goes stale on its own
        }
      }
      if (ask) runRef.current(ask)
    }
    take()
    window.addEventListener(ACT_RESUME_EVENT, take)
    return () => window.removeEventListener(ACT_RESUME_EVENT, take)
  }, [resumable, walletAddress])

  const doorNode =
    door && cdpEnabled ? (
      <CreateAccountModal
        walletConnectOnly
        redirectTo={door.redirectTo}
        resumeAsk={resumable ? door.ask : undefined}
        onClose={() => setDoor(null)}
      />
    ) : null

  return { act, door: doorNode }
}
