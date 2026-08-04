// Intent links — pure helpers shared by the mint API, the /i runtime, and
// the creator dashboard. An intent link carries an ASK as a sentence, never
// calldata: the runtime rebuilds it through the guarded native layers, and
// the connected wallet is the only signer. Everything here treats the ask as
// untrusted input.

export const ASK_MAX = 400

/** Untrusted-input hygiene — same contract as the /sign page. */
export function cleanAsk(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ASK_MAX)
}

/** Slug shape accepted by every /i lookup and event/telemetry gate: minted
 *  slugs are 8 chars of the unambiguous alphabet; HOUSE links
 *  (lib/house-links.ts) use readable hyphenated slugs (buy-aapl). 4–16
 *  chars, hyphens allowed inside, never at the edges. */
export const INTENT_SLUG_RE = /^[a-z0-9][a-z0-9-]{2,14}[a-z0-9]$/

/** Unambiguous lowercase alphabet (no 0/o/1/l) — 8 chars ≈ 40 bits. */
const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function mintSlug(len = 8): string {
  // Web crypto (edge- and client-safe) so this module stays importable from
  // client components that only want the pure helpers (composeMcps preview).
  const bytes = new Uint8Array(len)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length]
  return out
}

/** The MCPs a creator can attach to a link — curated labels for the manual
 *  picker; slugs must exist in the seeded directory. */
export const MINTABLE_MCPS: Array<{ slug: string; label: string }> = [
  { slug: 'robinhood-free', label: 'Robinhood Chain' },
  { slug: 'hyperliquid-free', label: 'Hyperliquid' },
  { slug: 'uniswap-free', label: 'Uniswap' },
  { slug: 'opensea-free', label: 'OpenSea NFTs' },
  { slug: 'cow-free', label: 'CoW Protocol' },
  { slug: 'snapshot-free', label: 'Snapshot DAO' },
  { slug: 'lido-free', label: 'Lido' },
  { slug: 'aave', label: 'Aave' },
  { slug: 'near-intents-mcp-yeetful', label: 'NEAR Intents (bridging)' },
  { slug: 'yeetful-tool-wallet', label: 'Yeetful Wallet' },
]

/** Validate a caller-chosen MCP list: known slugs only, capped, deduped. */
export function sanitizeMcps(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const known = new Set(MINTABLE_MCPS.map((m) => m.slug))
  const picked = [...new Set(raw.map((s) => String(s).trim()).filter((s) => known.has(s)))].slice(0, 4)
  return picked.length ? picked : null
}

/** Auto-compose the MCP set from the intent's shape. The native layers parse
 *  most asks with no MCP at all — these slugs mainly pull the right splash
 *  cards + reads into the runtime so the build has its context. Doubles as
 *  the creator form's "Decide for me" suggester, so every rule here shows
 *  its work as lit chips. */
