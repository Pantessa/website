'use client'

// Settlement watch for a lone cross-chain sign card.
//
// A NEAR Intents swap is one signature — the deposit — and then the venue
// does the rest. Until 2026-09-22 the card stopped watching at the deposit's
// own confirmation and printed "signed & settled" over a swap that was, in
// the live case that produced this file, about to be refunded. The jobs
// runner has polled `check_status` all along; this is the same read for the
// card that never had one.
//
// Polls /api/xchain/status (10s, then 20s, giving up after ~45 minutes),
// stops the moment the venue is terminal, hands the outcome up to be
// persisted on the message, and says "still settling" in the meantime —
// never "settled".

import { useEffect, useRef, useState } from 'react'
import SettlementLine from '@/components/SettlementLine'
import {
  isTerminal,
  nextPollDelayMs,
  SETTLEMENT_WATCH_MS,
  type SettlementOutcome,
  type XchainDeposit,
} from '@/lib/xchain-settlement'

export default function XchainSettlement({
  dep,
  signedHashes,
  initial,
  onOutcome,
}: {
  dep: XchainDeposit
  /** Deposit transactions this browser signed — so a refund is never
   *  mistaken for one of them (lib/xchain-settlement parseSwapStatus). */
  signedHashes: string[]
  /** The persisted outcome, when the message already carries one. */
  initial?: SettlementOutcome | null
  /** Terminal outcomes only — the caller persists + reports them. */
  onOutcome?: (outcome: SettlementOutcome) => void
}) {
  const [outcome, setOutcome] = useState<SettlementOutcome | null>(initial ?? null)
  const [watching, setWatching] = useState(false)
  const reported = useRef(false)

  const settled = initial && isTerminal(initial.status)
  // Identity of the swap being watched — a new deposit address restarts it.
  const key = dep.depositAddress.toLowerCase()
  const hashes = signedHashes.join(',')

  useEffect(() => {
    if (settled) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()
    setWatching(true)

    const poll = async (attempt: number) => {
      if (!live) return
      try {
        const res = await fetch('/api/xchain/status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            depositAddress: dep.depositAddress,
            originChain: dep.originChain,
            destinationChain: dep.destinationChain,
            signedHashes: hashes ? hashes.split(',') : [],
          }),
        })
        const body = (await res.json().catch(() => null)) as { outcome?: SettlementOutcome } | null
        const next = body?.outcome
        if (!live) return
        if (next && typeof next.status === 'string') {
          setOutcome(next)
          if (isTerminal(next.status)) {
            setWatching(false)
            if (!reported.current) {
              reported.current = true
              onOutcome?.(next)
            }
            return
          }
        }
      } catch {
        // A failed probe is not an outcome — keep watching, keep saying
        // "still settling". Never claim a settlement we didn't read.
      }
      if (!live) return
      if (Date.now() - startedAt > SETTLEMENT_WATCH_MS) {
        setWatching(false)
        return
      }
      timer = setTimeout(() => void poll(attempt + 1), nextPollDelayMs(attempt))
    }

    void poll(0)
    return () => {
      live = false
      setWatching(false)
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hashes, settled])

  if (!outcome) {
    return (
      <SettlementLine dep={dep} outcome={{ status: 'unknown', terminal: false }} watching={watching} />
    )
  }
  return <SettlementLine dep={dep} outcome={outcome} watching={watching} />
}
