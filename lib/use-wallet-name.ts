'use client'

// lib/use-wallet-name.ts — the React half of lib/wallet-identity.
//
// Collects EIP-6963 announcements (every extension re-announces on request,
// and keeps announcing as it loads), asks the connected connector for its
// provider, and matches the two by object identity. Nothing here decides
// anything: the rules live in lib/wallet-identity, pinned by the harness.

import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { announcedNameFor, type AnnouncedWallet } from '@/lib/wallet-identity'

type AnnounceEvent = CustomEvent<{ info?: { name?: string; rdns?: string }; provider?: unknown }>

/** The name the connected wallet announces for itself, or undefined. */
export function useAnnouncedWalletName(): string | undefined {
  const { connector, address } = useAccount()
  const [announced, setAnnounced] = useState<AnnouncedWallet[]>([])
  const [provider, setProvider] = useState<unknown>(undefined)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onAnnounce = (e: Event) => {
      const detail = (e as AnnounceEvent).detail
      const name = detail?.info?.name
      const p = detail?.provider
      if (!name || !p) return
      setAnnounced((prev) => (prev.some((a) => a.provider === p) ? prev : [...prev, { name, rdns: detail?.info?.rdns, provider: p }]))
    }
    window.addEventListener('eip6963:announceProvider', onAnnounce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce)
  }, [])

  useEffect(() => {
    let live = true
    if (!connector) {
      setProvider(undefined)
      return
    }
    // A connector that can't hand back a provider simply doesn't get renamed.
    void connector
      .getProvider()
      .then((p) => {
        if (live) setProvider(p)
      })
      .catch(() => {
        if (live) setProvider(undefined)
      })
    return () => {
      live = false
    }
  }, [connector, address])

  return announcedNameFor(announced, provider)
}
