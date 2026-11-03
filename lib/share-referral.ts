// lib/share-referral.ts — a share that pays (squad five-million, lane PERPS,
// 2026-11-03; GTM-PLAN-5M-ARR §3 "the referral carried on every share and
// paid on HL volume").
//
// What was true before this file (PERPS.md § Measurement): the sharer's id
// rode `?via=` on the chart share, got cookied by ViaTracker, and was
// stamped into `wallet_arrivals` at the SIWE door — and that was the end of
// it. `referred_wallets` (the lifetime-earnings key) had ONE writer: a
// COUNTED sign through an intent link. A trader who came in on a chart, a
// live view, the deck or a creator page and then traded was nobody's.
//
// Now the server's own arrival record is the referral's source: at the SIWE
// door, right after the arrival is stamped (or read back, for a wallet that
// arrived before this shipped), the arrival's `via` resolves to the wallet
// behind it and `referred_wallets` gets its write-once row with the slug
// `via:<id>` — the same table, the same readers (creator earnings at
// /chat?tab=links, the claims door, the in-tx creator split, Growth), the
// same self-referral and internal-run fences. Nothing here reads a client
// claim: no body field names a referrer, ever (CLAUDE.md: a client's claim
// is evidence about the client).
//
// Resolving `via` → wallet: the id is a one-way hash of the sharer's wallet
// (lib/share-receipts viaIdOf). There is no stored map (a `share_vias` table
// is the Spec ask for wave 2), so the resolver hashes every wallet the
// product has a first-party record of — creators with a handle or a link,
// alert and watchlist owners, Telegram owners, arrivals, referrers, and
// signing wallets of the last year — into an in-process index, refreshed
// every five minutes and at most once a minute on a miss. A sharer the
// product has never seen under any of those resolves to nobody, and the
// arrival stays analytics, as before.

import prisma from '@/lib/db'
import { VIA_RE, viaIdOf } from '@/lib/share-receipts'

/** The `intent_link_slug` a share referral carries: not a link, a `via:` seat. */
export const VIA_REFERRAL_SLUG_PREFIX = 'via:'

export function viaReferralSlug(via: string): string {
  return `${VIA_REFERRAL_SLUG_PREFIX}${via}`
}

export function isViaReferralSlug(slug: string | null | undefined): boolean {
  return typeof slug === 'string' && slug.startsWith(VIA_REFERRAL_SLUG_PREFIX) && VIA_RE.test(slug.slice(VIA_REFERRAL_SLUG_PREFIX.length))
}

/** Pure: an index of candidate wallets by their via id. Lowercases, drops
 *  anything not address-shaped, first wallet wins a (never-seen) collision. */
export function viaIndex(wallets: Iterable<string>): Map<string, string> {
  const index = new Map<string, string>()
  for (const raw of wallets) {
    if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(raw)) continue
    const wallet = raw.toLowerCase()
    const via = viaIdOf(wallet)
    if (!index.has(via)) index.set(via, wallet)
  }
  return index
}

/** How long a built index is trusted, and the floor between miss-driven rebuilds. */
export const VIA_INDEX_TTL_MS = 5 * 60_000
export const VIA_INDEX_MISS_REBUILD_MS = 60_000

/** Every wallet the product holds a first-party record of (see the header). */
export async function candidateReferrerWallets(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ w: string | null }[]>`
    SELECT DISTINCT w FROM (
      SELECT creator AS w FROM creator_handles
      UNION SELECT creator FROM intent_links WHERE creator IS NOT NULL AND NOT is_internal
      UNION SELECT creator FROM referred_wallets
      UNION SELECT owner FROM price_alerts
      UNION SELECT owner FROM print_alerts
      UNION SELECT owner FROM watchlists
      UNION SELECT owner FROM telegram_links
      UNION SELECT address FROM wallet_arrivals
      UNION SELECT wallet_address FROM embed_turns
        WHERE wallet_address IS NOT NULL AND outcome = 'signed' AND NOT is_internal
          AND created_at > now() - interval '365 days'
    ) u WHERE w IS NOT NULL`
  return rows.map((r) => r.w).filter((w): w is string => typeof w === 'string')
}

