// ─────────────────────────────────────────────────────────────────────────
//  1Click's temporary per-chain minimum swap size — named, not raw.
//
//  NEAR Intents put a floor under swaps touching a handful of chains. The
//  venue enforces it at QUOTE time with an HTTP 400 whose body reads
//  "Temporary swap limits: minimum swap amount is $1,000", so `build_swap`
//  throws and the chat turn used to print the venue's own sentence back at
//  the user: honest, but the venue's voice, naming no way forward, and a
//  burned turn (prod shape, 2026-09-22).
//
//  Two layers, on purpose:
//
//    1. The TABLE below — measured, never copied from the changelog — lets
//       us refuse BEFORE the round trip, and lets the job compiler refuse a
//       leg at compile time instead of stranding a multi-step job on it. It
//       only ever fires when we can size the move in dollars (a stable is
//       1:1, the DOLLAR_STABLE_RE rule this layer already uses); a move we
//       can't price goes to the venue, because refusing a 1 BTC move from
//       Polygon for being "under $1,000" would be a lie.
//    2. `venueFloorFromError` — the belt. Whatever the table misses, the
//       venue's own refusal still becomes a named one with the venue's own
//       number, so a floor that moves or appears on a new chain never
//       reaches a user as a raw error.
//
//  MEASURED LIVE 2026-09-22 (`npm run probe:venue-floors`, dry quotes, the
//  exact body services/near-intents sends). Every EVM chain we can build a
//  deposit on, both directions, plus the non-EVM chains the grammar accepts:
//
//    Polygon      $1,000   origin AND destination
//    BNB Chain    $1,000   origin AND destination
//    Tron         $100     origin only (as a destination it prices at $20)
//    Ethereum, Base, Arbitrum, Optimism, Avalanche, Gnosis, Scroll,
//    Solana, NEAR, Monad, X Layer, ADI — no floor at $20.
//
//  NEAR's changelog is STALE and must not be the source: it lists Optimism
//  and Avalanche at $1,000 (both price $20 fine today) and says nothing
//  about the floor applying to the destination side, which it does for
//  Polygon and BNB Chain. Hence the probe script and the live harness pins.
//
//  Tron is measured but deliberately NOT in the table: the MCP refuses a
//  non-EVM origin before it ever quotes ("can only BUILD deposit
//  transactions on EVM chains"), so a Tron floor chip would offer a bigger
//  size that still can't be built — a dead end one step further on.
// ─────────────────────────────────────────────────────────────────────────

import { canonicalChainWord, prettyChainWord } from '@/lib/chain-lexicon'
import { crossChainAskSentence, type CrossChainSwapParams, type MoveSource } from '@/lib/cross-chain-swap'

/** Which end of the move a floor applies to. Polygon and BNB Chain fence
 *  both; the sides are kept apart because Tron fences only the origin, so
 *  "per chain" would have been the wrong shape to build. */
export type FloorSide = 'origin' | 'destination'

export interface VenueFloor {
  /** Minimum swap size in USD, as the venue states it. */
  usd: number
  /** The ends it applies to — measured, not assumed symmetric. */
  sides: readonly FloorSide[]
}

/** Keyed by CANONICAL chain word (lib/chain-lexicon), so the typo aliases
 *  the grammar accepts ("matic", "bsc", "binance") all land here. */
export const VENUE_FLOORS: Readonly<Record<string, VenueFloor>> = {
  polygon: { usd: 1000, sides: ['origin', 'destination'] },
  bnb: { usd: 1000, sides: ['origin', 'destination'] },
}

/** Stables this layer prices 1:1 — the same set DOLLAR_STABLE_RE reads, so
 *  "swap 20 USDC" is sized here exactly as the grammar sizes "$20 USDC". */
const STABLE_1_TO_1 = new Set(['USDC', 'USDC.E', 'USDT', 'USDG', 'DAI', 'USDE'])

/** Dollar size of a move, or null when this layer can't price it (it never
 *  prices a non-stable — a cross-chain move is sized in the token it moves). */
export function moveUsd(amount: string, token: string): number | null {
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) return null
  return STABLE_1_TO_1.has(token.toUpperCase()) ? n : null
}

export function floorFor(chain: string, side: FloorSide): VenueFloor | null {
  const key = canonicalChainWord(chain) ?? chain.trim().toLowerCase()
  const f = VENUE_FLOORS[key]
  return f && f.sides.includes(side) ? f : null
}

export interface FloorBlock {
  /** Canonical word of the chain carrying the floor. */
  chain: string
  /** Which end of this move it sits on — 'route' when only the venue
   *  refused and the table doesn't name an end, so the copy never claims
   *  a side the venue didn't state. */
  side: FloorSide | 'route'
  /** The floor in USD. */
  usd: number
  /** The move's size in USD when we could price it — null otherwise. */
  askUsd: number | null
}

