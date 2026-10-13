// Every refusal carries a next step (squad polish, 2026-10-13, DEADENDS lane).
//
// The chat route has ~160 return sites that answer a money ask with words and
// nothing to tap: "Aave v4 is live on Ethereum only — say “supply 10 USDC to
// Aave on Ethereum” and I'll prepare it", "Your withdrawable USDC is 4.2 — say
// “withdraw all my USDC”…". The words already NAME the next step; the stranger
// had to retype it. README §A rule 4: a refusal carries a chip that builds,
// named in the refusal's own words. One choke point (the POST wrapper) reads
// the refusal and attaches the chips — no site is edited, no site can forget.
//
// Pure. The order of preference:
//   1. the sentences the refusal itself quotes (“…” or "…") that the native
//      ladder builds — the refusal's own words, verbatim;
//   2. a "Try again" chip when the refusal is transient (a feed that didn't
//      answer) and the ask itself builds;
//   3. the intent net's chips for the ask (lib/intent-rescue) — what the
//      grammar reads out of it;
//   4. the market the ask names: its chart and its lead order (lib/market-read).
// Never the refused sentence itself unless the refusal is transient (a
// permanent refusal re-sent is a loop), never more than three chips.

import type { ClarifyOption } from '@/lib/clarify'
import { rescueIntent } from '@/lib/intent-rescue'
import { chartPairFor, chartSymbolByName, chartableSymbols } from '@/lib/charts'
import { STARTER_CHIPS } from '@/lib/starter-door'
import { marketReadChips } from '@/lib/market-read'

export const NEXT_STEP_MAX = 3
export const NEXT_STEP_QUESTION = 'Try one of these instead?'

/** A refusal that a moment's wait can fix (the feed, the RPC, a rate limit). */
const TRANSIENT_RE = /\b(?:try again|in a moment|right now|just now|didn['’]t answer|couldn['’]t (?:read|reach|load)|rate[- ]limit|timed out|is unavailable)\b/i

/** The quoted sentences in a reply: “curly”, "straight", and **"bold"** quotes. */
export function quotedSentences(reply: string): string[] {
  const out: string[] = []
  for (const m of String(reply ?? '').matchAll(/[“"]([^“”"\n]{4,120})[”"]/g)) {
    const s = m[1].replace(/[.,;:!?…]+$/, '').trim()
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}

/** The first charted symbol the ask names ("ETH", "$TSLA", "apple"). */
export function namedMarket(message: string): string | null {
  for (const raw of String(message ?? '').split(/[^A-Za-z0-9$]+/)) {
    const w = raw.replace(/^\$/, '')
    if (w.length < 2 || w.length > 12) continue
    // Only a word the writer spelled as a ticker (caps or $) or a household
    // name counts — "on", "all", "for" are never a market.
    const ticker = /^[A-Z0-9]{2,12}$/.test(w) || raw.startsWith('$') ? chartPairFor(w)?.symbol : null
    const sym = ticker ?? chartSymbolByName(w)
    if (sym) return sym
  }
  return null
}

/** The token a refusal says it doesn't know (“ZZQX”, **ZZQX** isn't a …). */
export function unknownTokenIn(reply: string): string | null {
  const m = String(reply ?? '').match(/(?:don['’]t know the token|no token called|isn['’]t a token I know)\s+[“"]?\$?([A-Za-z0-9]{2,12})[”"]?|\*\*\$?([A-Za-z0-9]{2,12})\*\*\s+isn['’]t (?:a Hyperliquid perp|listed)/i)
  return m ? (m[1] ?? m[2]).toUpperCase() : null
}

/** One edit away (a typo): AAPLE → AAPL, ETHH → ETH, HYP → HYPE. */
function oneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/** Listed symbols one edit from an unknown token, most familiar first. */
export function nearSymbols(token: string, max = 2): string[] {
  const t = token.toUpperCase()
  if (t.length < 3) return []
  return chartableSymbols().filter((s) => oneEdit(t, s)).slice(0, max)
}

/**
 * The chips for a refusal, or [] when nothing honest fits. `verify` answers
 * "does the native ladder build this sentence?" (the route passes the
 * replica's buildsNatively — the same verify the intent net uses).
 */
export function refusalNextSteps(message: string, reply: string, verify: (ask: string) => boolean, opts: { planner?: boolean } = {}): ClarifyOption[] {
  const ask = String(message ?? '').trim()
  const out: ClarifyOption[] = []
  const seen = new Set<string>([ask.toLowerCase()])
  const push = (label: string, resume: string) => {
    const k = resume.toLowerCase()
    if (out.length >= NEXT_STEP_MAX || seen.has(k)) return
    if (!verify(resume)) return
    seen.add(k)
    out.push({ label, resume })
  }
  // 1. The refusal's own words.
  for (const s of quotedSentences(reply)) push(s.charAt(0).toUpperCase() + s.slice(1), s)
  // 2. A transient refusal: the same ask, once more.
  if (!out.length && TRANSIENT_RE.test(reply) && ask && verify(ask)) out.push({ label: 'Try again', resume: ask })
  // 2b. An unknown token: the same ask with the listed symbol one typo away,
  //     else what works here today (the starter door's chips — the refusal
  //     already says "use a known symbol").
  const unknown = unknownTokenIn(reply)
  if (!out.length && unknown) {
    const re = new RegExp(`\\$?\\b${unknown}\\b`, 'i')
    for (const near of nearSymbols(unknown)) if (re.test(ask)) { const fixed = ask.replace(re, near); push(fixed.charAt(0).toUpperCase() + fixed.slice(1), fixed) }
    if (!out.length) for (const c of STARTER_CHIPS) push(c.label, c.resume)
  }
  // A native layer's refusal knows its domain: a funding shortfall's next
  // step is the funding layer's own (card door / plan), a guard refusal's is
  // nothing. Only the refusal's own words (1) and a retry (2) ride a native
  // wall. The planner's prose is where the grammar and the market help.
  if (!opts.planner) return out
  // 3. What the grammar reads out of the ask.
  if (!out.length) {
    const rescue = rescueIntent(ask, verify)
    for (const c of rescue?.chips ?? []) push(c.label, c.resume)
  }
  // 4. The market the ask names.
  if (!out.length) {
    const sym = namedMarket(ask)
    const pair = sym ? chartPairFor(sym) : null
    if (pair) for (const c of marketReadChips(pair)) push(c.label, c.resume)
  }
  return out
}
