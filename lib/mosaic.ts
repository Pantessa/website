// ─────────────────────────────────────────────────────────────────────────
//  MOSAIC — executable portfolio links (2026-08-11).
//
//  The portfolio pie chart is now a button. An allocation ("tile my wallet
//  50% ETH, 30% USDC, 20% wstETH") is the whole wire format: a creator
//  mints theirs as an intent link, and every wallet that opens it gets the
//  same SENTENCE compiled into a DIFFERENT personalized batch — the
//  deterministic planner diffs the signer's real holdings against the
//  target shape and emits sell legs then buy legs, every one of them a
//  plain-English swap sentence the jobs compiler already accepts. One job,
//  one signature chain, zero new execution surface.
//
//  THE SAFETY CONTRACT (the whole product in one line): percentages in,
//  sentences out. This module never sees an address, never sizes calldata,
//  never touches a builder — it emits leg strings that MUST round-trip
//  lib/jobs.ts (same-chain-swap segments), and the guarded builders rebuild
//  everything fresh at sign time. The harness feeds fabricated wallets
//  through planMosaic and re-parses every emitted leg; a leg that stops
//  compiling is a red build, not a live 404.
//
//  Honesty rules (the funding-plan doctrine, applied to shapes):
//  · Only tokens NAMED in the shape (plus USDC, the settlement rail) are
//    ever touched. Unnamed holdings are left alone and named in the reply —
//    a shape is an instruction, not permission to liquidate a wallet.
//  · Gas keep-back on native ETH is reserved first and said out loud.
//  · Deltas under the tolerance band are skipped BY NAME — moving $3 to
//    chase a percent is gas eating the shape.
//  · Buys get a settlement haircut against sell proceeds, and the copy
//    says "shape, not promise" — prices float between compile and sign.
//
//  Pure module: no RPC, no fetch, no DB. lib/mosaic-exec.ts is the I/O
//  shell (Alchemy portfolio read + token-list validation + job creation),
//  mirroring the rebalance / funding-plan seam.
// ─────────────────────────────────────────────────────────────────────────

import { canonicalChainWord, normalizeChainWords } from './chain-lexicon'

// ── Grammar ─────────────────────────────────────────────────────────────────

export interface MosaicSlice {
  /** Percent of the movable value, 1–100. */
  pct: number
  /** Token symbol, UPPERCASED, alpha-only 2–12 chars (swap-grammar parity). */
  token: string
}

export interface MosaicAsk {
  slices: MosaicSlice[]
  /** Explicit chain word ('base' | 'ethereum' | 'arbitrum'), absent = the
   *  exec shell picks the wallet's dominant chain among the three. */
  chainWord?: MosaicChainWord
}

export type MosaicChainWord = 'base' | 'ethereum' | 'arbitrum' | 'robinhood'

/** The trigger verb. Deliberately disjoint from every other gate: rebalance
 *  wants "rebalance"/"to work", the swap layer wants "swap", DCA wants a
 *  cadence. "tile my wallet" belongs to nobody else. */
// "tile my wallet …" is the canonical verb (mosaicAskString writes it).
// Strangers also say "make/set/split my wallet 60% ETH 40% USDC" (squad
// 2026-08-18 ask inventory — fell to the planner): those synonyms count ONLY
// when a percent tile follows, so "rebalance my portfolio" (no tiles) stays
// the rebalance layer's.
const MOSAIC_TRIGGER_RE =
  /\b(?:(?:re)?tile\s+my\s+(?:wallet|portfolio|bags?)\b|(?:make|set|shape|split|allocate|rebalance)\s+my\s+(?:wallet|portfolio|bags?)\s+(?:to\s+|into\s+|as\s+)?(?=\d+(?:\.\d+)?\s*%))/i

/** "50% eth", "12.5% of WSTETH" — symbol rules mirror the same-chain-swap
 *  segment ([A-Za-z]{2,12}) so a slice that parses here can always become a
 *  leg there. */
