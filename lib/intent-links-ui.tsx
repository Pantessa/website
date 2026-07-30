'use client'

// Client-side shapes + data hook for the creator studio — the mint form,
// funnel table, earnings panel, and creator-page panel all read from here so
// the studio can render on more than one surface (dashboard, chat rail)
// without re-declaring the API contract. Funnel values are per-link telemetry
// (client-reported) — the global money-moved metric stays guardrail-priced in
// embed_turns and is NOT fed from this.

import { useCallback, useEffect, useState } from 'react'

export interface LinkRow {
  slug: string
  url: string
  ask: string
  variants: string[]
  agent: string | null
  redirectUrl: string | null
  revoked: boolean
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

  return { links, earnings, loadError, reload }
}
