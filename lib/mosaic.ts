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

export type MosaicChainWord = 'base' | 'ethereum' | 'arbitrum'

/** The trigger verb. Deliberately disjoint from every other gate: rebalance
 *  wants "rebalance"/"to work", the swap layer wants "swap", DCA wants a
 *  cadence. "tile my wallet" belongs to nobody else. */
const MOSAIC_TRIGGER_RE = /\b(?:re)?tile\s+my\s+(?:wallet|portfolio|bags?)\b/i

/** "50% eth", "12.5% of WSTETH" — symbol rules mirror the same-chain-swap
 *  segment ([A-Za-z]{2,12}) so a slice that parses here can always become a
 *  leg there. */
const SLICE_RE = /(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?\$?([A-Za-z]{2,12})\b/g

const CHAIN_ON_RE = /\bon\s+([a-z][a-z ]{2,20})\b/i

/** The chain word is only ACCEPTED at the end of the ask (where
 *  mosaicAskString writes it) — harvesting "on ethereum" out of trailing
 *  prose once re-routed a plan to the wrong chain. Mid-sentence chain words
 *  fall back to the dominant-chain pick, which is safe by construction. */
const CHAIN_AT_END_RE = /\bon\s+([a-z]+)\s*["'.!?]*\s*$/i

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
}

export const MOSAIC_CHAIN_IDS: Record<MosaicChainWord, number> = {
  base: 8453,
  ethereum: 1,
  arbitrum: 42161,
}

export const MOSAIC_CHAIN_LABELS: Record<MosaicChainWord, string> = {
  base: 'Base',
  ethereum: 'Ethereum',
  arbitrum: 'Arbitrum',
}

/** The settlement rail: sells land here, buys spend from here. USDC on all
 *  three v1 chains. Not configurable per-ask by design — one rail keeps the
 *  conservation math honest. */
export const MOSAIC_STABLE = 'USDC'

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

  // Robinhood named ANYWHERE is a refusal, not a silent drop — stock tiling
  // is queued, not built. (Scanned everywhere on purpose: the refusal must
  // fire even when the chain word sits mid-sentence.)
  const normalized = normalizeChainWords(message)
  for (const m of normalized.matchAll(new RegExp(CHAIN_ON_RE.source, 'gi'))) {
    const raw = m[1].toLowerCase().trim()
    const canon = canonicalChainWord(raw) ?? raw
    if (/^robinhood/.test(canon) || /^robinhood/.test(canon.split(' ')[0])) {
      return {
        problem:
          'Tiling runs on Base, Ethereum, or Arbitrum for now — tokenized-stock tiles on Robinhood Chain are queued, not built. Name one of the three or leave the chain out.',
      }
    }
  }

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
  const railInShape = named.has(MOSAIC_STABLE)

  // Movable = named tiles + the stable rail. Nothing else is ever touched.
  let movableUsd = 0
  const heldUsdOf = new Map<string, number>()
  const unpriced: string[] = []
  for (const token of [...named, MOSAIC_STABLE]) {
    if (heldUsdOf.has(token)) continue
    const h = bySymbol.get(token)
    if (!h) {
      heldUsdOf.set(token, 0)
      continue
    }
    if (h.valueUsd == null || h.priceUsd == null) {
      // Held but unpriced — we cannot size a sell for it. Fail closed by
      // name rather than planning around a number we don't have.
      if (token !== MOSAIC_STABLE) unpriced.push(token)
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
      problem: `Nothing to tile on ${chainLabel} — the shape's tokens (plus ${MOSAIC_STABLE}) come to $${movableUsd.toFixed(2)} there. A mosaic needs at least $10 of movable value in its own tiles.`,
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
      if (named.has(key) || key === MOSAIC_STABLE) return a
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

  const shape: MosaicSlice[] = railInShape ? slices : [...slices, { pct: 0, token: MOSAIC_STABLE }]
  for (const s of shape) {
    const heldUsd = heldUsdOf.get(s.token) ?? 0
    const targetUsd = round2((s.pct / 100) * movableUsd)
    const deltaUsd = round2(targetUsd - heldUsd)
    let action: MosaicRow['action'] = 'hold'
    if (s.token !== MOSAIC_STABLE) {
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
  const stableFuel = (heldUsdOf.get(MOSAIC_STABLE) ?? 0) + sells.reduce((a, s) => a + s.usd, 0) * SETTLEMENT_HAIRCUT
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
    legs.push(`swap ${amount} ${s.token} for ${MOSAIC_STABLE} on ${chainWord}`)
  }
  for (const b of buys) {
    if (b.usd < 1) continue
    legs.push(`swap ${b.usd.toFixed(2)} ${MOSAIC_STABLE} for ${b.token} on ${chainWord}`)
  }

  if (legs.length === 0) {
    return { kind: 'quiet', rows, movableUsd, notes }
  }

  const totalMoveUsd = round2(sells.reduce((a, s) => a + s.usd, 0) + buys.reduce((a, b) => a + b.usd, 0))
  return { kind: 'plan', legs, rows, movableUsd, totalMoveUsd, notes }
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