const SLICE_RE = /(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?\$?([A-Za-z]{2,12})\b/g

const CHAIN_ON_RE = /\bon\s+([a-z][a-z ]{2,20})\b/i

/** The chain word is only ACCEPTED at the end of the ask (where
 *  mosaicAskString writes it) — harvesting "on ethereum" out of trailing
 *  prose once re-routed a plan to the wrong chain. Mid-sentence chain words
 *  fall back to the dominant-chain pick, which is safe by construction. */
const CHAIN_AT_END_RE = /\bon\s+([a-z]+(?:\s+chain)?)\s*["'.!?]*\s*$/i

/** A tile ask must be ONLY a tile ask. Any other money instruction riding
 *  the same message ("tile …, then send 1 USDC to 0x…") gets a named
 *  refusal — the jobs compiler nulls on the unparseable tile segment, so
 *  without this guard the mosaic gate would claim the turn and SILENTLY
 *  DROP the rest (the #595/#597 partial-match bug, reintroduced). */
const OTHER_MONEY_VERB_RE =
  /\b(?:send|transfer|swap|sell|buy|bridge|stake|unstake|deposit|withdraw|long|short|supply|lend|repay|borrow|protect|list|vote|convert)\b/i

const MOSAIC_CHAINS: Record<string, MosaicChainWord> = {
  base: 'base',
  ethereum: 'ethereum',
  mainnet: 'ethereum',
  arbitrum: 'arbitrum',
  arb: 'arbitrum',
  robinhood: 'robinhood',
  'robinhood chain': 'robinhood',
}

export const MOSAIC_CHAIN_IDS: Record<MosaicChainWord, number> = {
  base: 8453,
  ethereum: 1,
  arbitrum: 42161,
  robinhood: 4663,
}

export const MOSAIC_CHAIN_LABELS: Record<MosaicChainWord, string> = {
  base: 'Base',
  ethereum: 'Ethereum',
  arbitrum: 'Arbitrum',
  robinhood: 'Robinhood Chain',
}

/** The settlement rail: sells land here, buys spend from here. USDC on the
 *  EVM majors, USDG on Robinhood Chain (its native dollar — 6 decimals, but
 *  decimals are the builder's business; the sentence only carries the
 *  word). One rail per chain keeps the conservation math honest. */
export const MOSAIC_STABLE = 'USDC'

export function mosaicStableFor(chainWord: MosaicChainWord): 'USDC' | 'USDG' {
  return chainWord === 'robinhood' ? 'USDG' : 'USDC'
}

const EXAMPLE = 'tile my wallet 50% ETH, 30% USDC, 20% wstETH'

/**
 * Parse a tile ask. Returns null only when the trigger verb is absent —
 * once "tile my wallet" matched, this gate OWNS the turn (the #597
 * partial-match rule) and every malformed shape gets a named problem, never
 * a silent fall to the planner.
 */
export function parseMosaicAsk(message: string): MosaicAsk | { problem: string } | null {
  if (!MOSAIC_TRIGGER_RE.test(message)) return null

  const slices: MosaicSlice[] = []
  const seen = new Set<string>()
  for (const m of message.matchAll(SLICE_RE)) {
    const pct = parseFloat(m[1])
    const token = m[2].toUpperCase()
    if (!Number.isFinite(pct)) continue
    if (pct < 1 || pct > 100) {
      return { problem: `Each tile needs 1–100% — "${m[1]}% ${token}" doesn't fit. Try: "${EXAMPLE}".` }
    }
    if (seen.has(token)) {
      return { problem: `${token} appears twice in the shape — name each tile once.` }
    }
    seen.add(token)
    slices.push({ pct, token })
  }

  if (slices.length === 0) {
    return { problem: `A mosaic is percent tiles — try: "${EXAMPLE}". Slices must sum to 100.` }
  }
  if (slices.length === 1) {
    return {
      problem: `One tile isn't a shape — add at least one more slice (a ${MOSAIC_STABLE} tile is the usual rest): "${EXAMPLE}".`,
    }
  }
  if (slices.length > 8) {
    return { problem: `That's ${slices.length} tiles — keep a shape to 8 or fewer so the batch stays signable.` }
  }
  const sum = slices.reduce((a, s) => a + s.pct, 0)
  if (Math.abs(sum - 100) > 0.5) {
    return { problem: `Your tiles add to ${trimNum(sum)}% — a mosaic covers the whole wall. Make them sum to 100.` }
  }

  const normalized = normalizeChainWords(message)

  // One ask, one shape: refuse any other money instruction riding along —
  // claiming it and dropping the rest would be the silent partial-match bug.
  const withoutSlices = message.replace(new RegExp(SLICE_RE.source, 'g'), ' ')
  if (OTHER_MONEY_VERB_RE.test(withoutSlices)) {
    const verb = withoutSlices.match(OTHER_MONEY_VERB_RE)?.[0]
    return {
      problem: `A mosaic message carries ONE shape and nothing else — the "${verb}" part won't ride along silently. Run the tile first, then send the rest as its own ask.`,
    }
  }

  // Chain word, accepted only at the end (the canonical position).
  let chainWord: MosaicChainWord | undefined
  const end = normalized.match(CHAIN_AT_END_RE)
  if (end) {
    const canon = canonicalChainWord(end[1].toLowerCase()) ?? end[1].toLowerCase()
    chainWord = MOSAIC_CHAINS[canon]
  }

  return { slices, chainWord }
}

/** The canonical ask string for a shape — MUST round-trip parseMosaicAsk
 *  (harness-pinned). This is the string mints, forks, and the agent door
 *  all write. */
export function mosaicAskString(slices: MosaicSlice[], chainWord?: MosaicChainWord): string {
  const tiles = slices.map((s) => `${trimNum(s.pct)}% ${s.token.toUpperCase()}`).join(', ')
  return `tile my wallet ${tiles}${chainWord ? ` on ${chainWord}` : ''}`
}

/** Does an intent-link ask carry the tile grammar? (Used to stamp
 *  kind:'mosaic' at mint and to pick the tessera OG card.) */
export function isMosaicAsk(ask: string): boolean {
  const parsed = parseMosaicAsk(ask)
  return parsed != null && !('problem' in parsed)
}

/** Structured slices from an untrusted caller (the mint API, the agent
 *  desk) → grammar-shaped slices, or a named problem. Pcts round to the
 *  2dp the sentence will carry so composeMosaicAsk's equality belt can be
 *  exact; token symbols must already be the swap-grammar alphabet so a
 *  "token" can't smuggle words into the composed sentence. */
export function sanitizeMosaicSlices(raw: unknown): MosaicSlice[] | { problem: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { problem: 'slices must be a non-empty array of { pct, token }.' }
  }
  const out: MosaicSlice[] = []
  for (const item of raw) {
    const s = item as { pct?: unknown; token?: unknown }
    const pct = typeof s?.pct === 'number' && Number.isFinite(s.pct) ? Math.round(s.pct * 100) / 100 : null
    const token = typeof s?.token === 'string' ? s.token.trim().toUpperCase() : ''
    if (pct == null) return { problem: 'Every slice needs a numeric pct.' }
    if (!/^[A-Za-z]{2,12}$/.test(token)) {
      return { problem: `"${String(s?.token ?? '')}" isn't a tile symbol — letters only, 2–12 characters (the swap-grammar rule).` }
    }
    out.push({ pct, token })
  }
  return out
}

/** Compose the canonical sentence AND prove it: re-parse, run the grammar's
 *  own rulebook (sum-to-100, tile counts, dupes, Robinhood refusal), and
 *  belt-check that the sentence carries back EXACTLY the tiles and chain it
 *  was given — a stored link must never execute a different shape than the
 *  caller approved. One rulebook for every mint door. */
export function composeMosaicAsk(
  slices: MosaicSlice[],
  chainWord?: MosaicChainWord,
): { ask: string } | { problem: string } {
  const ask = mosaicAskString(slices, chainWord)
  const parsed = parseMosaicAsk(ask)
  if (!parsed) {
    return { problem: 'The composed ask lost its own trigger — this is a bug worth reporting, nothing was minted.' }
  }
  if ('problem' in parsed) return { problem: parsed.problem }
  const roundTrips =
    parsed.slices.length === slices.length &&
    parsed.slices.every((s, i) => s.token === slices[i].token && s.pct === slices[i].pct) &&
    (parsed.chainWord ?? undefined) === chainWord
  if (!roundTrips) {
    return { problem: 'The shape did not survive its own round-trip — nothing was minted. Check each token symbol and pct.' }
  }
  return { ask }
}

// ── The planner ─────────────────────────────────────────────────────────────

export interface MosaicHolding {
  /** UPPERCASE symbol as the portfolio read reports it. */
  symbol: string
  /** Human units (not atoms). */
  balance: number
  priceUsd: number | null
  valueUsd: number | null
  native?: boolean
}

export interface MosaicPlanInputs {
  slices: MosaicSlice[]
  chainWord: MosaicChainWord
  /** CHAIN-SCOPED holdings (the exec shell filters the multichain read). */
  holdings: MosaicHolding[]
  /** Value of shape-named tokens sitting on OTHER chains — named, untouched. */
  offChainNamedUsd?: number
}

export interface MosaicRow {
  token: string
  pct: number
  heldUsd: number
  targetUsd: number
  deltaUsd: number
  action: 'buy' | 'sell' | 'hold' | 'skip'
}

export type MosaicPlan =
  | {
      kind: 'plan'
      legs: string[]
      rows: MosaicRow[]
      movableUsd: number
      totalMoveUsd: number
      notes: string[]
    }
  | { kind: 'quiet'; rows: MosaicRow[]; movableUsd: number; notes: string[] }
  | { kind: 'problem'; problem: string }

/** Native-ETH keep-back so a tile never strands the wallet gasless (the
 *  #446 floors; kept local because funding-plan's reserve map is private —
 *  keep the two in sync). */
export const MOSAIC_GAS_RESERVE_ETH: Record<MosaicChainWord, number> = {
  ethereum: 0.002,
  base: 0.0002,
  arbitrum: 0.0002,
  robinhood: 0.0002,
}

/** Buys are shaved 0.5% against sell proceeds — solver fees and price float
 *  between compile and sign mean proceeds land slightly under the estimate,
 *  and a buy leg that dies a few cents short strands the shape mid-batch. */
const SETTLEMENT_HAIRCUT = 0.995

/**
 * The pure planner: chain-scoped holdings + a shape in → sell legs then buy
 * legs out (or an honest quiet). Every leg is a same-chain-swap sentence;
 * the caller compiles the joined legs through lib/jobs.ts and refuses if
 * anything fails to round-trip.
 */
export function planMosaic(inputs: MosaicPlanInputs): MosaicPlan {
  const { slices, chainWord, holdings } = inputs
  const chainLabel = MOSAIC_CHAIN_LABELS[chainWord]
  const stable = mosaicStableFor(chainWord)
  const notes: string[] = []

  const bySymbol = new Map<string, MosaicHolding>()
  for (const h of holdings) {
    const key = h.symbol.toUpperCase()
    const prev = bySymbol.get(key)
    // Duplicate symbols on one chain (rare Alchemy artifact) — keep the
    // richer row; planning on a phantom duplicate would double-count.
    if (!prev || (h.valueUsd ?? 0) > (prev.valueUsd ?? 0)) bySymbol.set(key, h)
  }

  const named = new Set(slices.map((s) => s.token))
  const railInShape = named.has(stable)

  // Movable = named tiles + the stable rail. Nothing else is ever touched.
  let movableUsd = 0
  const heldUsdOf = new Map<string, number>()
  const unpriced: string[] = []
  for (const token of [...named, stable]) {
    if (heldUsdOf.has(token)) continue
    const h = bySymbol.get(token)
    if (!h) {
      heldUsdOf.set(token, 0)
      continue
    }
    if (h.valueUsd == null || h.priceUsd == null) {
      // Held but unpriced — we cannot size a sell for it. Fail closed by
      // name rather than planning around a number we don't have.
      if (token !== stable) unpriced.push(token)
      heldUsdOf.set(token, 0)
      continue
    }
    let usd = h.valueUsd
    if (h.native && token === 'ETH') {
      const reserve = MOSAIC_GAS_RESERVE_ETH[chainWord]
      const movableUnits = Math.max(0, h.balance - reserve)
      usd = movableUnits * h.priceUsd
      notes.push(`${fmtUnits(reserve)} ETH stays back for gas on ${chainLabel} — a tile never strands the wallet.`)
    }
    heldUsdOf.set(token, round2(usd))
    movableUsd += usd
  }
  movableUsd = round2(movableUsd)

  if (unpriced.length > 0) {
    return {
      kind: 'problem',
      problem: `I can't price ${unpriced.join(', ')} on ${chainLabel} right now, so I won't size a move against ${unpriced.length > 1 ? 'them' : 'it'} — try again in a minute or drop ${unpriced.length > 1 ? 'those tiles' : 'that tile'}.`,
    }
  }

  if (movableUsd < 10) {
    return {
      kind: 'problem',
      problem: `Nothing to tile on ${chainLabel} — the shape's tokens (plus ${stable}) come to $${movableUsd.toFixed(2)} there. A mosaic needs at least $10 of movable value in its own tiles.`,
    }
  }

  if (inputs.offChainNamedUsd && inputs.offChainNamedUsd > 1) {
    notes.push(
      `$${inputs.offChainNamedUsd.toFixed(2)} of shape tokens sits on other chains and stays put — v1 tiles one chain at a time.`,
    )
  }

  const untouchedUsd = round2(
    holdings.reduce((a, h) => {
      const key = h.symbol.toUpperCase()
      if (named.has(key) || key === stable) return a
      return a + (h.valueUsd ?? 0)
    }, 0),
  )
  if (untouchedUsd >= 1) {
    notes.push(`$${untouchedUsd.toFixed(2)} in tokens outside the shape stays exactly where it is — named tiles only.`)
  }

  // Targets and deltas. The stable rail's target is its named slice (or 0
  // when unnamed — every unnamed-stable dollar is fuel for the buys).
  const band = Math.max(5, movableUsd * 0.02)
  const rows: MosaicRow[] = []
  const sells: { token: string; usd: number }[] = []
  const buys: { token: string; usd: number }[] = []

  const shape: MosaicSlice[] = railInShape ? slices : [...slices, { pct: 0, token: stable }]
  for (const s of shape) {
    const heldUsd = heldUsdOf.get(s.token) ?? 0
    const targetUsd = round2((s.pct / 100) * movableUsd)
    const deltaUsd = round2(targetUsd - heldUsd)
    let action: MosaicRow['action'] = 'hold'
    if (s.token !== stable) {
      if (deltaUsd > band) {
        action = 'buy'
        buys.push({ token: s.token, usd: deltaUsd })
      } else if (deltaUsd < -band) {
        action = 'sell'
        sells.push({ token: s.token, usd: -deltaUsd })
      } else if (Math.abs(deltaUsd) > 0.5) {
        action = 'skip'
      }
    }
    rows.push({ token: s.token, pct: s.pct, heldUsd, targetUsd, deltaUsd, action })
  }

  const skipped = rows.filter((r) => r.action === 'skip')
  if (skipped.length > 0) {
    notes.push(
      `${skipped.map((r) => `${r.token} (${fmtSignedUsd(r.deltaUsd)})`).join(', ')} within the $${trimNum(round2(band))} band — moving that little is gas eating the shape.`,
    )
  }

  if (sells.length === 0 && buys.length === 0) {
    return { kind: 'quiet', rows, movableUsd, notes }
  }

  // Conservation with a haircut: buys can only spend held stable plus
  // shaved sell proceeds. Scale down proportionally when short and say so.
  const stableFuel = (heldUsdOf.get(stable) ?? 0) + sells.reduce((a, s) => a + s.usd, 0) * SETTLEMENT_HAIRCUT
  const totalBuys = buys.reduce((a, b) => a + b.usd, 0)
  if (totalBuys > stableFuel && totalBuys > 0) {
    const scale = Math.max(0, stableFuel / totalBuys)
    for (const b of buys) b.usd = round2(b.usd * scale)
    // The table must show what the legs will actually do — scaled sizes,
    // not the pre-scale wish.
    for (const r of rows) {
      if (r.action !== 'buy') continue
      const b = buys.find((x) => x.token === r.token)
      if (b) r.deltaUsd = b.usd
    }
    notes.push('Buys are sized to the sell proceeds with 0.5% settlement headroom — a shape, not a promise.')
  }

  sells.sort((a, b) => b.usd - a.usd)
  buys.sort((a, b) => b.usd - a.usd)

  const legs: string[] = []
  for (const s of sells) {
    const h = bySymbol.get(s.token)
    if (!h || h.priceUsd == null || h.priceUsd <= 0) continue // unpriced already refused above
    const heldUsd = heldUsdOf.get(s.token) ?? 0
    // Selling ~everything: use the full movable balance so no dust row
    // survives a "0% of this" tile.
    const sellAll = s.usd >= heldUsd * 0.995
    const reserve = h.native && s.token === 'ETH' ? MOSAIC_GAS_RESERVE_ETH[chainWord] : 0
    const units = sellAll ? Math.max(0, h.balance - reserve) : s.usd / h.priceUsd
    const amount = fmtUnits(units)
    if (parseFloat(amount) <= 0) continue
    legs.push(`swap ${amount} ${s.token} for ${stable} on ${chainWord}`)
  }
  for (const b of buys) {
    if (b.usd < 1) continue
    legs.push(`swap ${b.usd.toFixed(2)} ${stable} for ${b.token} on ${chainWord}`)
  }

  if (legs.length === 0) {
    return { kind: 'quiet', rows, movableUsd, notes }
  }

  const totalMoveUsd = round2(sells.reduce((a, s) => a + s.usd, 0) + buys.reduce((a, b) => a + b.usd, 0))
  return { kind: 'plan', legs, rows, movableUsd, totalMoveUsd, notes }
}


// ── Shapes FROM holdings ────────────────────────────────────────────────────
//
// Two readers of one wallet: the read route (/api/mosaics/read — the studio's
// "Read my allocation") and the wallet page's "Rebalance for me" door
// (components/WalletRebalance), which already holds the priced rows. Same
// rules in one place so the two can never suggest different shapes for the
// same wallet.

export interface MosaicValueRow {
  /** UPPERCASE symbol. */
  token: string
  usd: number
}

export interface MosaicShapeSuggestion {
  slices: MosaicSlice[]
  /** Every priced row on the chain, richest first (the read-out line). */
  holdings: MosaicValueRow[]
  totalUsd: number
}

/** Slice-able symbol — mirrors the grammar's token rule so every suggested
 *  tile is a tile the parser will accept back. */
const TILE_SYMBOL_RE = /^[A-Za-z]{2,12}$/

/**
 * Largest-remainder rounding: USD weights in, integer pcts summing to
 * EXACTLY 100 out. Plain per-slice rounding drifts (99 or 101), and a shape
 * that doesn't sum to 100 refuses at the grammar — a suggestion must always
 * be mintable as-is. `step` snaps to a coarser grid (5 = the 5% grid the
 * "choose for me" shape wears).
 */
export function integerPcts(usd: number[], step = 1): number[] {
  const total = usd.reduce((a, b) => a + b, 0)
  if (total <= 0) return usd.map(() => 0)
  const units = 100 / step
  const raw = usd.map((u) => (u / total) * units)
  const pcts = raw.map(Math.floor)
  let left = units - pcts.reduce((a, b) => a + b, 0)
  const byFrac = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)
  for (const { i } of byFrac) {
    if (left <= 0) break
    pcts[i] += 1
    left -= 1
  }
  return pcts.map((p) => p * step)
}