let cache: { at: number; index: Map<string, string> } | null = null
let lastMissRebuildAt = 0
let building: Promise<Map<string, string>> | null = null

async function buildIndex(): Promise<Map<string, string>> {
  if (building) return building
  building = (async () => {
    try {
      const index = viaIndex(await candidateReferrerWallets())
      cache = { at: Date.now(), index }
      return index
    } finally {
      building = null
    }
  })()
  return building
}

/** Drop the index (the pins call it between fixtures). */
export function resetViaIndex(): void {
  cache = null
  lastMissRebuildAt = 0
}

/** The wallet behind a via id, or null when no first-party record names it. */
export async function creatorForVia(viaRaw: string): Promise<string | null> {
  const via = (viaRaw ?? '').trim()
  if (!VIA_RE.test(via)) return null
  const fresh = cache && Date.now() - cache.at < VIA_INDEX_TTL_MS ? cache.index : await buildIndex()
  const hit = fresh.get(via)
  if (hit) return hit
  // A miss on a fresh index: the sharer may have appeared since the build
  // (a handle claimed a minute ago). One rebuild a minute, then give up.
  if (Date.now() - lastMissRebuildAt < VIA_INDEX_MISS_REBUILD_MS) return null
  lastMissRebuildAt = Date.now()
  return (await buildIndex()).get(via) ?? null
}

export type ShareReferralOutcome = 'claimed' | 'exists' | 'self' | 'unresolved' | 'internal' | 'bad-via'

export interface ShareReferralResult {
  outcome: ShareReferralOutcome
  /** The referrer (lowercased) when one resolved; never echoed to a client. */
  creator: string | null
}

/** Bind `wallet` to the sharer behind `via` for life — write-once (a second
 *  share, or a later intent link, never re-claims), self-referrals and
 *  internal runs refused, and the referrer must resolve from a first-party
 *  record. Fail-soft: a database error reads as `unresolved`. */
export async function claimShareReferral(input: { wallet: string; via: string; internal: boolean }): Promise<ShareReferralResult> {
  const wallet = input.wallet.toLowerCase()
  if (input.internal) return { outcome: 'internal', creator: null }
  if (!VIA_RE.test(input.via)) return { outcome: 'bad-via', creator: null }
  try {
    const existing = await prisma.referredWallet.findUnique({ where: { wallet }, select: { creator: true } })
    if (existing) return { outcome: 'exists', creator: existing.creator }
    const creator = await creatorForVia(input.via)
    if (!creator) return { outcome: 'unresolved', creator: null }
    if (creator === wallet) return { outcome: 'self', creator }
    const { count } = await prisma.referredWallet.createMany({ data: [{ wallet, creator, intentLinkSlug: viaReferralSlug(input.via) }], skipDuplicates: true })
    return { outcome: count === 1 ? 'claimed' : 'exists', creator }
  } catch {
    return { outcome: 'unresolved', creator: null }
  }
}

/** The SIWE door's call: the wallet just proved itself; its arrival record
 *  (stamped a moment ago, or on an earlier sign-in) names the share it came
 *  in on. Reads only the server's own `wallet_arrivals` row. */
export async function claimReferralFromArrival(input: { wallet: string; internal: boolean }): Promise<ShareReferralResult | null> {
  const wallet = input.wallet.toLowerCase()
  if (input.internal) return { outcome: 'internal', creator: null }
  try {
    const arrival = await prisma.walletArrival.findUnique({ where: { address: wallet }, select: { via: true } })
    if (!arrival) return null
    return claimShareReferral({ wallet, via: arrival.via, internal: false })
  } catch {
    return null
  }
}
