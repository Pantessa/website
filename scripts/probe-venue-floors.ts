/**
 * probe:venue-floors — re-measure 1Click's temporary per-chain minimums.
 *
 * Read-only. Sends the EXACT quote body services/near-intents sends
 * (lib/oneclick.ts requestQuote), with `dry: true`, so nothing is committed
 * and no deposit address is ever minted.
 *
 * Run it before trusting lib/venue-floor's table — NEAR's changelog is stale
 * (it lists Optimism and Avalanche, both of which price fine, and says
 * nothing about the destination side, which Polygon and BNB Chain do fence).
 * Exits 2 when the live venue disagrees with the table, so this is safe to
 * wire into a gate.
 *
 *   npm run probe:venue-floors
 */
import { VENUE_FLOORS, floorFor, type FloorSide } from '../lib/venue-floor'

const API = process.env.ONECLICK_API_URL ?? 'https://1click.chaindefuser.com'
const PLACEHOLDER: Record<string, string> = {
  evm: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D',
  sol: '13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK',
  near: 'intents.near',
}
const NON_EVM = new Set(['sol', 'near'])
const addrFor = (b: string) => (NON_EVM.has(b) ? PLACEHOLDER[b] : PLACEHOLDER.evm)

/** 1Click blockchain slug → our canonical chain word. Only the chains we can
 *  build a deposit transaction on, plus the ones a destination can be. */
const SLUG: Record<string, string> = {
  eth: 'ethereum', base: 'base', arb: 'arbitrum', op: 'optimism',
  pol: 'polygon', bsc: 'bnb', avax: 'avalanche', gnosis: 'gnosis', scroll: 'scroll',
  sol: 'solana', near: 'near',
}
/** The size every "is this chain floored?" probe uses — far under any floor
 *  we have seen, and the size a real user actually asks for. */
const PROBE_USD = 20

interface Tok { assetId: string; decimals: number; price: number; symbol: string; blockchain: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function quote(origin: Tok, dest: Tok, usd: number): Promise<{ ok: boolean; message: string }> {
  const amount = BigInt(Math.round((usd / origin.price) * 10 ** origin.decimals)).toString()
  const res = await fetch(`${API}/v0/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.NEAR_INTENT_API_KEY ? { authorization: `Bearer ${process.env.NEAR_INTENT_API_KEY}` } : {}) },
    body: JSON.stringify({
      dry: true, swapType: 'EXACT_INPUT', slippageTolerance: 100,
      originAsset: origin.assetId, depositType: 'ORIGIN_CHAIN',
      destinationAsset: dest.assetId, amount,
      refundTo: addrFor(origin.blockchain), refundType: 'ORIGIN_CHAIN',
      recipient: addrFor(dest.blockchain), recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(Date.now() + 20 * 60_000).toISOString(), referral: 'yeetful',
    }),
  })
  const text = await res.text()
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { parsed = text }
  const message = parsed && typeof parsed === 'object' && 'message' in parsed ? String((parsed as { message: unknown }).message) : ''
  return { ok: res.ok, message }
}

async function main() {
  const toks: Tok[] = await fetch(`${API}/v0/tokens`).then((r) => r.json())
  const pick = (slug: string) => toks.find((t) => t.blockchain === slug && t.symbol === 'USDC') ?? toks.find((t) => t.blockchain === slug && t.symbol === 'USDT')
  const hub = pick('base')!
  const arb = pick('arb')!
  let bad = 0

  const say = (side: FloorSide, word: string, expect: number | null, got: number | null, detail: string) => {
    const agree = expect === got
    if (!agree) bad++
    console.log(`  ${agree ? '✓' : '✗'} ${word.padEnd(10)} ${side.padEnd(11)} table=${expect === null ? 'no floor' : `$${expect}`}  live=${got === null ? 'no floor' : `$${got}`}  ${detail}`)
  }
  const floorOf = (m: string): number | null => {
    const x = m.match(/minimum swap amount is \$\s?([\d,]+(?:\.\d+)?)/i)
    return x ? Number(x[1].replace(/,/g, '')) : null
  }

  console.log(`\nlib/venue-floor vs live 1Click — dry quotes at $${PROBE_USD}\n`)
  for (const [slug, word] of Object.entries(SLUG)) {
    const tok = pick(slug)
    if (!tok) { console.log(`  – ${word.padEnd(10)} no USDC/USDT listed — skipped`); continue }
    for (const side of ['origin', 'destination'] as FloorSide[]) {
      // A chain can't be its own counterparty: hub for everything, and arb
      // when the chain under test IS the hub.
      const other = slug === 'base' ? arb : hub
      const [o, d] = side === 'origin' ? [tok, other] : [other, tok]
      // Non-EVM chains can't be an ORIGIN for us (the MCP refuses to build a
      // deposit off-EVM before it quotes), so that half isn't a product fact.
      if (side === 'origin' && NON_EVM.has(slug)) { console.log(`  – ${word.padEnd(10)} origin      not buildable (non-EVM) — skipped`); continue }
      const r = await quote(o, d, PROBE_USD)
      const live = r.ok ? null : floorOf(r.message)
      const expect = floorFor(word, side)?.usd ?? null
      // An error that is NOT a floor (no liquidity, a venue wobble) is not a
      // disagreement about floors — report it and move on.
      if (!r.ok && live === null) { console.log(`  ? ${word.padEnd(10)} ${side.padEnd(11)} venue said: ${r.message.slice(0, 80)}`); continue }
      say(side, word, expect, live, r.ok ? `priced at $${PROBE_USD}` : r.message.slice(0, 44))
      await sleep(350)
    }
  }

  // Each floored chain must still CLEAR just above its own floor — otherwise
  // the "move a bigger amount" chip is a dead end.
  console.log(`\nabove the floor:`)
  for (const [word, f] of Object.entries(VENUE_FLOORS)) {
    const slug = Object.entries(SLUG).find(([, w]) => w === word)?.[0]
    const tok = slug ? pick(slug) : undefined
    if (!tok) { console.log(`  ? ${word} — not listed, cannot verify`); bad++; continue }
    const r = await quote(tok, hub, f.usd * 1.05)
    if (!r.ok) { console.log(`  ✗ ${word.padEnd(10)} $${Math.round(f.usd * 1.05)} still refused: ${r.message.slice(0, 60)}`); bad++ }
    else console.log(`  ✓ ${word.padEnd(10)} $${Math.round(f.usd * 1.05)} prices — the size-up chip works`)
    await sleep(350)
  }

  console.log(bad ? `\n${bad} disagreement(s) — re-measure and update VENUE_FLOORS in lib/venue-floor.ts\n` : `\ntable matches live\n`)
  process.exit(bad ? 2 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
