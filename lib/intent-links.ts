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
 *  cards + reads into the runtime so the build has its context. */
export function composeMcps(ask: string): string[] {
  const a = ask.toLowerCase()
  const slugs: string[] = []
  if (/\b(aapl|tsla|nvda|amd|msft|amzn|meta|googl?|stock|stocks|share of|robinhood)\b/.test(a)) slugs.push('robinhood-free')
  if (/\b(perp|position|long|short|leverage|hyperliquid|stop[- ]?loss|take[- ]?profit)\b/.test(a)) slugs.push('hyperliquid-free')
  if (/\b(nft|opensea|seaport|floor|collection)\b/.test(a)) slugs.push('opensea-free')
  if (/\b(stake|steth|wsteth|lido)\b/.test(a)) slugs.push('lido-free')
  if (/\b(supply|borrow|repay|aave|lend)\b/.test(a)) slugs.push('aave')
  if (/\b(vote|proposal|snapshot|dao|governance)\b/.test(a)) slugs.push('snapshot-free')
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

export const EVENT_KINDS = ['open', 'connect', 'built', 'signed'] as const
export type IntentEventKind = (typeof EVENT_KINDS)[number]
