'use client'

// The job this wallet can run right now, for every surface that offers one
// as a default (squad lane1, the jobs audit, 2026-11-17). The rule and the
// catalog are lib/job-offers (pure); this hook only supplies the facts.
//
// Facts: GET /api/wallet/balances, the light per-chain read (native ETH + the
// chain's primary stable, straight from the RPC) that the funding-arrival
// watcher and lib/use-stable-balances already use. That hook drops the
// native ETH figure, and the offer needs it twice (ETH on the origin to sign,
// ETH on Robinhood Chain to skip the gas leg), so this one keeps the same
// shape of shared module-level read with the field kept. One read per wallet
// a minute while the tab is visible; a failed read keeps what was known.
//
// States (lib/job-offers jobOfferView): no wallet -> 'connect'; nothing read
// yet -> 'loading' (a surface shows no button that could be wrong); read ->
// 'offer' with the exact sentence, 'fund' when the wallet can run none, or
// 'unread' when a chain that matters did not answer.

import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { useSession } from '@/lib/session'
import { jobOfferView, type JobOfferFacts, type JobOfferView } from '@/lib/job-offers'

export const JOB_OFFER_EVERY_MS = 60_000
/** The four funding origins and Robinhood Chain (the gas question). */
const CHAINS = 'base,arbitrum,optimism,ethereum,robinhood'

type Wire = { chains?: { id: number; ok: boolean; nativeEth?: number; stable?: { symbol: string; balance: number } | null }[] }

const reads = new Map<string, { at: number; read: Promise<JobOfferFacts | null> }>()
const lastRead = new Map<string, JobOfferFacts>()

export function readJobOfferFacts(address: string, maxAgeMs = JOB_OFFER_EVERY_MS): Promise<JobOfferFacts | null> {
  const key = address.toLowerCase()
  const hit = reads.get(key)
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.read
  const read = fetch(`/api/wallet/balances?address=${encodeURIComponent(address)}&chains=${CHAINS}`, { cache: 'no-store' })
    .then(async (r) => {
      if (!r.ok) return null
      const b = (await r.json()) as Wire
      if (!Array.isArray(b.chains)) return null
      const facts: JobOfferFacts = {
        chains: b.chains.map((c) => ({ chainId: c.id, ok: c.ok === true, stable: c.ok ? (c.stable ?? null) : undefined, nativeEth: c.ok && typeof c.nativeEth === 'number' ? c.nativeEth : undefined })),
      }
      return facts
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

export function useJobOffer(): JobOfferView {
  const { walletAddress } = useSession()
  const { status: walletStatus } = useAccount()
  const [got, setGot] = useState<{ address: string; facts: JobOfferFacts } | null>(null)

  useEffect(() => {
    if (!walletAddress) return
    let alive = true
    const read = async (maxAgeMs?: number) => {
      const v = await readJobOfferFacts(walletAddress, maxAgeMs)
      if (alive && v) setGot({ address: walletAddress, facts: v })
    }
    void read()
    const refresh = () => {
      if (!document.hidden) void read(JOB_OFFER_EVERY_MS / 2)
    }
    const tick = setInterval(refresh, JOB_OFFER_EVERY_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      alive = false
      clearInterval(tick)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [walletAddress])

  // A wallet wagmi is still bringing back is not "no wallet": wait, so the
  // connect door never flashes at someone who is connected.
  if (!walletAddress) return walletStatus === 'reconnecting' || walletStatus === 'connecting' ? { state: 'loading' } : jobOfferView(null, null)
  // Another wallet's balances never answer for this one.
  const facts = got?.address === walletAddress ? got.facts : (lastRead.get(walletAddress.toLowerCase()) ?? null)
  return jobOfferView(walletAddress, facts)
}