/** Sum duplicate symbols (a rare index artifact) — a value read must not
 *  silently drop half a holding. Richest first. */
export function mosaicValueRows(rows: { symbol: string; valueUsd: number | null }[]): MosaicValueRow[] {
  const by = new Map<string, number>()
  for (const r of rows) {
    if (r.valueUsd == null || r.valueUsd <= 0) continue
    const sym = r.symbol.toUpperCase()
    by.set(sym, (by.get(sym) ?? 0) + r.valueUsd)
  }
  return [...by.entries()].map(([token, usd]) => ({ token, usd: round2(usd) })).sort((a, b) => b.usd - a.usd)
}

/**
 * "Here's the shape you already hold." Tile candidates: ≥3% of the chain
 * total AND a symbol the grammar takes back, top 7 by value. Everything
 * else — dust, the 8th token on, exotic symbols the swap grammar can't
 * carry — folds into the stable rail, so the shape always covers 100% of
 * what was read. A single-token wallet gets a small rail carved out (the
 * grammar refuses one-tile shapes; a starting point to edit, not a claim
 * about what's held); a wallet that IS the stable has nothing to tile.
 */
export function suggestMosaicShape(rows: MosaicValueRow[], chainWord: MosaicChainWord): MosaicShapeSuggestion {
  const stable = mosaicStableFor(chainWord)
  const holdings = [...rows].sort((a, b) => b.usd - a.usd)
  const totalUsd = round2(holdings.reduce((a, r) => a + r.usd, 0))
  if (totalUsd <= 0) return { slices: [], holdings, totalUsd: 0 }

  const candidates = holdings.filter((r) => r.usd >= totalUsd * 0.03 && TILE_SYMBOL_RE.test(r.token)).slice(0, 7)
  const entries: MosaicValueRow[] = candidates.map((r) => ({ ...r }))
  const pickedUsd = entries.reduce((a, e) => a + e.usd, 0)
  const remainderUsd = totalUsd - pickedUsd
  if (remainderUsd > 0) {
    const rail = entries.find((e) => e.token === stable)
    if (rail) rail.usd += remainderUsd
    else entries.push({ token: stable, usd: remainderUsd })
  }

  // A 0% tile can only be a dust-sized stable rail (candidates are ≥3% by
  // construction) — fold it into the largest tile and re-round, because the
  // grammar refuses sub-1% slices.
  let pcts = integerPcts(entries.map((e) => e.usd))
  while (entries.length > 1 && pcts.some((p) => p === 0)) {
    const drop = pcts.findIndex((p) => p === 0)
    const [dropped] = entries.splice(drop, 1)
    entries.reduce((best, e) => (e.usd > best.usd ? e : best), entries[0]).usd += dropped.usd
    pcts = integerPcts(entries.map((e) => e.usd))
  }

  let slices = entries.map((e, i) => ({ pct: pcts[i], token: e.token }))
  if (slices.length === 1) {
    slices =
      slices[0].token === stable || slices[0].pct < 6
        ? []
        : [{ pct: slices[0].pct - 5, token: slices[0].token }, { pct: 5, token: stable }]
  }
  return { slices, holdings, totalUsd }
}

