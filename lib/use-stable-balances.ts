'use client'

// The connected wallet's stable + gas balances per chain, for the order
// ticket's "Available" line and its percent presets (lib/order-ticket
// availableFor). One shared read per wallet (GET /api/wallet/balances — the
// light RPC read behind the funding-arrival watcher: native ETH + the
// chain's primary stable, no index, no cache), re-read once a minute while
// the tab is visible and when it comes back into view. Module-level like
// lib/held-read so the strip's ticket and the Trade tab's share one read.
// Null = no wallet, or no successful read yet; a failed read keeps what was
// known and never clears a balance.

import { useEffect, useState } from 'react'
import { useSession } from '@/lib/session'
import type { StableRead } from '@/lib/order-ticket'

export const STABLES_EVERY_MS = 60_000
/** Every chain a ticket can draw from: the spot chains and Robinhood Chain (USDG). */
const CHAINS = 'base,ethereum,arbitrum,optimism,robinhood'

export interface StableBalances {
  chains: StableRead[]
  ethUsd: number | null
  at: number
}

type Wire = { chains?: { id: number; name: string; ok: boolean; nativeEth?: number; stable?: { symbol: string; balance: number } | null }[]; ethUsd?: number | null }

const reads = new Map<string, { at: number; read: Promise<StableBalances | null> }>()
const lastRead = new Map<string, StableBalances>()

export function readStableBalances(address: string, maxAgeMs = STABLES_EVERY_MS): Promise<StableBalances | null> {
  const key = address.toLowerCase()
  const hit = reads.get(key)
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.read
  const read = fetch(`/api/wallet/balances?address=${encodeURIComponent(address)}&chains=${CHAINS}`, { cache: 'no-store' })
    .then(async (r) => {
      if (!r.ok) return null
      const b = (await r.json()) as Wire
      const chains: StableRead[] = (b.chains ?? []).map((c) => ({ id: c.id, name: c.name, ok: c.ok === true, stable: c.ok ? (c.stable ?? null) : undefined }))
      return { chains, ethUsd: typeof b.ethUsd === 'number' ? b.ethUsd : null, at: Date.now() }
    })
    .catch(() => null)
  reads.set(key, { at: Date.now(), read })
  void read.then((v) => {
    if (v === null) {
      if (reads.get(key)?.read === read) reads.delete(key)
    } else {
      lastRead.set(key, v)
    }
  })
  return read
}

export function peekStableBalances(address: string): StableBalances | null {
  return lastRead.get(address.toLowerCase()) ?? null
}

export function useStableBalances(): StableBalances | null {
  const { walletAddress } = useSession()
  const [got, setGot] = useState<{ address: string; value: StableBalances } | null>(null)

  useEffect(() => {
    if (!walletAddress) return
    let alive = true
    const read = async (maxAgeMs?: number) => {
      const v = await readStableBalances(walletAddress, maxAgeMs)
      if (alive && v) setGot({ address: walletAddress, value: v })
    }
    void read()
    const refresh = () => {
      if (!document.hidden) void read(STABLES_EVERY_MS / 2)
    }
    const tick = setInterval(refresh, STABLES_EVERY_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      alive = false
      clearInterval(tick)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [walletAddress])

  if (!walletAddress) return null
  if (got?.address === walletAddress) return got.value
  return peekStableBalances(walletAddress)
}
