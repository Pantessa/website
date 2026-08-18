// lib/brand-denylist.ts — the marks Pantessa must NEVER wear (rule 7).
//
// White-label creator pages (/l/<handle>, branded /i splash + OG cards) take
// their look from ONE pasted URL scanned by lib/brand-scan. The 2026-07-30
// lesson: a DEX interface's marks on a domain that isn't the DEX's is the exact
// signature of a wallet drainer, and it got a Yeetful host blocklisted by
// MetaMask + SEAL. A creator (or a drill — /l/yeet was found live wearing
// Robinhood's logo/name/palette from a scan drill, 2026-08-18) must therefore
// never be able to dress a Pantessa page as a third-party financial brand.
//
// Two enforcement points, both pure:
//   1. WRITE — POST /api/intent-links/brand refuses a denied host by name.
//   2. RENDER — brandFromRow() returns null (house branding) for any stored
//      row whose brand_domain is denied, so legacy rows stop wearing the mark
//      the moment this deploys, without touching data.
//
// The list = every venue Pantessa integrates or names + the venue policy
// hosts. Matching is host OR any subdomain (app.uniswap.org, swap.cow.fi).

import { NATIVE_VENUE_HOSTS } from '@/lib/venue-hosts'

export const THIRD_PARTY_BRAND_HOSTS: readonly string[] = [
  'uniswap.org',
  'cow.fi',
  'robinhood.com',
  'metamask.io',
  'coinbase.com',
  'aave.com',
  'lido.fi',
  'hyperliquid.xyz',
  'opensea.io',
  'snapshot.org',
  'snapshot.box',
  'near.org',
  'li.fi',
  'morpho.org',
  'rainbow.me',
  'walletconnect.com',
  'phantom.app',
  'rabby.io',
  // + the venue policy hosts that aren't our own synthetic *.yeetful.com ones
  ...NATIVE_VENUE_HOSTS.filter((h) => !/\.yeetful\.com$/.test(h)).map((h) => h.split('.').slice(-2).join('.')),
]

const DENIED = new Set(THIRD_PARTY_BRAND_HOSTS.map((h) => h.toLowerCase()))

/** True when `host` IS a denied brand host or sits under one. Accepts a bare
 *  hostname or anything URL-shaped (the stored brand_domain is bare). */
export function isDeniedBrandHost(hostOrUrl: string | null | undefined): boolean {
  if (!hostOrUrl) return false
  let host = hostOrUrl.trim().toLowerCase()
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname.toLowerCase()
    } catch {
      return false
    }
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '')
  const parts = host.split('.')
  for (let i = 0; i < parts.length - 1; i++) {
    if (DENIED.has(parts.slice(i).join('.'))) return true
  }
  return false
}

/** The refusal copy for the write site — names the rule, not just the host. */
export function deniedBrandReason(host: string): string {
  return `Pantessa never wears a third-party financial brand — ${host} is on the do-not-impersonate list. Paste YOUR OWN site's URL; the page keeps the house look until then.`
}

export interface CreatorBrand {
  domain: string | null
  name: string | null
  logo: string | null
  accent: string | null
  bg: string | null
}

/** The ONE way a stored creator_handles brand row becomes a render-time brand:
 *  null when the row carries no brand — or when its domain is denied (house
 *  branding wins; the data is left alone for the owner to clear). Every /l,
 *  /i and OG render site goes through here. */
export function brandFromRow(
  row: { brandDomain: string | null; brandName: string | null; brandLogo: string | null; brandAccent: string | null; brandBg: string | null } | null | undefined,
): CreatorBrand | null {
  if (!row) return null
  if (!(row.brandDomain || row.brandLogo || row.brandAccent || row.brandBg)) return null
  if (isDeniedBrandHost(row.brandDomain)) return null
  return { domain: row.brandDomain, name: row.brandName, logo: row.brandLogo, accent: row.brandAccent, bg: row.brandBg }
}