/** "Choose for me" rulebook, in the order it applies. Deterministic on
 *  purpose — no model picks a portfolio here; the wallet's own holdings
 *  do, tidied by rules the page can print. */
export const CHOOSE_SHAPE_RULES = {
  maxTiles: 4,
  stepPct: 5,
  railFloorPct: 10,
  tileFloorPct: 5,
  tileCapPct: 70,
} as const

/**
 * "Choose for me": what you hold, tidied. Keep the (up to) four biggest
 * tile-able tokens, fold the rest into the stable rail, snap to the 5%
 * grid, keep at least 10% in the rail as dry powder, no single tile above
 * 70% (the excess flows to the rail), every kept tile at least 5%. Empty
 * when nothing volatile is worth a tile (all stable, or all dust) — the
 * caller offers a preset instead. The result always round-trips
 * composeMosaicAsk (harness-pinned).
 */
export function chooseMosaicShape(rows: MosaicValueRow[], chainWord: MosaicChainWord): { slices: MosaicSlice[]; notes: string[] } {
  const R = CHOOSE_SHAPE_RULES
  const stable = mosaicStableFor(chainWord)
  const total = rows.reduce((a, r) => a + r.usd, 0)
  const notes: string[] = []
  if (total <= 0) return { slices: [], notes: ['Nothing priced here to shape.'] }

  const volatile = [...rows]
    .filter((r) => r.token !== stable && r.usd >= total * 0.03 && TILE_SYMBOL_RE.test(r.token))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, R.maxTiles)
  if (volatile.length === 0) return { slices: [], notes: [`Everything here is ${stable} or dust — pick a preset to shape it.`] }

  const folded = rows.filter((r) => !volatile.includes(r) && r.token !== stable && r.usd > 0)
  if (folded.length > 0) notes.push(`${folded.map((r) => r.token).join(', ')} fold${folded.length > 1 ? '' : 's'} into the ${stable} rail (under 3%, or past the ${R.maxTiles}-tile limit).`)

  // Weights in percent: floors, the concentration cap, then the rail takes
  // the slack (dry powder) — or, when the floors overflow, tiles scale down.
  let w = volatile.map((r) => Math.min(Math.max((r.usd / total) * 100, R.tileFloorPct), R.tileCapPct))
  const capped = volatile.filter((r, i) => (r.usd / total) * 100 > R.tileCapPct && w[i] === R.tileCapPct)
  if (capped.length > 0) notes.push(`${capped.map((r) => r.token).join(', ')} capped at ${R.tileCapPct}% — the rest is dry powder.`)
  let rail = 100 - w.reduce((a, b) => a + b, 0)
  if (rail < R.railFloorPct) {
    const scale = (100 - R.railFloorPct) / w.reduce((a, b) => a + b, 0)
    w = w.map((x) => Math.max(R.tileFloorPct, x * scale))
    rail = Math.max(R.railFloorPct, 100 - w.reduce((a, b) => a + b, 0))
  }
  notes.push(`At least ${R.railFloorPct}% stays in ${stable}; tiles snap to ${R.stepPct}% steps.`)

  // Snap to the grid with the rail's floor and every tile's floor held.
  const pcts = integerPcts([...w, rail], R.stepPct)
  const railIdx = pcts.length - 1
  const lift = (i: number, min: number) => {
    while (pcts[i] < min) {
      const j = pcts.map((p, k) => ({ p, k })).filter(({ k }) => k !== i && k !== railIdx && pcts[k] > R.tileFloorPct).sort((a, b) => b.p - a.p)[0]
      const donor = j ? j.k : pcts[railIdx] > R.railFloorPct ? railIdx : -1
      if (donor < 0) break
      pcts[donor] -= R.stepPct
      pcts[i] += R.stepPct
    }
  }
  lift(railIdx, R.railFloorPct)
  for (let i = 0; i < railIdx; i++) lift(i, R.tileFloorPct)

  const slices: MosaicSlice[] = volatile.map((r, i) => ({ pct: pcts[i], token: r.token }))
  slices.push({ pct: pcts[railIdx], token: stable })
  return { slices: slices.filter((s) => s.pct > 0), notes }
}

