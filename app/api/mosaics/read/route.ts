import { NextRequest, NextResponse } from 'next/server'
import { alchemyEnabled, getMultichainPortfolio } from '@/lib/alchemy'
import { MOSAIC_CHAIN_LABELS, MOSAIC_STABLE, type MosaicChainWord } from '@/lib/mosaic'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Read-only allocation suggestion: a wallet address in, "here's the shape
 * you already hold" out — the mint page's starting point, so a creator
 * begins from their REAL allocation instead of a blank form.
 *
 * Public by design: balances of an address are on-chain public data, and
 * this is the same exposure class as the /w/<address> briefing pages —
 * read-only, no session, nothing here can move money or mint anything.
 * The suggestion is display math only; the actual plan is always rebuilt
 * per-wallet by the guarded planner at /i open time.
 */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

const CHAIN_WORDS: MosaicChainWord[] = ['base', 'ethereum', 'arbitrum']
/** Alchemy HoldingRow.chain label → mosaic chain word (Robinhood Chain rows
 *  fall out here on purpose — v1 tiles the three EVM majors only, matching
 *  the grammar's own Robinhood refusal). */
const WORD_BY_LABEL = new Map<string, MosaicChainWord>(
  CHAIN_WORDS.map((w) => [MOSAIC_CHAIN_LABELS[w], w]),
)

/** Slice-able symbol — mirrors the grammar's token rule so every suggested
 *  tile is a tile the parser will accept back. */
const TILE_SYMBOL_RE = /^[A-Za-z]{2,12}$/

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Largest-remainder rounding: USD weights in, integer pcts summing to
 * EXACTLY 100 out. Plain per-slice rounding drifts (99 or 101), and a shape
 * that doesn't sum to 100 refuses at the grammar — the suggestion must
 * always be mintable as-is.
 */
function integerPcts(usd: number[]): number[] {
  const total = usd.reduce((a, b) => a + b, 0)
  const raw = usd.map((u) => (u / total) * 100)
  const pcts = raw.map(Math.floor)
  let left = 100 - pcts.reduce((a, b) => a + b, 0)
  const byFrac = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)
  for (const { i } of byFrac) {
    if (left <= 0) break
    pcts[i] += 1
    left -= 1
  }
  return pcts
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'address must be a 0x-prefixed 40-hex wallet address.' }, { status: 400 })
  }

  if (!alchemyEnabled()) {
    return NextResponse.json({ error: 'The portfolio read is not configured on this deploy.' }, { status: 503 })
  }
  const portfolio = await getMultichainPortfolio(address).catch(() => null)
  if (!portfolio) {
    return NextResponse.json({ error: "Couldn't read that wallet just now — try again in a minute." }, { status: 503 })
  }

  // Priced USD per symbol per chain. Duplicate symbols on one chain (rare
  // Alchemy artifact) SUM here — this is a value read, not a plan, and the
  // suggestion must not silently drop half a holding.
  const byChain = new Map<MosaicChainWord, Map<string, number>>(CHAIN_WORDS.map((w) => [w, new Map()]))
  for (const h of portfolio.holdings) {
    const word = h.chain ? WORD_BY_LABEL.get(h.chain) : undefined
    if (!word) continue
    if (h.valueUsd == null || h.valueUsd <= 0) continue
    const bucket = byChain.get(word)!
    const sym = h.symbol.toUpperCase()
    bucket.set(sym, (bucket.get(sym) ?? 0) + h.valueUsd)
  }

  // Dominant chain by priced USD; strict > keeps the tie/empty default on
  // Base (the house default chain everywhere else).
  const chainUsd = (w: MosaicChainWord) => [...byChain.get(w)!.values()].reduce((a, b) => a + b, 0)
  const chain = CHAIN_WORDS.reduce((best, w) => (chainUsd(w) > chainUsd(best) ? w : best), 'base' as MosaicChainWord)
  const bucket = byChain.get(chain)!
  const totalUsd = chainUsd(chain)

  const holdings = [...bucket.entries()]
    .map(([token, usd]) => ({ token, usd: round2(usd) }))
    .sort((a, b) => b.usd - a.usd)

  if (totalUsd <= 0) {
    // Nothing priced on any of the three chains — an honest empty, never a
    // fabricated 100%-USDC shape for a wallet we can't see into.
    return NextResponse.json({ chain, totalUsd: 0, slices: [], holdings })
  }

  // Tile candidates: ≥3% of the chain total AND a symbol the grammar will
  // take back, top 7 by value. Everything else — dust, the 8th token on,
  // exotic symbols the swap grammar can't carry — folds into the stable
  // rail, so the suggested shape always covers 100% of what was read.
  const candidates = [...bucket.entries()]
    .filter(([sym, usd]) => usd >= totalUsd * 0.03 && TILE_SYMBOL_RE.test(sym))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)

  const entries: { token: string; usd: number }[] = candidates.map(([token, usd]) => ({ token, usd }))
  const pickedUsd = entries.reduce((a, e) => a + e.usd, 0)
  const remainderUsd = totalUsd - pickedUsd
  if (remainderUsd > 0) {
    const rail = entries.find((e) => e.token === MOSAIC_STABLE)
    if (rail) rail.usd += remainderUsd
    else entries.push({ token: MOSAIC_STABLE, usd: remainderUsd })
  }

  // Integer pcts summing to exactly 100. A 0% tile can only be a dust-sized
  // stable rail (candidates are ≥3% by construction) — fold it into the
  // largest tile and re-round, because the grammar refuses sub-1% slices.
  let pcts = integerPcts(entries.map((e) => e.usd))
  while (entries.length > 1 && pcts.some((p) => p === 0)) {
    const drop = pcts.findIndex((p) => p === 0)
    const [dropped] = entries.splice(drop, 1)
    entries.reduce((best, e) => (e.usd > best.usd ? e : best), entries[0]).usd += dropped.usd
    pcts = integerPcts(entries.map((e) => e.usd))
  }

  return NextResponse.json({
    chain,
    totalUsd: round2(totalUsd),
    slices: entries.map((e, i) => ({ pct: pcts[i], token: e.token })),
    holdings,
  })
}
