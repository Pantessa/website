import { NextRequest, NextResponse } from 'next/server'
import { alchemyEnabled, getMultichainPortfolio } from '@/lib/alchemy'
import { MOSAIC_CHAIN_LABELS, mosaicValueRows, suggestMosaicShape, type MosaicChainWord } from '@/lib/mosaic'

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

/** 120s per-address cache (the /w briefing precedent) — an unauthenticated
 *  read must not be a free lever on the shared Alchemy key. Small and
 *  process-local: correctness is unaffected (suggestions are display math). */
const READ_TTL_MS = 120_000
const READ_CACHE_MAX = 500
const readCache = new Map<string, { at: number; body: unknown }>()

const CHAIN_WORDS: MosaicChainWord[] = ['base', 'ethereum', 'arbitrum', 'robinhood']
/** Alchemy HoldingRow.chain label → mosaic chain word. Robinhood Chain rows
 *  count too (stock tiles are live) — though Alchemy prices little there,
 *  so a 4663 wallet rarely dominates a priced suggestion; honest, not a
 *  gap: the sign-side plan is what actually prices the shape. */
const WORD_BY_LABEL = new Map<string, MosaicChainWord>(
  CHAIN_WORDS.map((w) => [MOSAIC_CHAIN_LABELS[w], w]),
)

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'address must be a 0x-prefixed 40-hex wallet address.' }, { status: 400 })
  }

  if (!alchemyEnabled()) {
    return NextResponse.json({ error: 'The portfolio read is not configured on this deploy.' }, { status: 503 })
  }

  const cacheKey = address.toLowerCase()
  const hit = readCache.get(cacheKey)
  if (hit && Date.now() - hit.at < READ_TTL_MS) {
    return NextResponse.json(hit.body)
  }

  const portfolio = await getMultichainPortfolio(address).catch(() => null)
  if (!portfolio) {
    return NextResponse.json({ error: "Couldn't read that wallet just now — try again in a minute." }, { status: 503 })
  }

  // Priced rows per chain (duplicate symbols SUM — a value read, not a
  // plan); the dominant chain by priced USD wins, strict > keeping the
  // tie/empty default on Base (the house default chain everywhere else).
  const rowsByChain = new Map<MosaicChainWord, ReturnType<typeof mosaicValueRows>>(
    CHAIN_WORDS.map((w) => [w, mosaicValueRows(portfolio.holdings.filter((h) => h.chain && WORD_BY_LABEL.get(h.chain) === w))]),
  )
  const chainUsd = (w: MosaicChainWord) => rowsByChain.get(w)!.reduce((a, r) => a + r.usd, 0)
  const chain = CHAIN_WORDS.reduce((best, w) => (chainUsd(w) > chainUsd(best) ? w : best), 'base' as MosaicChainWord)

  // The shape rules live in lib/mosaic (suggestMosaicShape) — shared with
  // the wallet page's "Rebalance for me" door, so both read the same wallet
  // into the same starting tiles. Nothing priced = an honest empty, never a
  // fabricated 100%-stable shape for a wallet we can't see into.
  const { slices, holdings, totalUsd } = suggestMosaicShape(rowsByChain.get(chain)!, chain)

  const body = { chain, totalUsd, slices, holdings }
  readCache.set(cacheKey, { at: Date.now(), body })
  if (readCache.size > READ_CACHE_MAX) {
    const oldest = readCache.keys().next().value
    if (oldest) readCache.delete(oldest)
  }
  return NextResponse.json(body)
}