export function composeMcps(ask: string): string[] {
  const a = ask.toLowerCase()
  const slugs: string[] = []
  // Every noun alternation is plural-tolerant — "Show my NFTs" once composed
  // to NO opensea because \bnft\b can't match "nfts" (live house-link miss).
  // Tickers AND common company names both land on Robinhood — asks say
  // "Buy $10 of Apple" as often as "of AAPL".
  if (/\b(aapl|tsla|nvda|amd|msft|amzn|meta|googl?|google|apple|tesla|nvidia|microsoft|amazon|netflix|nflx|palantir|pltr|hood|stocks?|shares? of|robinhood)\b/.test(a)) slugs.push('robinhood-free')
  if (/\b(perps?|positions?|long|short|leverage|margin|hyperliquid|stop[- ]?loss(es)?|take[- ]?profits?)\b/.test(a)) slugs.push('hyperliquid-free')
  if (/\b(nfts?|opensea|seaport|floors?|collections?)\b/.test(a)) slugs.push('opensea-free')
  // Same-chain swaps run the Uniswap venue; a cross-chain "swap X from A to
  // B" settles through NEAR Intents instead, so the from→to shape doesn't
  // pull Uniswap unless the ask names it.
  const crossChainShape = /\bfrom\s+\w+\s+to\s+\w+\b/.test(a)
  if (/\b(uniswap|dex)\b/.test(a) || (!crossChainShape && /\b(swaps?|swapping|convert)\b/.test(a))) slugs.push('uniswap-free')
  if (/\b(cow ?swap|cow ?protocol|cow|limit orders?)\b/.test(a)) slugs.push('cow-free')
  if (/\b(stake|steth|wsteth|lido)\b/.test(a)) slugs.push('lido-free')
  if (/\b(supply|borrow|repay|aave|lend)\b/.test(a)) slugs.push('aave')
  if (/\b(vote|proposal|snapshot|dao|governance)\b/.test(a)) slugs.push('snapshot-free')
  if (/\b(portfolio|balances?|holdings?|wallet)\b/.test(a)) slugs.push('yeetful-tool-wallet')
  // Bridging/swapping rides the native cross-chain + funding layers; the
  // NEAR Intents MCP joins the set whenever movement between chains is
  // plausible — which is any funded action, so it's the default companion.
  slugs.push('near-intents-mcp-yeetful')
  return [...new Set(slugs)].slice(0, 4)
}

/** How many A/B alternate phrasings a link may carry beyond the base ask. */
export const MAX_VARIANTS = 3

/** Sanitize creator-supplied A/B phrasings: cleaned like the ask, sentence
 *  minimum, deduped against the base and each other, capped. Every variant
 *  is a full ask in its own right — the runtime shows exactly one and every
 *  gate (transfer shape included) applies to the one shown. */
export function sanitizeVariants(raw: unknown, baseAsk: string): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    const a = cleanAsk(String(v))
    if (a.length < 8 || a === baseAsk || out.includes(a)) continue
    out.push(a)
    if (out.length >= MAX_VARIANTS) break
  }
  return out
}

/** Transfer-shaped asks (send X to <address/ens>) are the phishing shape —
 *  they NEVER auto-build from a link. The runtime falls back to prefill-only
 *  so a human types nothing but must deliberately press send. */
export function isTransferShaped(ask: string): boolean {
  const a = ask.toLowerCase()
  return /\b(send|transfer|pay|give)\b/.test(a) && (/0x[0-9a-fA-F]{6,}/.test(ask) || /\b[a-z0-9-]+\.eth\b/.test(a) || /\bto\s+(him|her|them|me|this address|wallet)\b/.test(a))
}

/** Mint-time redirect validation: https only, no credentials, no localhost.
 *  Stored server-side with the link — the runtime NEVER reads a redirect
 *  from the query string, which is what kills open-redirect tampering. */
export function validateRedirect(raw: string): { ok: true; url: string; host: string } | { ok: false; reason: string } {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, reason: 'redirect_url is not a valid URL' }
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'redirect_url must be https' }
  if (u.username || u.password) return { ok: false, reason: 'redirect_url must not carry credentials' }
  if (u.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return { ok: false, reason: 'redirect_url must be a public hostname' }
  return { ok: true, url: u.toString(), host: u.hostname }
}

export const EVENT_KINDS = ['open', 'connect', 'built', 'signed', 'settled'] as const
export type IntentEventKind = (typeof EVENT_KINDS)[number]

/** Active-link capacity per plan — the third capacity axis alongside
 *  standing intents (PRICING.md). Soft: mints past the cap get a friendly
 *  upgrade pointer; existing links keep running forever. Admin wallets
 *  (OWNER_WALLETS ∪ ADMIN_WALLETS) are exempt — the cap gates external
 *  creators, not the team minting demo/marketing links. */
export const LINK_CAPS: Record<string, number> = { free: 3, growth: 25, scale: Infinity }

export function activeLinkCapFor(planId: string, isAdmin: boolean): number {
  if (isAdmin) return Infinity
  return LINK_CAPS[planId] ?? 3
}

// ── Creator handles (/l/<handle> storefronts) ──────────────────────────────
// Opt-in public page names. Opt-in is the privacy contract: a wallet is
// never the key to a public page — only a claimed handle is.

