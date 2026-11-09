'use client'

// Hold an action for a visitor the server could not name (squad community,
// lane FEED, 2026-11-09). A vote and a post need a PROVEN identity; a stranger
// who taps one gets the unified sign-in door (rule 6: CreateAccountButton's
// modal, NO redirectTo, so they stay on the page they are reading) and the
// action is HELD and runs the moment a session lands, whichever lane brought
// it. This is lib/use-connect-to-act's shape with one difference: that hook
// waits for a connected wallet (connect to act), this one waits for the
// session (an identity), so its door is the full sign-in, not connect-only.
//
// Walking away drops the action: the door and the wallet list gone, nothing
// signing, no session (lib/wallet-reconnect connectAskReleased, the same rule
// the chat's connect gate uses), so a later sign-in never fires something the
// visitor left behind.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import { CreateAccountModal } from '@/components/CreateAccountButton'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { signInLandingHere, useSession } from '@/lib/session'
import { CONNECT_ASK_RELEASE_GRACE_MS, connectAskReleased, hasStoredWalletConnection } from '@/lib/wallet-reconnect'

export interface IdentityDoor {
  /** Open the door and keep `run` for when a session lands. */
  hold: (run: () => void) => void
  /** True while an action is waiting on the door. */
  waiting: boolean
  /** Render this once in the caller. */
  door: ReactNode
}

export function useIdentityDoor(opts: { onDropped?: () => void } = {}): IdentityDoor {
  const { address, connectAndSignIn } = useSession()
  const heldRef = useRef<(() => void) | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [doorOpen, setDoorOpen] = useState(false)
  const droppedRef = useRef(opts.onDropped)
  useEffect(() => {
    droppedRef.current = opts.onDropped
  })

  const hold = useCallback(
    (run: () => void) => {
      heldRef.current = run
      setWaiting(true)
      // The unified door when the embedded wallet is on; without it the
      // session's own connect-and-sign is the fallback (rule 6). Either way
      // the sign-in lands on the page the visitor is on.
      if (cdpEnabled) setDoorOpen(true)
      else connectAndSignIn(signInLandingHere())
    },
    [connectAndSignIn],
  )

  // A session landed: the held action runs, once.
  useEffect(() => {
    if (!waiting || !address) return
    const run = heldRef.current
    heldRef.current = null
    setWaiting(false)
    setDoorOpen(false)
    run?.()
  }, [waiting, address])

  const drop = useCallback(() => {
    heldRef.current = null
    setWaiting(false)
    droppedRef.current?.()
  }, [])

  return {
    hold,
    waiting,
    door: (
      <>
        {doorOpen && cdpEnabled && <CreateAccountModal onClose={() => setDoorOpen(false)} />}
        {waiting && <HeldWatch doorOpen={doorOpen} onReleased={drop} />}
      </>
    ),
  }
}

/** Mounted only while an action is held: decides when the visitor has walked away. */
function HeldWatch({ doorOpen, onReleased }: { doorOpen: boolean; onReleased: () => void }) {
  const { address, walletAddress, signingIn } = useSession()
  const { status: walletStatus } = useAccount()
  const { connectModalOpen } = useConnectModal()
  // A wallet that just connected is about to be asked for its signature: the
  // beat before `signingIn` flips is not a walk-away.
  const [justConnected, setJustConnected] = useState(false)
  useEffect(() => {
    if (!walletAddress) return
    setJustConnected(true)
    const t = window.setTimeout(() => setJustConnected(false), 2500)
    return () => window.clearTimeout(t)
  }, [walletAddress])

  useEffect(() => {
    let stored = false
    try {
      stored = hasStoredWalletConnection(window.localStorage)
    } catch {
      // storage blocked: nothing stored to wait for
    }
    const released = connectAskReleased({
      pending: true,
      hasAddress: !!address,
      doorOpen,
      listOpen: !!connectModalOpen,
      walletStatus,
      storedConnection: stored,
      handshakeInFlight: signingIn || justConnected,
    })
    if (!released) return
    const t = window.setTimeout(onReleased, CONNECT_ASK_RELEASE_GRACE_MS)
    return () => window.clearTimeout(t)
  }, [address, doorOpen, connectModalOpen, walletStatus, signingIn, justConnected, onReleased])
  return null
}
