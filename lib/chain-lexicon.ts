// ─────────────────────────────────────────────────────────────────────────
//  Chain lexicon — ONE typo-tolerant vocabulary for chain words in asks.
//
//  Born from a live dead-end (2026-07-22): "swap 1 USDC from base to
//  Etheruem" — the amount, token, and both chains were all in the message,
//  but "Etheruem" matched nothing, so the ask fell out of the cross-chain
//  layer into the same-chain swap gate, which replied "Say the amount and
//  pair…". Five parsers kept their own chain alternations (swap-intent,
//  cross-chain-swap, transfer-exec, dca, jobs) and only arbitrum ever got
//  typo aliases. This module is the single source: curated typo aliases
//  per chain + a conservative fuzzy match for the long tail, both mapping
//  back to the canonical chain word downstream code already expects.
//
//  Fuzzy is deliberately narrow: it only runs on words sitting in a CHAIN
//  SLOT (right after from/to/on/into in an ask a parser already judged
//  swap/transfer-shaped), only on words ≥5 chars, and never on words that
//  are token symbols or everyday English — "a ton of USDC" and "swap ETH"
//  must never read as chains.
// ─────────────────────────────────────────────────────────────────────────

/** Canonical chain word → alias alternations (regex fragments, no anchors).
 *  Canonical words are what downstream maps key on (ORIGIN_CHAIN_IDS,
 *  jobs FUND_CHAINS, chainByKey) — resolve aliases BEFORE lookup. */
const LEXICON: Record<string, string[]> = {
  base: ['base'],
  arbitrum: ['arb(?:itrum|itum|itrium|ritrum|etrum)?'],
  ethereum: ['eth(?:ereum|erium|eruem|erem|reum|erum)', 'eth\\s?mainnet', 'mainnet'],
  optimism: ['optim(?:ism|sim|isim)'],
  polygon: ['pol(?:ygon|gon|igon)', 'matic'],
  bnb: ['bsc', 'bnb(?:\\s?chain)?', 'binance'],
  avalanche: ['avalanch(?:e)?', 'avax'],
  gnosis: ['gnosis', 'xdai'],
  scroll: ['scroll'],
  robinhood: ['robin\\s?hoo?d(?:\\s?chain)?'],
  solana: ['sol(?:ana|ona|ena)'],
  bitcoin: ['bitco(?:in|n|im)'],
}

/** Chains only matched NEXT TO a chain preposition — their bare words are
 *  tokens or English ("a ton of USDC", "sold near the top"). */
const PREP_ONLY: Record<string, string[]> = {
  solana: ['sol'],
  bitcoin: ['btc'],
  near: ['near'],
  ton: ['ton'],
  tron: ['tron'],
  sui: ['sui'],
  optimism: ['op'],
}

const CHAIN_PREP = String.raw`(?:\bon|\bfrom|\bto|\binto)`

/** Alternation of every alias for the given canonical chains (default: all).
 *  Longest-first so "eth mainnet" beats "mainnet". For embedding in grammars
 *  — captures still need canonicalChainWord() before any keyed lookup. */
export function chainAlt(chains?: string[]): string {
  const keys = chains ?? Object.keys(LEXICON)
  const alts = keys.flatMap((k) => LEXICON[k] ?? [])
  return alts.sort((a, b) => b.length - a.length).join('|')
}

const ALIAS_RES: [chain: string, re: RegExp][] = Object.entries(LEXICON).map(([chain, alts]) => [
  chain,
  new RegExp(`\\b(?:${alts.join('|')})\\b`, 'i'),
])
const PREP_RES: [chain: string, re: RegExp][] = Object.entries(PREP_ONLY).map(([chain, alts]) => [
  chain,
  new RegExp(`${CHAIN_PREP}\\s+(?:${alts.join('|')})\\b`, 'i'),
])

/** Words that must never fuzzy-match a chain: token symbols users actually
 *  swap, and everyday words one edit from a chain name. */
const FUZZY_STOP = new Set([
  'based', 'bases', 'basis', 'chase', 'phase', // base
  'scrolls', 'stroll', // scroll
  'polygons', // polygon
  'tether', 'ether', // ethereum-adjacent tokens (ETH the token ≠ the chain)
  'wallet', 'wallets',
])

// Damerau–Levenshtein capped at 2 — small strings, called on single words.
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 2) return 3
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[m][n]
}

/** Full-word exact match against the main lexicon (NOT the prep-only shorts). */
function exactChain(w: string): string | null {
  for (const [chain, re] of ALIAS_RES) if (re.test(w) && w.replace(re, '').trim() === '') return chain
  return null
}

/** Fuzzy match: ≥5 chars, not stoplisted, distance ≤1 — or ≤2 for words ≥8
 *  chars, where a two-typo "etheruem" is still unambiguous. */
