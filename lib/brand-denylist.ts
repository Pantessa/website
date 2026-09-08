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

// ── Names, not just hosts (SECURITY-AUDIT 2026-09-08 §C4 / E5) ─────────────
// The domain check above is bypassed by a creator's OWN site whose
// `og:site_name` says "Uniswap", by an agent byline "Coinbase Support", or by
// an inbox sender_label "MetaMask Team". Every free-text mark a stranger can
// put on a Pantessa surface (brand NAME, link `agent`, inbox `senderLabel`)
// passes through here too. Matching is word-level on the NFKC-folded,
// lowercased string, so "Uni-Swap", "ＵＮＩＳＷＡＰ", "coinbase_support" all
// match; a plain "Nate's swaps" does not.

/** The brand words a stranger's free-text mark may never carry. Derived from
 *  the host list (its registrable label) plus wallets/exchanges/brands that
 *  aren't venues but are the classic phishing bylines. */
export const THIRD_PARTY_BRAND_WORDS: readonly string[] = [
  ...THIRD_PARTY_BRAND_HOSTS.map((h) => h.split('.')[0]),
  'cowswap', 'cow swap', 'cow protocol', 'metamask', 'coinbase', 'binance', 'kraken', 'okx', 'bybit', 'gemini',
  'ledger', 'trezor', 'trust wallet', 'trustwallet', 'safe', 'gnosis', 'stripe', 'paypal', 'venmo', 'cash app',
  'chainlink', 'ethereum foundation', 'arbitrum', 'optimism', 'base', 'polygon', 'solana', 'circle', 'tether',
  'uniswap labs', 'lido', 'aave', 'morpho', 'hyperliquid', 'opensea', 'snapshot', 'robinhood', 'lifi', 'li fi',
  'near', 'phantom', 'rabby', 'rainbow', 'walletconnect', 'wallet connect',
]

/** Authority words that turn any name into a phishing byline on a money
 *  surface. Refused on their own ("Support", "Official"), whatever brand
 *  they're next to. */
export const IMPERSONATION_WORDS: readonly string[] = ['support', 'official', 'helpdesk', 'help desk', 'customer service', 'security team', 'verification', 'admin', 'pantessa', 'yeetful']

const fold = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** True when a free-text mark (brand name / agent byline / sender label)
 *  carries a third-party brand word or an authority word. Word-bounded on
 *  the folded string: "base" matches "Base Wallet" but not "database". */
export function isDeniedBrandName(name: string | null | undefined): boolean {
  if (!name) return false
  const f = ` ${fold(name)} `
  if (!f.trim()) return false
  const hit = (w: string) => f.includes(` ${fold(w)} `)
  return THIRD_PARTY_BRAND_WORDS.some(hit) || IMPERSONATION_WORDS.some(hit)
}

/** The refusal copy for a denied NAME — used by the mint/send/brand doors. */
export function deniedBrandNameReason(name: string, what: string = 'name'): string {
  return `Pantessa never wears a third-party brand or an authority word on a money surface — "${name.slice(0, 40)}" is refused as a ${what} (rule 7). Use your own name.`
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
  // A denied NAME (og:site_name "Uniswap" on a creator's own domain) renders
  // as house too — name AND logo drop together, since the logo is whatever
  // that page served next to the name.
  if (isDeniedBrandName(row.brandName)) return null
  return { domain: row.brandDomain, name: row.brandName, logo: row.brandLogo, accent: row.brandAccent, bg: row.brandBg }
}