/** Hand-picked starting shapes for a wallet with nothing volatile to tidy
 *  (or a fresh mind). EVM majors only — a Robinhood Chain shape is stocks,
 *  and we don't pick anyone's stocks. */
export function mosaicPresets(chainWord: MosaicChainWord): { label: string; slices: MosaicSlice[] }[] {
  if (chainWord === 'robinhood') return []
  const stable = mosaicStableFor(chainWord)
  return [
    { label: 'Balanced', slices: [{ pct: 60, token: 'ETH' }, { pct: 40, token: stable }] },
    { label: 'Mostly ETH', slices: [{ pct: 80, token: 'ETH' }, { pct: 20, token: stable }] },
    { label: 'Dry powder', slices: [{ pct: 30, token: 'ETH' }, { pct: 70, token: stable }] },
  ]
}

// ── Formatting (grammar-safe numbers) ───────────────────────────────────────

/** Token amounts for leg sentences: plain decimals only — the swap-segment
 *  grammar is \d+(\.\d+)? so no commas, no exponents, no trailing dot. */
export function fmtUnits(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  // Meme-token balances can exceed 1e21 units, where String()/toFixed both
  // fall into exponent form and the leg would fail its own compile check —
  // BigInt keeps plain digits (sub-unit dust is noise at this magnitude).
  if (n >= 1e15) return BigInt(Math.floor(n)).toString()
  if (n >= 1000) return String(Math.round(n * 100) / 100)
  // 6 significant-ish decimals, never exponent form.
  const s = n.toFixed(Math.max(0, 6 - Math.max(0, Math.floor(Math.log10(n)) + 1)))
  return s.replace(/\.?0+$/, '') || '0'
}

function trimNum(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function fmtSignedUsd(n: number): string {
  const sign = n >= 0 ? '+' : '−'
  return `${sign}$${Math.abs(n).toFixed(2)}`
}
