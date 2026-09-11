'use client'

// ─────────────────────────────────────────────────────────────────────────
//  Client-side SIWE session.
//
//  The wallet "connection" (RainbowKit/wagmi) only proves the browser has a
//  wallet selected. To trust the address server-side we run Sign-In With
//  Ethereum: fetch a nonce, have the wallet sign an EIP-4361 message, and POST
//  it to /api/auth/verify which mints an httpOnly session cookie. After that
//  the server reads the address from the cookie (lib/auth.ts) and never trusts
//  the client. This context exposes that session to the UI.
// ─────────────────────────────────────────────────────────────────────────

import { analytics } from '@/lib/analytics'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount, useChainId, useConfig, useSignMessage } from 'wagmi'
import { disconnect as wagmiDisconnect, getConnections } from 'wagmi/actions'
import { createSiweMessage } from 'viem/siwe'
import { getAddress } from 'viem'
import { useYeetfulStore } from '@/lib/store'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { isSignedOut, pendingSignInStep, walletRemembered } from '@/lib/app-entry'

type Status = 'loading' | 'authed' | 'guest'

interface SessionValue {
  /** Lowercased, SIWE-verified address from the session cookie, or null. */
  address: string | null
  status: Status
  /** True while a sign-in round-trip is in flight. */
  signingIn: boolean
  /** True if a wallet is connected but no SIWE session exists yet. */
  needsSignIn: boolean
  /** Live connected wallet address (lowercased), independent of the SIWE session. */
  walletAddress: string | null
  /**
   * True when a prior SIWE session exists but the connected wallet now reports a
   * DIFFERENT address — i.e. the user switched accounts in MetaMask. Drives the
   * global re-sign banner; `signIn()` re-mints the cookie for the new account
   * without disconnecting.
   */
  switchedAccount: boolean
  /**
   * Nobody is here: no wallet connected and no session (lib/app-entry
   * isSignedOut). False while the session is loading or a stored wallet
   * connection is being restored — never a mid-hydration guess. The app
   * shell sends this visitor home.
   */
  signedOut: boolean
  error: string | null
  /** Run SIWE on the already-connected wallet; optionally redirect on success. */
  signIn: (redirectTo?: string) => Promise<void>
  /**
   * One-shot connect → sign. If a wallet is already connected, signs straight
   * away (preserving the click gesture). Otherwise opens the wallet modal and,
   * once connected AND the session has hydrated, fires the signature exactly
   * once. Never auto-signs on passive auto-reconnect (guarded by an explicit
   * intent flag). Optionally redirects on success.
   */
  connectAndSignIn: (redirectTo?: string) => void
  /**
   * Sign in once a connect the caller just made has landed: the door's email
   * and Google lanes call it after the embedded wallet connects. It opens no
   * wallet modal (the connect already happened, and the embedded wallet signs
   * without a prompt). `signIn` can't be called there, since it holds the
   * disconnected state its caller rendered with; this hands the signature to
   * the post-connect effect, which reads the wallet state the connect
   * produced. Lands on `redirectTo` whether or not the signature goes through
   * (the account connected either way, and the app shell runs on the
   * connection), then resolves.
   */
  signInOnceConnected: (redirectTo?: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const { address: walletAddress, isConnected, status: walletStatus } = useAccount()
  const chainId = useChainId()
  const { signMessageAsync } = useSignMessage()
  const config = useConfig()
  const { openConnectModal } = useConnectModal()
  const router = useRouter()

  const [address, setAddress] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Explicit "the user asked to sign in" intent. The post-connect sign-in
  // effect only fires when this is set — so auto-reconnect on a plain refresh
  // can NEVER trigger a signature (the bug that got the old one-click reverted).
  // `settle` marks signInOnceConnected's: its caller is waiting on the attempt.
  const pendingSignInRef = useRef<{ redirectTo?: string; settle?: () => void } | null>(null)
  // signInOnceConnected bumps this so the effect runs on a fresh render: a ref
  // write renders nothing, and when the caller's connect left the wallet
  // state as it was (already connected), nothing else would.
  const [signInRequests, setSignInRequests] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' })
      const data = await res.json()
      const addr = typeof data.address === 'string' ? data.address.toLowerCase() : null
      setAddress(addr)
      setStatus(addr ? 'authed' : 'guest')
    } catch {
      setAddress(null)
      setStatus('guest')
    }
  }, [])

  // Hydrate the session on mount.
  useEffect(() => {
    refresh()
  }, [refresh])

  // If the connected wallet switches to a different address than the session,
  // drop the stale session so the UI prompts a fresh sign-in.
  useEffect(() => {
    if (address && walletAddress && walletAddress.toLowerCase() !== address) {
      setStatus('guest')
    }
  }, [address, walletAddress])

  const signIn = useCallback(async (redirectTo?: string) => {
    if (!isConnected || !walletAddress) {
      setError('Connect a wallet first.')
      return
    }
    setSigningIn(true)
    setError(null)
    try {
      const nonceRes = await fetch('/api/auth/nonce', { cache: 'no-store' })
      const { nonce } = await nonceRes.json()
      if (!nonce) throw new Error('Could not get a sign-in nonce.')

      const message = createSiweMessage({
        domain: window.location.host,
        address: getAddress(walletAddress),
        statement: 'Sign in to Pantessa. This proves you own this wallet — no funds are moved.',
        uri: window.location.origin,
        version: '1',
        chainId,
        nonce,
      })

      const signature = await signMessageAsync({ message })

      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      })
      if (verifyRes.ok && walletAddress) analytics.signedIn(walletAddress.toLowerCase())
      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({}))
        throw new Error(body.error || 'Sign-in verification failed.')
      }
      await refresh()
      if (redirectTo) router.push(redirectTo)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed.'
      setError(/rejected|denied|User rejected/i.test(msg) ? null : msg)
    } finally {
      setSigningIn(false)
    }
  }, [isConnected, walletAddress, chainId, signMessageAsync, refresh, router])

  // One-shot connect → sign (see the interface doc). Connected? sign now, in the
  // same gesture. Disconnected? record intent + open the modal; the effect below
  // signs once the wallet connects.
  const connectAndSignIn = useCallback(
    (redirectTo?: string) => {
      if (isConnected && walletAddress) {
        void signIn(redirectTo)
        return
      }
      pendingSignInRef.current = { redirectTo }
      openConnectModal?.()
    },
    [isConnected, walletAddress, signIn, openConnectModal],
  )

  // Sign in once a connect the caller made has landed (see the interface doc).
  // One pending sign-in at a time; a waiter this replaces isn't left hanging.
  const signInOnceConnected = useCallback(
    (redirectTo?: string) =>
      new Promise<void>((settle) => {
        const replaced = pendingSignInRef.current
        pendingSignInRef.current = { redirectTo, settle }
        replaced?.settle?.()
        setSignInRequests((n) => n + 1)
      }),
    [],
  )

  // Fires the pending signature: connectAndSignIn's once the modal's wallet
  // connects, signInOnceConnected's on the render it asks for. The decision
  // is lib/app-entry pendingSignInStep. Guards:
  //  • pendingSignInRef set        → never runs on passive auto-reconnect/refresh
  //  • status !== 'loading'        → wait for session hydration before deciding
  //                                   (the race that made the old version pop the
  //                                   signer on every reload)
  //  • a session for THIS wallet   → just honor the redirect, don't re-sign
  useEffect(() => {
    const intent = pendingSignInRef.current
    if (!intent) return
    const step = pendingSignInStep({
      sessionStatus: status,
      sessionAddress: address,
      walletAddress: isConnected ? (walletAddress ?? null) : null,
      signingIn,
      callerWaits: !!intent.settle,
    })
    if (step === 'wait') return
    pendingSignInRef.current = null
    const { redirectTo, settle } = intent
    if (settle) {
      // Land whether or not the signature went through, then let the caller go.
      void (step === 'sign' ? signIn() : Promise.resolve()).then(() => {
        if (redirectTo) router.push(redirectTo)
        settle()
      })
    } else if (step === 'land') {
      if (redirectTo) router.push(redirectTo)
    } else if (step === 'sign') {
      void signIn(redirectTo)
    }
  }, [status, address, isConnected, walletAddress, signingIn, signIn, router, signInRequests])

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      // A CDP embedded-wallet session lives in the CDP SDK, independent of
      // wagmi — disconnecting the connector alone leaves the user signed into
      // CDP, so the next "Create an account" silently resumes the old account
      // and the connector auto-reconnects on reload. Clear it too. Guarded on
      // cdpEnabled + isSignedIn so it's a no-op for MetaMask/other wallets.
      if (cdpEnabled) {
        try {
          const cdp = await import('@coinbase/cdp-core')
          if (await cdp.isSignedIn()) await cdp.signOut()
        } catch {
          // SDK not initialized / not a CDP account — nothing to clear.
        }
      }
      // Sign-out means GONE: drop the wallet connection too, so the UI
      // returns to the exact state a brand-new visitor sees.
      //
      // Do it deterministically. The old fire-and-forget disconnect() (followed
      // by an immediate router.push) could be interrupted before wagmi finished
      // clearing its active-connection state, leaving `state.current` set. The
      // next sign-in then tripped ConnectorAlreadyConnectedError deep in wagmi's
      // connect action — which RainbowKit's modal swallows silently — so
      // reconnecting MetaMask appeared to do nothing until a full page reload
      // rebuilt wagmi from scratch. Await a full teardown of EVERY connection so
      // the next connect always starts from a clean, truly-disconnected state.
      try {
        for (const connection of getConnections(config)) {
          await wagmiDisconnect(config, { connector: connection.connector })
        }
      } catch {
        // A connector (e.g. injected MetaMask) can reject on disconnect; the app
        // session is cleared regardless, and we tore down what we could.
      }
      setAddress(null)
      setStatus('guest')
    }
  }, [config])

  // A SIWE session without a wallet behind it is an orphan — every authed
  // surface re-gates on the wallet anyway, so the only thing it can do is
  // strand the UI in portal mode (Dashboard tab + / redirect) after a
  // disconnect. End it. wagmi reports 'connecting'/'reconnecting' during
  // page-load auto-reconnect, so this only fires once the wallet state has
  // settled on truly disconnected.
  useEffect(() => {
    if (status === 'authed' && walletStatus === 'disconnected') {
      void signOut()
    }
  }, [status, walletStatus, signOut])

  const needsSignIn = status === 'guest' && isConnected && !!walletAddress
  const sessionMatchesWallet =
    !address || !walletAddress || walletAddress.toLowerCase() === address

  // Keep the chat store in sync with the live session: load the wallet's chats
  // from the DB when signed in, clear them on sign-out / wallet mismatch.
  const effectiveAddress = sessionMatchesWallet ? address : null
  const setAuthedAddress = useYeetfulStore((s) => s.setAuthedAddress)
  const loadChats = useYeetfulStore((s) => s.loadChats)
  const adoptLocalChat = useYeetfulStore((s) => s.adoptLocalChat)
  const resetChats = useYeetfulStore((s) => s.resetChats)
  const loadShortlist = useYeetfulStore((s) => s.loadShortlist)
  useEffect(() => {
    setAuthedAddress(effectiveAddress)
    if (effectiveAddress) {
      // "Connect to act, sign in to keep": a guest thread built before this
      // sign-in (the /i run, a /chat guest ask) gets promoted into the DB
      // first, so the post-sign-in load lists it instead of ignoring it.
      // adoptLocalChat no-ops unless the current chat is local with a real
      // user message in it.
      void adoptLocalChat().finally(() => {
        void loadChats()
      })
      void loadShortlist() // pull the wallet's saved shortlist from the DB
    } else {
      resetChats()
    }
  }, [effectiveAddress, setAuthedAddress, adoptLocalChat, loadChats, resetChats, loadShortlist])

  // Did this browser connect a wallet before (and not disconnect it)? Read
  // once from wagmi's storage on mount — it decides whether isSignedOut
  // waits out wagmi's page-load connector probe (lib/app-entry).
  const [remembered, setRemembered] = useState(false)
  useEffect(() => {
    try {
      setRemembered(walletRemembered((key) => window.localStorage.getItem(key)))
    } catch {
      // storage blocked — nothing is remembered, so nothing is waited for
    }
  }, [])

  const value: SessionValue = {
    address: sessionMatchesWallet ? address : null,
    status,
    signingIn,
    needsSignIn: needsSignIn || (!!address && !sessionMatchesWallet),
    walletAddress: walletAddress ? walletAddress.toLowerCase() : null,
    switchedAccount: !!address && !sessionMatchesWallet,
    signedOut: isSignedOut({
      sessionStatus: status,
      sessionAddress: address,
      walletStatus,
      walletAddress: walletAddress ?? null,
      walletRemembered: remembered,
    }),
    error,
    signIn,
    connectAndSignIn,
    signInOnceConnected,
    signOut,
    refresh,
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>.')
  return ctx
}