/** Route/brand names a handle may not shadow. */
export const RESERVED_HANDLES = new Set([
  'admin', 'api', 'app', 'activity', 'blog', 'chat', 'dashboard', 'docs',
  'doc', 'embed', 'help', 'i', 'l', 'link', 'links', 'me', 'official', 'p',
  'pricing', 'r', 'root', 'servers', 'sign', 'support', 'team', 'www',
  'yeetful',
])

/** Normalize a claimed handle: lowercase, 3–20 chars of [a-z0-9-], no edge
 *  hyphens, not reserved. Returns null when unclaimable. */
export function normalizeHandle(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/^@/, '')
  if (!/^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])$/.test(h)) return null
  if (RESERVED_HANDLES.has(h)) return null
  return h
}

// ── Partner-promo limits (expiry / max-signs / allowlists) ─────────────────
// All optional, all validated at MINT. Enforcement is server-side: expiry +
// sign-cap gate the /i page load (sign counts come from server-truth
// embed_turns, never client-reported events); the allowlist gates the
// runtime's auto-run via a membership probe so the list itself never ships
// in page HTML.

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000

/** Parse a mint-time expiry. Absent → null (never expires). */
export function parseExpiry(raw: unknown): { ok: true; date: Date | null } | { ok: false; reason: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, date: null }
  const d = new Date(String(raw))
  if (isNaN(d.getTime())) return { ok: false, reason: 'expiresAt is not a valid date' }
  const now = Date.now()
  if (d.getTime() <= now) return { ok: false, reason: 'expiresAt must be in the future' }
  if (d.getTime() > now + TWO_YEARS_MS) return { ok: false, reason: 'expiresAt must be within two years' }
  return { ok: true, date: d }
}

/** Parse a mint-time sign cap. Absent → null (unlimited). */
export function parseMaxSigns(raw: unknown): { ok: true; max: number | null } | { ok: false; reason: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, max: null }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return { ok: false, reason: 'maxSigns must be an integer from 1 to 1,000,000' }
  return { ok: true, max: n }
}

/** Parse a mint-time wallet allowlist. Partner lists must not silently lose
 *  entries — any malformed address is an ERROR, never a drop. */
export function parseAllowWallets(raw: unknown): { ok: true; wallets: string[] } | { ok: false; reason: string } {
  if (raw === undefined || raw === null) return { ok: true, wallets: [] }
  if (!Array.isArray(raw)) return { ok: false, reason: 'allowWallets must be an array of 0x addresses' }
  const out = new Set<string>()
  for (const w of raw) {
    const s = String(w).trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return { ok: false, reason: `allowWallets contains a malformed address: "${s.slice(0, 60)}"` }
    out.add(s.toLowerCase())
  }
  if (out.size > 500) return { ok: false, reason: 'allowWallets is capped at 500 wallets' }
  return { ok: true, wallets: [...out] }
}

// ── The lockup word (C3) ────────────────────────────────────────────────────
// A creator-minted link IS a posted CALL — the thing a KOL shares — and a
// house link stays the neutral "Intent link". The word shipped on the
// unbranded splash only: a WHITE-LABELED creator page kept its brand lockup
// and silently dropped the framing, and the in-chat header said "intent
// link" on every link forever (found live 2026-08-03 against prod, on a
// branded creator link). One source now, read by every /i surface.

/** The eyebrow word a link's lockup wears. */
export function linkLockupWord(hasCreator: boolean): 'Call' | 'Intent link' {
  return hasCreator ? 'Call' : 'Intent link'
}

/** …with the attribution suffix: a call is posted BY its author, a neutral
 *  link merely comes FROM one. Empty agent → the bare word. */
export function linkLockup(hasCreator: boolean, agent?: string | null): string {
  const word = linkLockupWord(hasCreator)
  const who = (agent ?? '').trim()
  if (!who) return word
  return `${word} · ${hasCreator ? 'by' : 'from'} ${who}`
}
