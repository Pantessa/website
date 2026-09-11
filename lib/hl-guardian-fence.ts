// The HL guardian's COIN FENCE — does "protect my X" name a market the
// guardian can actually watch? Product-side on purpose, so it lives BESIDE
// the pure guard module rather than in it: lib/hl-guardian.ts is byte-
// mirrored into the open-core @pantessa/guard package (guard-sdk/, drift-
// pinned by test:api), and this fence carries Pantessa's chip copy and the
// Robinhood Chain ticker snapshot.
import type { ClarifyOption } from '@/lib/clarify'
import type { GuardianArmAsk } from '@/lib/hl-guardian'
import { ROBINHOOD_TICKER_NAMES, ROBINHOOD_TICKER_SET } from '@/lib/robinhood-tickers'

// ── The coin fence ──────────────────────────────────────────────────────────
//
// parseGuardianArm's coin slot is loose on purpose (the grammar itself is the
// "stray stop loss" guard), so it claimed "protect my AAPL with a 5% stop" —
// a Robinhood Chain tokenized stock (Markets squad, 2026-09-11). No guardian
// can build that: the HL Guardian watches Hyperliquid perps and the Spot
// Guardian runs on Base. The fence decides, before any layer claims the
// turn, whether the coin is a market the guardian can watch — against the
// LIVE perp universe (lib/hl-universe.ts, cached) when the caller has it,
// and against the static Robinhood ticker snapshot when it doesn't (the pure
// replica, a cold cache, a feed outage). Cold, a coin that isn't a known
// stock passes: the arm path validates against live meta and refuses there,
// so the one thing the cold fence must never do is refuse a real market.

/** The Hyperliquid perp universe as the fence reads it (lib/hl-universe.ts
 *  builds it from the venue's `meta`). Names keep the venue's casing. */
export interface HlUniverse {
  /** Every perp currently trading — 'BTC', 'HYPE', 'kPEPE'. */
  listed: ReadonlySet<string>
  /** Perps the venue has delisted — still in `meta`, no market. */
  delisted: ReadonlySet<string>
}

/** Robinhood Chain stock tickers that ALSO name a live Hyperliquid perp (a
 *  crypto coin sharing the letters; measured 2026-09-11). The cold fence
 *  never refuses these — the live universe decides. The harness pins the
 *  live intersection ⊆ this set, so a new collision fails a gate instead of
 *  the cold fence walling a real market. */
export const HL_STOCK_TICKER_COLLISIONS: ReadonlySet<string> = new Set(['CASHCAT', 'ZETA'])

export type GuardianCoinFence =
  | { ok: true; coin: string }
  | {
      ok: false
      reason: 'stock' | 'not-listed' | 'delisted'
      /** The chat reply (markdown). */
      reply: string
      /** The same refusal as one plain sentence — job segments, audit notes. */
      problem: string
      /** Heading for the chips (unused when there are none). */
      question: string
      /** Asks that work instead — each round-trips a native gate (pinned). */
      chips: ClarifyOption[]
    }

const findCi = (set: ReadonlySet<string>, coin: string): string | null => {
  if (set.has(coin)) return coin
  const up = coin.toUpperCase()
  for (const name of set) if (name.toUpperCase() === up) return name
  return null
}

function stockRefusal(t: string): GuardianCoinFence {
  const company = ROBINHOOD_TICKER_NAMES[t]
  const what = company && company !== t ? `the ${company} tokenized stock` : 'a tokenized stock'
  return {
    ok: false,
    reason: 'stock',
    reply:
      `🛡️ **${t} isn't a Hyperliquid market** — it's ${what} on Robinhood Chain. ` +
      `The Guardian only protects Hyperliquid perp positions, and the Spot Guardian runs on Base, so there's no stop I can arm on it. ` +
      `Price alerts aren't live yet; on Robinhood Chain I can chart it, set up a DCA, or sell it now.`,
    problem:
      `${t} isn't a Hyperliquid market — it's ${what} on Robinhood Chain. The Guardian only protects Hyperliquid perp positions ` +
      `and the Spot Guardian runs on Base, so there's no stop to arm on it; on Robinhood Chain a DCA or a sell can run instead.`,
    question: `What should I do with ${t} instead?`,
    chips: [
      { label: `Chart ${t}`, resume: `Show me the ${t} chart` },
      { label: `DCA $10 into ${t} weekly`, resume: `DCA $10 into ${t} weekly` },
      { label: `Sell all my ${t}`, resume: `Sell all my ${t} for USDG on Robinhood Chain` },
    ],
  }
}

function notListedRefusal(ask: GuardianArmAsk, t: string): GuardianCoinFence {
  // A stop on a token you hold on Base is the Spot Guardian's job — offer its
  // exact grammar (it refuses what it can't hold on its own). Take-profit has
  // no spot twin, and the spot grammar caps percent stops under 90.
  const spot =
    ask.kind !== 'stop_loss'
      ? null
      : ask.triggerMode === 'price'
        ? `Protect my spot ${t} if it drops to $${ask.triggerValue}`
        : ask.triggerValue < 90
          ? `Protect my spot ${t} with a ${ask.triggerValue}% stop loss`
          : null
  const lead = `${t} isn't a Hyperliquid market, so the Guardian has nothing to watch — it only protects Hyperliquid perp positions.`
  return {
    ok: false,
    reason: 'not-listed',
    reply: `🛡️ **${t} isn't a Hyperliquid market**, so the Guardian has nothing to watch — it only protects Hyperliquid perp positions.` + (spot ? ` If you hold ${t} in your wallet on Base, the Spot Guardian can protect it instead.` : ''),
    problem: lead + (spot ? ` For ${t} held on Base, the Spot Guardian can: "${spot}".` : ''),
    question: `Protect ${t} on Base instead?`,
    chips: spot ? [{ label: `Protect my spot ${t}`, resume: spot }] : [],
  }
}

function delistedRefusal(t: string): GuardianCoinFence {
  const problem = `${t} was delisted on Hyperliquid — there's no market left for the Guardian to watch.`
  return { ok: false, reason: 'delisted', reply: `🛡️ **${t} was delisted on Hyperliquid** — there's no market left for the Guardian to watch.`, problem, question: '', chips: [] }
}

/**
 * Is the arm ask's coin a market the guardian can watch? `ok` carries the
 * venue's own casing ("kpepe" → kPEPE — meta lookups are exact-name). A
 * refusal names the coin and says why, with chips that work instead. Pass
 * `universe: null` when no live read is available (see the block comment).
 */
export function fenceGuardianCoin(ask: GuardianArmAsk, universe: HlUniverse | null): GuardianCoinFence {
  const t = ask.coin.toUpperCase()
  if (universe) {
    const live = findCi(universe.listed, ask.coin)
    if (live) return { ok: true, coin: live }
    if (findCi(universe.delisted, ask.coin)) return delistedRefusal(t)
    return ROBINHOOD_TICKER_SET.has(t) ? stockRefusal(t) : notListedRefusal(ask, t)
  }
  if (ROBINHOOD_TICKER_SET.has(t) && !HL_STOCK_TICKER_COLLISIONS.has(t)) return stockRefusal(t)
  return { ok: true, coin: ask.coin }
}