/**
 * Does the measured table refuse this move before we ask the venue? Only
 * when the size is KNOWN and under the floor. An unpriceable move returns
 * null and goes to the venue, where `venueFloorFromError` catches it.
 *
 * The origin end is checked first: when both ends are floored the origin is
 * the one the user can actually change by picking another chain they hold on.
 */
export function crossChainFloorBlock(p: Pick<CrossChainSwapParams, 'amount' | 'originToken' | 'originChain' | 'destinationChain'>): FloorBlock | null {
  const askUsd = moveUsd(p.amount, p.originToken)
  if (askUsd === null) return null
  for (const [chain, side] of [[p.originChain, 'origin'], [p.destinationChain, 'destination']] as const) {
    const f = floorFor(chain, side)
    if (f && askUsd < f.usd) {
      return { chain: canonicalChainWord(chain) ?? chain.toLowerCase(), side, usd: f.usd, askUsd }
    }
  }
  return null
}

// "Temporary swap limits: minimum swap amount is $1,000" — the venue's own
// 400. Thousands separators and cents both parse; anything else is not this
// shape and keeps its raw message.
const FLOOR_ERROR_RE = /minimum swap amount is \$\s?([\d,]+(?:\.\d+)?)/i

/**
 * The belt: read a floor out of the venue's own refusal. Returns the floor
 * in USD, or null when the error is something else entirely.
 *
 * The venue never says WHICH end carries the limit, so the caller decides
 * from the table when it can and says "this route" when it can't — we never
 * invent a side the venue didn't name.
 */
export function venueFloorFromError(message: string): number | null {
  const m = message.match(FLOOR_ERROR_RE)
  if (!m) return null
  const usd = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(usd) && usd > 0 ? usd : null
}

/** Block for a venue error, attributing the side from the table when the
 *  table knows it. `usd` is always the VENUE's number, not the table's. */
export function floorBlockFromError(
  p: Pick<CrossChainSwapParams, 'amount' | 'originToken' | 'originChain' | 'destinationChain'>,
  message: string,
): FloorBlock | null {
  const usd = venueFloorFromError(message)
  if (usd === null) return null
  const side: FloorSide | null = floorFor(p.originChain, 'origin') ? 'origin' : floorFor(p.destinationChain, 'destination') ? 'destination' : null
  const chain = side === 'destination' ? p.destinationChain : p.originChain
  return {
    chain: canonicalChainWord(chain) ?? chain.toLowerCase(),
    // Unknown side → 'route': the copy says "on this route" and offers no
    // origin chips, because we do not know that another origin would help.
    side: side ?? 'route',
    usd,
    askUsd: moveUsd(p.amount, p.originToken),
  }
}

/**
 * The sentence a chip sends. `crossChainAskSentence` writes the swap; the
 * privacy and delivery clauses are re-attached here, because a chip that
 * quietly dropped "privately" would turn a private ask into a public swap —
 * the one thing this layer has never been allowed to do (#827).
 */
export function floorChipAsk(p: CrossChainSwapParams): string {
  let ask = crossChainAskSentence(p)
  if (p.confidential) ask += ' privately'
  if (p.recipient) ask += `, delivered to ${p.recipient}`
  return ask
}

const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const units = (token: string, n: number) => {
  const dp = STABLE_1_TO_1.has(token.toUpperCase()) ? 2 : 5
  return String(Math.ceil(n * 10 ** dp) / 10 ** dp)
}

export interface FloorTurn {
  reply: string
  /** Complete asks — a chip SENDS on click, so each one round-trips the
   *  cross-chain grammar (harness-pinned). Empty when nothing we can offer
   *  would actually work. */
  chips: { label: string; resume: string }[]
  question: string
}

/**
 * The named refusal, plus the ways forward the WALLET can actually take.
 *
 * Two kinds of chip, and each is offered only when it would work:
 *   • another origin chain that holds enough of the same token — the real
 *     answer to an origin-side floor, and the funding scan already knows it;
 *   • the same move at a size that clears the floor — only when the balance
 *     on that chain covers it, because "try $1,000" to a wallet holding $20
 *     is the dead end one step further on.
 * No chips means no chips: the reply then says what the wallet does hold.
 */
