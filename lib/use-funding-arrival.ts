'use client'

// The React half of lib/funding-arrival.ts: given a FundWait, poll the
// chain the purchase was sent to and report when the balance rises.
//
// One instance per wait. The chip that opened the on-ramp owns it; the
// wallet panel only reads the stored wait to say "watching Ethereum". The
// hook never fires the resume itself — it reports, and the surface decides
// when to continue (the chip waits for the tab to be visible and the chat to
// be idle, so a turn never starts under a user who is elsewhere).

import { useEffect, useRef, useState } from 'react'
import {
  detectArrival,
  pollDelayMs,
  saveFundWait,
  type Arrival,
  type FundWait,
} from '@/lib/funding-arrival'

export type ArrivalStatus = 'idle' | 'watching' | 'arrived' | 'timeout'

export interface FundingArrivalState {
  status: ArrivalStatus
  arrival: Arrival | null
  /** Human chain name the watcher reads ("Ethereum"). */
  chainName: string
  /** Primary stable symbol on that chain, for the phrase. */
  stableSymbol: string
  /** ISO time of the last successful read, for "checked 12s ago". */
  lastReadAt: string | null
  /** Consecutive failed reads — the surface can say the chain isn't answering. */
  failures: number
}

interface BalancesReply {
  at?: string
  ethUsd?: number | null
  chains?: { key: string; name: string; ok: boolean; nativeEth?: number; stable?: { symbol: string; balance: number } | null }[]
}

const NETWORK_NAME: Record<string, string> = { base: 'Base', ethereum: 'Ethereum' }

export function useFundingArrival(wait: FundWait | null, enabled: boolean): FundingArrivalState {
  const [state, setState] = useState<FundingArrivalState>({
    status: 'idle',
    arrival: null,
    chainName: wait ? NETWORK_NAME[wait.network] ?? wait.network : '',
    stableSymbol: 'USDC',
    lastReadAt: null,
    failures: 0,
  })
  // The wait is mutated in place when the first read sets the baseline —
  // a ref keeps that off the effect's dependency list.
  const waitRef = useRef<FundWait | null>(wait)
  waitRef.current = wait

  useEffect(() => {
    if (!enabled || !wait) {
      setState((s) => (s.status === 'idle' ? s : { ...s, status: 'idle', arrival: null }))
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const started = Date.now()
    setState((s) => ({ ...s, status: 'watching', arrival: null, chainName: NETWORK_NAME[wait.network] ?? wait.network }))

    const tick = async () => {
      const w = waitRef.current
      if (cancelled || !w) return
      try {
        const res = await fetch(`/api/wallet/balances?address=${w.address}&chains=${w.network}`, { cache: 'no-store' })
        const data = (await res.json()) as BalancesReply
        const row = data.chains?.find((c) => c.key === w.network)
        if (!res.ok || !row || !row.ok) throw new Error('unreadable')
        const read = { eth: row.nativeEth ?? 0, stable: row.stable?.balance ?? 0 }
        if (w.baselineEth === null || w.baselineStable === null) {
          // First read = the baseline. Written back so a reload compares
          // against the same numbers instead of calling the whole balance a
          // delivery.
          const next: FundWait = { ...w, baselineEth: read.eth, baselineStable: read.stable }
          waitRef.current = next
          saveFundWait(next)
          setState((s) => ({ ...s, lastReadAt: data.at ?? new Date().toISOString(), failures: 0, stableSymbol: row.stable?.symbol ?? s.stableSymbol }))
        } else {
          const arrival = detectArrival({ eth: w.baselineEth, stable: w.baselineStable }, read, data.ethUsd ?? null)
          if (arrival) {
            setState((s) => ({ ...s, status: 'arrived', arrival, lastReadAt: data.at ?? new Date().toISOString(), failures: 0, stableSymbol: row.stable?.symbol ?? s.stableSymbol }))
            return
          }
          setState((s) => ({ ...s, lastReadAt: data.at ?? new Date().toISOString(), failures: 0, stableSymbol: row.stable?.symbol ?? s.stableSymbol }))
        }
      } catch {
        setState((s) => ({ ...s, failures: s.failures + 1 }))
      }
      if (cancelled) return
      const delay = pollDelayMs(Date.now() - started)
      if (delay === null) {
        setState((s) => ({ ...s, status: 'timeout' }))
        return
      }
      timer = setTimeout(tick, delay)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // The wait's identity is (address, network, openedAt); baseline writes
    // go through the ref and must not restart the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, wait?.address, wait?.network, wait?.openedAt])

  return state
}
