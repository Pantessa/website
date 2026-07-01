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
import { useAccount, useChainId, useDisconnect, useSignMessage } from 'wagmi'
import { createSiweMessage } from 'viem/siwe'
import { getAddress } from 'viem'
import { useYeetfulStore } from '@/lib/store'
import { cdpEnabled } from '@/lib/cdp-embedded'

type Status = 'loading' | 'authed' | 'guest'

interface SessionValue {
  /** Lowercased, SIWE-verified address from the session cookie, or null. */
  address: string | null
  status: Status
  /** True while a sign-in round-trip is in flight. */
  signingIn: boolean
  /** True if a wallet is connected but no SIWE session exists yet. */
  needsSignIn: boolean
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
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const { address: walletAddress, isConnected, status: walletStatus } = useAccount()
  const chainId = useChainId()
  const { signMessageAsync } = useSignMessage()
  const { disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()
  const router = useRouter()

  const [address, setAddress] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Explicit "the user asked to sign in" intent. The post-connect sign-in
  // effect only fires when this is set — so auto-reconnect on a plain refresh
  // can NEVER trigger a signature (the bug that got the old one-click reverted).
  const pendingSignInRef = useRef<{ redirectTo?: string } | null>(null)

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
        statement: 'Sign in to Yeetful. This proves you own this wallet — no funds are moved.',
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

  // Fires the post-connect signature for connectAndSignIn ONLY. Guards:
  //  • pendingSignInRef set        → never runs on passive auto-reconnect/refresh
  //  • status !== 'loading'        → wait for session hydration before deciding
  //                                   (the race that made the old version pop the
  //                                   signer on every reload)
  //  • already authed              → just honor the redirect, don't re-sign
  useEffect(() => {
    const intent = pendingSignInRef.current
    if (!intent) return
    if (status === 'loading') return
    if (!isConnected || !walletAddress) return
    pendingSignInRef.current = null
    if (status === 'authed') {
      if (intent.redirectTo) router.push(intent.redirectTo)
      return
    }
    if (!signingIn) void signIn(intent.redirectTo)
  }, [status, isConnected, walletAddress, signingIn, signIn, router])

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
      disconnect()
      setAddress(null)
      setStatus('guest')
    }
  }, [disconnect])

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
  const resetChats = useYeetfulStore((s) => s.resetChats)
  const loadShortlist = useYeetfulStore((s) => s.loadShortlist)
  useEffect(() => {
    setAuthedAddress(effectiveAddress)
    if (effectiveAddress) {
      void loadChats()
      void loadShortlist() // pull the wallet's saved shortlist from the DB
    } else {
      resetChats()
    }
  }, [effectiveAddress, setAuthedAddress, loadChats, resetChats, loadShortlist])

  const value: SessionValue = {
    address: sessionMatchesWallet ? address : null,
    status,
    signingIn,
    needsSignIn: needsSignIn || (!!address && !sessionMatchesWallet),
    error,
    signIn,
    connectAndSignIn,
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