function fuzzyChain(w: string): string | null {
  if (w.length < 5 || FUZZY_STOP.has(w)) return null
  const max = w.length >= 8 ? 2 : 1
  let best: string | null = null
  let bestD = max + 1
  for (const chain of Object.keys(LEXICON)) {
    if (Math.abs(chain.length - w.length) > max) continue
    const dist = editDistance(w, chain)
    if (dist < bestD) { bestD = dist; best = chain }
  }
  return bestD <= max ? best : null
}

/**
 * Resolve one word (already located in a chain slot) to its canonical chain.
 * Exact alias first, then the prep-only shorts, then fuzzy. Returns null
 * when the word isn't recognizably a chain.
 */
export function canonicalChainWord(word: string): string | null {
  const w = word.trim().toLowerCase()
  if (!w || /^0x/.test(w)) return null
  const exact = exactChain(w)
  if (exact) return exact
  for (const [chain, alts] of Object.entries(PREP_ONLY)) if (alts.some((a) => new RegExp(`^(?:${a})$`, 'i').test(w))) return chain
  return fuzzyChain(w)
}

// A word in a chain slot: after a chain preposition, or right before
// "chain" ("Robbinhood chain"). The (?!\.) keeps ENS names whole — a
// rewrite inside "polygonn.eth" would corrupt the recipient.
const SLOT_WORD_RE = new RegExp(
  String.raw`((?:\bon|\bfrom|\bto|\binto|\bonto)\s+)([A-Za-z]{2,14})\b(?!\.)|\b([A-Za-z]{2,14})(?=\s+chain\b)`,
  'gi',
)

/**
 * Rewrite typo'd or aliased chain words in CHAIN SLOTS to their canonical
 * spelling ("to Etheruem" → "to ethereum", "Robbinhood chain" → "robinhood
 * chain"), leaving everything else byte-identical. Parsers call this once
 * at entry so their grammars only ever see canonical words — the fix for
 * the whole "one typo falls out of the ladder" class (live 2026-07-22).
 * Prep-only shorts (sol, btc, near, …) are deliberately never rewritten —
 * they double as token symbols.
 */
export function normalizeChainWords(text: string): string {
  return text.replace(SLOT_WORD_RE, (full, prep: string | undefined, w1: string | undefined, w2: string | undefined) => {
    const word = (w1 ?? w2 ?? '').toLowerCase()
    const chain = exactChain(word) ?? fuzzyChain(word)
    if (!chain || chain === word) return full
    return prep ? `${prep}${chain}` : chain
  })
}

/** Display form of a canonical chain word ("robinhood" → "Robinhood Chain"). */
export function prettyChainWord(chain: string): string {
  if (chain === 'robinhood') return 'Robinhood Chain'
  if (chain === 'bnb') return 'BNB Chain'
  return chain.charAt(0).toUpperCase() + chain.slice(1)
}

export interface ChainMention { chain: string; word: string }

/**
 * Every chain the message names — exact aliases anywhere, prep-gated shorts
 * next to from/to/on/into, and fuzzy matches ONLY on the word in a chain
 * slot. Order = detection order, de-duplicated on canonical chain.
 */
export function chainMentions(message: string): ChainMention[] {
  const seen = new Map<string, string>()
  for (const [chain, re] of ALIAS_RES) {
    const m = message.match(re)
    if (m && !seen.has(chain)) seen.set(chain, m[0])
  }
  for (const [chain, re] of PREP_RES) {
    if (re.test(message) && !seen.has(chain)) seen.set(chain, chain)
  }
  // Fuzzy pass: single words in chain slots that exact matching missed.
  const slotRe = new RegExp(`${CHAIN_PREP}\\s+([A-Za-z]{5,14})\\b`, 'gi')
  for (const m of message.matchAll(slotRe)) {
    const chain = canonicalChainWord(m[1])
    if (chain && !seen.has(chain)) seen.set(chain, m[1])
  }
  return [...seen.entries()].map(([chain, word]) => ({ chain, word }))
}

/**
 * The word sitting in a destination chain slot ("to <word>") that ISN'T a
 * recognizable chain — for honest clarifies that name what we didn't get
 * ("I don't recognize “Etheruem” as a chain") instead of re-asking for
 * things the user already typed. Skips words that are part of a token
 * phrase ("to 5 USDC on arbitrum" — USDC isn't in a chain slot).
 */
export function unknownDestinationWord(message: string): string | null {
  const m = message.match(/\bto\s+([A-Za-z]{3,14})\s*[?.!]?\s*$/i)
  if (!m) return null
  return canonicalChainWord(m[1]) ? null : m[1]
}
