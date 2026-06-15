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
import { useAccount, useChainId, useDisconnect, useSignMessage } from 'wagmi'
import { createSiweMessage } from 'viem/siwe'
import { getAddress } from 'viem'
import { useYeetfulStore } from '@/lib/store'

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
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const { address: walletAddress, isConnected, status: walletStatus } = useAccount()
  const chainId = useChainId()
  const { signMessageAsync } = useSignMessage()
  const { disconnect } = useDisconnect()

  const [address, setAddress] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const signIn = useCallback(async () => {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed.'
      setError(/rejected|denied|User rejected/i.test(msg) ? null : msg)
    } finally {
      setSigningIn(false)
    }
  }, [isConnected, walletAddress, chainId, signMessageAsync, refresh])

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
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

  // One action, not two: a user-initiated connect flows straight into the
  // SIWE signature instead of parking on a second "Sign in" click. The
  // transition guard matters — 'connecting' → 'connected' is a clicked
  // connect; page-load auto-reconnect reports 'reconnecting' and never
  // springs an unprompted signature popup. Declining the signature simply
  // leaves the Sign in button (signIn swallows rejections); no retry loop,
  // since the transition only happens once per connect.
  const prevWalletStatus = useRef(walletStatus)
  useEffect(() => {
    const was = prevWalletStatus.current
    prevWalletStatus.current = walletStatus
    const sessionCoversWallet =
      status === 'authed' && !!address && !!walletAddress && walletAddress.toLowerCase() === address
    if (was === 'connecting' && walletStatus === 'connected' && !signingIn && !sessionCoversWallet) {
      void signIn()
    }
  }, [walletStatus, status, address, walletAddress, signingIn, signIn])

  const needsSignIn = status === 'guest' && isConnected && !!walletAddress
  const sessionMatchesWallet =
    !address || !walletAddress || walletAddress.toLowerCase() === address

  // Keep the chat store in sync with the live session: load the wallet's chats
  // from the DB when signed in, clear them on sign-out / wallet mismatch.
  const effectiveAddress = sessionMatchesWallet ? address : null
  const setAuthedAddress = useYeetfulStore((s) => s.setAuthedAddress)
  const loadChats = useYeetfulStore((s) => s.loadChats)
  const resetChats = useYeetfulStore((s) => s.resetChats)
  useEffect(() => {
    setAuthedAddress(effectiveAddress)
    if (effectiveAddress) {
      void loadChats()
    } else {
      resetChats()
    }
  }, [effectiveAddress, setAuthedAddress, loadChats, resetChats])

  const value: SessionValue = {
    address: sessionMatchesWallet ? address : null,
    status,
    signingIn,
    needsSignIn: needsSignIn || (!!address && !sessionMatchesWallet),
    error,
    signIn,
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
