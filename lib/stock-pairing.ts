// ─────────────────────────────────────────────────────────────────────────
//  Stock name pairing — Robinhood Chain only (the 2026-07-21 "GOOGLe" /
//  "AAPLE" incidents).
//
//  Users ask for stocks by brand ("Google"), partial company name
//  ("Alphabet", "Palantir"), or a near-miss ticker ("AAPLE"). The exact
//  resolution ladder (symbol → exact full name, lib/token-list) misses all
//  three, and on the jobs path the miss surfaced only at RUN time — after
//  the funding legs had already moved real money.
//
//  Policy (Nate-directed): pair the OBVIOUS ones silently (a brand alias or
//  a company name that prefix-matches exactly one listed token) and ASK —
//  clarify chips, BEFORE anything builds or any job step runs — when it
//  looks misspelled ("AAPLE") or matches several names ("Applied"). Never
//  auto-correct a typo on a money surface: a one-letter distance guess is a
//  question, not a rewrite.
//
//  Gated to Robinhood Chain (4663): its dynamic list is the Uniswap-official
//  document alone — 100 curated tokenized stocks, no long-tail impostors to
//  fuzzy-match into. Do NOT point this at Base/Ethereum/Arbitrum, whose
//  Coingecko lists carry look-alike scam names.
// ─────────────────────────────────────────────────────────────────────────

import { dynamicTokensFor, type TokenInfo } from '@/lib/token-list'
import { resolveToken } from '@/lib/cow'
import { ROBINHOOD_CHAIN_ID } from '@/lib/lifi-bridge'

/** Brand words that aren't the listed company name ("Google" is listed as
 *  "Alphabet Class A"). Curated, uppercase, and verified against the live
 *  list before use — an alias whose ticker isn't listed resolves to nothing. */
const BRAND_ALIASES: Record<string, string> = {
  GOOGLE: 'GOOGL',
  ALPHABET: 'GOOGL', // "Alphabet Class A" + prefix match would tie with nothing — pin Class A
  FACEBOOK: 'META',
  SPACEX: 'SPCX', // listed as "Space Exploration Technologies Corp"
}

export type StockPairing =
  /** Resolves as typed (real ticker/name/address) — build as-is. */
  | { kind: 'ok' }
  /** Obvious pairing — rewrite the ask to this ticker and proceed. */
  | { kind: 'paired'; symbol: string; name: string }
  /** Looks misspelled or ambiguous — ask before anything builds. */
  | { kind: 'suggest'; candidates: { symbol: string; name: string }[] }
  /** Nothing close on the list — refuse honestly at parse/compile time. */
  | { kind: 'unknown' }

function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Optimal-string-alignment distance (Levenshtein + adjacent transposition),
 *  early-exited via the band cap — inputs here are ≤ ~30 chars. */
function osaDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) d[i][0] = i
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
}

/**
 * Pair a typed token against Robinhood Chain's listed stocks. Call AFTER
 * ensureTokenList(4663) — an unwarmed list fails OPEN ('ok'), leaving the
 * exact resolution ladder (and its honest refusals) in charge.
 */
export function pairStockToken(input: string, chainId: number): StockPairing {
  if (chainId !== ROBINHOOD_CHAIN_ID) return { kind: 'ok' }
  const raw = input.trim()
  if (!raw) return { kind: 'ok' }
  const tokens = dynamicTokensFor(chainId)
  if (tokens.length === 0) return { kind: 'ok' } // unwarmed — fail open
  // Already resolves (pinned symbol, listed ticker, exact full name, 0x).
  if (resolveToken(raw, chainId)) return { kind: 'ok' }

  const q = norm(raw)
  const label = (t: TokenInfo) => ({ symbol: t.symbol.toUpperCase(), name: t.name ?? t.symbol })
  const bySym = (sym: string) => tokens.find((t) => t.symbol.toUpperCase() === sym)

  // 1. Brand alias — obvious, auto-pair ("GOOGLe" uppercases into GOOGLE).
  const alias = BRAND_ALIASES[q]
  if (alias) {
    const t = bySym(alias)
    if (t) return { kind: 'paired', ...label(t) }
  }

  // 2. Company-name word-prefix ("Palantir" → "Palantir Technologies",
  //    "Rocket Lab" → "Rocket Lab Corporation"). Word-boundary only, query
  //    ≥ 3 chars. Exactly one hit is obvious; several ("Applied" →
  //    Materials/Digital/Optoelectronics) is a question.
  if (q.length >= 3) {
    const hits = tokens.filter((t) => {
      const name = norm(t.name ?? '')
      return name.startsWith(q) && (name.length === q.length || name[q.length] === ' ')
    })
    if (hits.length === 1) return { kind: 'paired', ...label(hits[0]) }
    if (hits.length > 1) return { kind: 'suggest', candidates: hits.slice(0, 3).map(label) }
  }

  // 3. Near-miss ticker or name ("AAPLE", "TESLLA") — NEVER auto-paired.
  //    Distance 1 (2 for longer inputs) against tickers and full names,
  //    closest first. Queries under 4 chars skip fuzzing entirely — with
  //    tickers like F and MU on the list, one edit is half the word.
  if (q.length >= 4) {
    const cap = q.length >= 7 ? 2 : 1
    const scored = tokens
      .map((t) => {
        const dSym = osaDistance(q, t.symbol.toUpperCase(), cap)
        const dName = osaDistance(q, norm(t.name ?? ''), cap)
        return { t, d: Math.min(dSym, dName) }
      })
      .filter((s) => s.d <= cap)
      .sort((a, b) => a.d - b.d)
    if (scored.length > 0) {
      const seen = new Set<string>()
      const candidates = scored
        .filter((s) => !seen.has(s.t.symbol.toUpperCase()) && seen.add(s.t.symbol.toUpperCase()))
        .slice(0, 3)
        .map((s) => label(s.t))
      return { kind: 'suggest', candidates }
    }
  }

  return { kind: 'unknown' }
}

/** "AAPL (Apple)" — the chip label for a suggested pairing. */
export function stockChipLabel(c: { symbol: string; name: string }): string {
  return c.name && c.name.toUpperCase() !== c.symbol ? `${c.symbol} (${c.name})` : c.symbol
}