export function floorRefusalTurn(p: CrossChainSwapParams, block: FloorBlock, sources: MoveSource[] | null): FloorTurn {
  const token = p.originToken.toUpperCase()
  const destWord = prettyChainWord(p.destinationChain)
  const originWord = prettyChainWord(p.originChain)
  const chainWord = prettyChainWord(block.chain)
  const norm = (w: string) => (canonicalChainWord(w) ?? w).toLowerCase()
  const asked = block.askUsd !== null ? `${p.amount} ${token} (${fmtUsd(block.askUsd)})` : `${p.amount} ${token}`

  const where =
    block.side === 'origin'
      ? `leaving ${chainWord}`
      : block.side === 'destination'
        ? `landing on ${chainWord}`
        : `on this route`

  const lines = [
    `🔗 **${chainWord} has a ${fmtUsd(block.usd)} minimum on this venue right now** — so I built nothing rather than hand you a deposit it will refuse.`,
    '',
    `NEAR Intents has a temporary limit on swaps ${where}: anything under ${fmtUsd(block.usd)} is rejected when the quote is priced, before there's ever a deposit address. Your ${asked} is under it. Nothing was signed and nothing moved.`,
  ]

  const chips: { label: string; resume: string }[] = []
  const held = sources?.filter((s) => s.token.toUpperCase() === token && s.balance > 0) ?? []

  // Another origin the wallet holds enough on — only meaningful when the
  // ORIGIN end is the floored one (moving from elsewhere doesn't change
  // where the money lands).
  if (block.side === 'origin') {
    for (const s of held
      .filter((s) => norm(s.chainWord) !== norm(block.chain) && norm(s.chainWord) !== norm(p.destinationChain))
      .filter((s) => !floorFor(s.chainWord, 'origin') && s.balance >= Number(p.amount))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 3)) {
      const from = prettyChainWord(norm(s.chainWord))
      chips.push({
        label: `From ${from} · holds ${units(token, s.balance)} ${token}`,
        resume: floorChipAsk({ ...p, originChain: norm(s.chainWord) }),
      })
    }
  }

  // The same move, big enough to clear — only if the balance on the floored
  // chain actually covers it.
  const onFloored = held.find((s) => norm(s.chainWord) === norm(block.side === 'destination' ? p.originChain : block.chain))
  const needUnits = block.askUsd !== null ? (Number(p.amount) / block.askUsd) * block.usd : null
  if (onFloored && needUnits !== null && onFloored.balance >= needUnits) {
    const size = units(token, needUnits)
    chips.push({
      label: `Move ${size} ${token} instead · clears the ${fmtUsd(block.usd)} minimum`,
      resume: floorChipAsk({ ...p, amount: size }),
    })
  }

  if (chips.length) {
    lines.push('', block.side === 'origin' && chips.some((c) => c.label.startsWith('From ')) ? `Here's what this wallet can do instead.` : `Here's the way through.`)
  } else if (block.side === 'route') {
    // The venue refused and the table doesn't name an end, so we say only
    // what the venue said — never guess which chain carries the limit.
    lines.push(
      '',
      `The venue didn't say which end of the route carries the limit, so the fix is the size: move at least ${fmtUsd(block.usd)} of ${token}, or wait — it's marked temporary.`,
    )
  } else if (block.side === 'destination') {
    lines.push(
      '',
      `To land ${token} on ${chainWord} today the move has to be at least ${fmtUsd(block.usd)}, and ${sources === null ? `I'd need to read your ${originWord} balance to size one` : `this wallet doesn't hold that much ${token} on ${originWord} to send`}. The limit is the venue's and it's marked temporary, so a smaller move will work again once it lifts.`,
    )
  } else {
    // No origin clears it — say WHY each chain that holds the token is out,
    // one clause each. A bare list of balances reads as "you have the money
    // and I still won't move it", which is the dead end this replaces.
    const seen = held.map((s) => {
      const w = prettyChainWord(norm(s.chainWord))
      const why =
        norm(s.chainWord) === norm(block.chain)
          ? `where the limit is`
          : norm(s.chainWord) === norm(p.destinationChain)
            ? `where it's already going`
            : floorFor(s.chainWord, 'origin')
              ? `same limit`
              : `not enough to move ${p.amount}`
      return `${units(token, s.balance)} ${token} on ${w} (${why})`
    })
    const tail = `Move at least ${fmtUsd(block.usd)} from ${originWord}, or wait — the venue marks the limit temporary.`
    lines.push(
      '',
      // A scan we never ran and a scan that came back empty are different
      // facts, and only one of them is "you don't have it elsewhere".
      sources === null
        ? `I couldn't read your balances on the other chains, so I can't tell you whether one of them could send this instead. ${tail}`
        : seen.length
          ? `Everywhere this wallet holds ${token} is out: ${seen.join('; ')}. ${tail}`
          : `I can't see ${token} anywhere else in this wallet, so there's no chain to move it from instead. ${tail}`,
    )
  }

  return {
    reply: lines.join('\n'),
    chips,
    question: block.side === 'origin' && chips.some((c) => c.label.startsWith('From ')) ? 'Move it from another chain?' : `Move ${destWord === chainWord ? 'a bigger amount' : 'it another way'}?`,
  }
}

/** One line for a job compiler / runner refusal — no chips, same facts. */
export function floorProblemLine(p: Pick<CrossChainSwapParams, 'amount' | 'originToken' | 'originChain' | 'destinationChain'>, block: FloorBlock): string {
  const token = p.originToken.toUpperCase()
  const chainWord = prettyChainWord(block.chain)
  const size = block.askUsd !== null ? ` (${fmtUsd(block.askUsd)})` : ''
  return `${chainWord} has a ${fmtUsd(block.usd)} minimum on NEAR Intents right now, and this step moves ${p.amount} ${token}${size} — the venue refuses the quote, so I didn't compile a job that would stop there. Move at least ${fmtUsd(block.usd)}, or route the step through a chain without the limit.`
}
