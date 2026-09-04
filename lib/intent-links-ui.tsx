'use client'

// Client-side shapes + data hook for the creator studio — the mint form,
// funnel table, earnings panel, and creator-page panel all read from here so
// the studio can render on more than one surface (dashboard, chat rail)
// without re-declaring the API contract. Funnel values are per-link telemetry
// (client-reported) — the global money-moved metric stays guardrail-priced in
// embed_turns and is NOT fed from this.
//
// `links` is LIVE links only: revoking takes a link down everywhere, so the
// route stops listing it and no surface here has to remember to filter. The
// earnings totals still include what revoked links earned — money outlives
// the link that made it (app/api/intent-links/route.ts).

import { useCallback, useEffect, useState } from 'react'

export interface LinkRow {
  slug: string
  url: string
  ask: string
  variants: string[]
  agent: string | null
  redirectUrl: string | null
  createdAt: string
  expiresAt: string | null
  maxSigns: number | null
  allowCount: number
  /** Server-truth signed turns (embed_turns) — what the maxSigns cap counts. */
  signsCount: number
  funnel: { open: number; connect: number; built: number; signed: number; valueUsd: number }
  /** Per-phrasing funnels — present only when the link A/B tests its ask. */
  funnelVariants?: Array<{ variant: number; ask: string; open: number; connect: number; built: number; signed: number }>
  /** Server-truth signed notional attributed to this link (embed_turns). */
  signedUsd: number
  /** Creator's accrued half of the fee on fee-bearing conversions. */
  earnedUsd: number
}

export interface Earnings {
  totalEarnedUsd: number
  /** All signed notional these links produced — fee-bearing or not. */
  totalSignedUsd: number
  /** The slice that took a fee-bearing route — the earnings base. */
  totalFeeBearingUsd: number
  claimedUsd: number
  claimableUsd: number
  minClaimUsd: number
  /** Lifetime referral rail (C2): wallets first-touched by these links, and
   *  what their later UNattributed fee-bearing turns earned (already inside
   *  totalEarnedUsd — surfaced separately so the creator can see the rail
   *  working). Optional: older cached responses may lack them. */
  referredWallets?: number
  referredEarnedUsd?: number
  referredSignedUsd?: number
  /** Per-ISO-week cadence (newest first, last ~5 weeks; direct + rail
   *  merged) — the 30-day out-earn instrument: one week here vs the same
   *  week's ref-code payout. Optional: older cached responses lack it. */
  weekly?: { weekStart: string; earnedUsd: number; signedUsd: number; signs: number }[]
  referredSigns?: number
}

export interface Brand {
  domain: string | null
  name: string | null
  logo: string | null
  accent: string | null
  bg: string | null
}

/** The creator's links + earnings, with a stable reload. A 401 lands in
 *  `loadError` as the sign-in line rather than throwing — the studio renders
 *  signed-out surfaces too. */
export function useIntentLinks() {
  const [links, setLinks] = useState<LinkRow[] | null>(null)
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(() => {
    void fetch('/api/intent-links', { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 401) {
          setLoadError('Sign in with your wallet to mint and track intent links.')
          return null
        }
        return r.json()
      })
      .then((d: { links: LinkRow[]; earnings?: Earnings } | null) => {
        if (d) {
          setLinks(d.links)
          setEarnings(d.earnings ?? null)
        }
      })
      .catch(() => setLoadError('Could not load your links — try a refresh.'))
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  // Watchable funnel: the creator studio + rail Links tab keep this open
  // while a recruit walks a link — re-read every 30s while the tab is
  // visible (paused hidden), and stamp updatedAt for the live pill.
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  useEffect(() => {
    if (typeof document === 'undefined') return
    let timer: ReturnType<typeof setInterval> | null = null
    const tick = () => {
      if (document.visibilityState === 'hidden') return
      reload()
      setUpdatedAt(Date.now())
    }
    const start = () => {
      if (!timer) timer = setInterval(tick, 30_000)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const onVis = () => (document.visibilityState === 'visible' ? (tick(), start()) : stop())
    setUpdatedAt(Date.now())
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [reload])

  return { links, earnings, loadError, reload, updatedAt }
}
