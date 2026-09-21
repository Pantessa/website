// ─────────────────────────────────────────────────────────────────────────
//  Multi-step jobs — the orchestration primitive (HANDOFF-multistep-jobs.md).
//
//  COMPILER (pure, this file's top half): one compound ask → a FIXED
//  sequence of steps, each backed by an existing native parser. The plan is
//  compiled once, at creation — the runner executes and re-guards; it never
//  re-plans. A segment no native layer can parse fails the WHOLE compile
//  with an honest explanation (jobs are deterministic or they are nothing).
//
//  Step kinds:
//   · sign — a guarded artifact the user's wallet signs. Built FRESH at
//     offer time by the same builders chat uses; the JobCard embeds the
//     existing sign buttons.
//   · wait — a settlement predicate the runner polls. Waits ARE the
//     verification layer: the next step's build re-checks balances anyway,
//     so a lying completion just fails closed one step later.
//   · auto — a server-side action under an EXISTING consent (guardian arm
//     needs an active approveAgent delegation). Jobs never widen authority.
//
//  SEGMENT REGISTRY: every step kind the compiler understands is one entry
//  in JOB_SEGMENT_PARSERS — an ordered list of {label, parse}. Adding a new
//  chainable action (a new native layer, a new MCP-backed builder) is one
//  entry here + one builder branch in lib/jobs-runner.ts:buildSignArtifact;
//  the refusal copy lists itself from the registry so it never goes stale.
//  Order matters: earlier entries claim first (cross-chain before
//  same-chain, NFT sends before fungible sends).
// ─────────────────────────────────────────────────────────────────────────

import { parseAaveOp, parseAaveSupply, type AaveOpParams, type AaveSupplyParams } from '@/lib/aave-supply'
import { parseMorphoLend, parseMorphoOp } from '@/lib/morpho-supply'
import { parseCrossChainSwap, type CrossChainSwapParams } from '@/lib/cross-chain-swap'
import { LIFI_DESTINATIONS, type LifiDestination } from '@/lib/lifi-destinations'
import { chainAlt, canonicalChainWord, normalizeArrows, normalizeChainWords, normalizeWorth } from '@/lib/chain-lexicon'
import { hlUnsizedChips, parseHlIntent, type HlIntent, type HlOrderIntent } from '@/lib/hyperliquid-exec'
import { parseGuardianArm, type GuardianArmAsk } from '@/lib/hl-guardian'
import { fenceGuardianCoin } from '@/lib/hl-guardian-fence'

import { hlPerpUniverseCached } from '@/lib/hl-universe'
import { parseLidoStake } from '@/lib/lido-stake'
import { parseSpotGuardArm } from '@/lib/spot-guard'
import { primaryStable, chainById } from '@/lib/chains'
import { ETH_MOVE_MIN_USD, fundingAltUsdcFor, fundingOriginWords, GAS_LEG_USD, MIN_VALUE_LEG_USD } from '@/lib/lifi-bridge'
import { parseNftAsk } from '@/lib/nft-layer'
import { parseMultiSendSegments, parseTransferSegment } from '@/lib/transfer-exec'
import { pairStockToken, stockChipLabel } from '@/lib/stock-pairing'
import type { ClarifyRequest } from '@/lib/clarify'

export interface CompiledStep {
  kind: 'sign' | 'wait' | 'auto'
  /** build_path-style attribution; 'wait' for wait steps. */
  builder: string
  title: string
  params: Record<string, unknown>
  /** wait steps: what the runner polls. {kind:'oneclick', fromStep} |
   *  {kind:'hl-credit', minUsd} — fromStep indexes the step whose artifact
   *  carries the deposit address. */
  waitPredicate?: Record<string, unknown>
}

export interface CompiledJob {
  title: string
  steps: CompiledStep[]
}

/**
 * Stamp the link fee tier onto every swap-building step of a compiled job
 * (native-swap, plus the funded-buy native-lifi-swap — which builds through
 * the same venue cascade despite its historical id).
 * A link-originated turn's ONE-SHOT swap prices at LINK_SWAP_FEE_BPS (#608);
 * without this, the SAME ask compiled as a job (fund-then-buy, compound
 * swaps) silently kept the base rate — a link's flagship multi-step path
 * under-attributed its creator. Chat POST validates the slug and passes the
 * tier; the runner re-validates the stamped value against the canonical
 * tier before building. No feeBps → the compiled job unchanged.
 */
export function stampSwapFeeTier(compiled: CompiledJob, feeBps: number | undefined): CompiledJob {
  if (!feeBps) return compiled
  return {
    ...compiled,
    steps: compiled.steps.map((s) => (s.builder === 'native-swap' || s.builder === 'native-lifi-swap' ? { ...s, params: { ...s.params, feeBps } } : s)),
  }
}

// ── Robinhood funding plan ──────────────────────────────────────────────────
// "Fund robinhood chain with $12 from base including gas, then buy $10 of
// AAPL" — the exact resume string the chat route's funding-offer chips emit
// (prepareSwapTurn detects an unfunded Robinhood Chain buy and proposes the
// plan). Deterministic on purpose: the chip IS the contract, so the parse
// stays narrow — "fund robinhood … with $X from <origin> [using usdc.e |
// using eth]" and nothing looser. Origins: Base, Ethereum, Arbitrum, Optimism (the
// LiFi-probed set); the "using" clause picks a registry-known bridged
// variant or native ETH.

export interface RobinhoodFundingAsk {
  /** Total dollars of origin funds to convert (gas leg included when flagged). */
  fundUsd: number
  /** True when a gas leg (origin funds → native ETH on 4663) must come first.
   *  Never true for a stable-gas destination (Arc) — the landed USDC is the gas. */
  gasIncluded: boolean
  /** Where the legs land: Robinhood Chain (4663) or Arc (5042). */
  destChainId: number
  destName: string
  /** The origin chain the funds leave from. */
  originChainId: number
  originWord: string
  /** The origin-side sell asset: 'USDC', a registry-known bridged variant
   *  ('USDC.e' via "using usdc.e"), or native 'ETH' ("using eth"). Both
   *  legs sell it. */
  token: string
}

// Typo-tolerant chain words (shared lexicon) — captures canonicalize
// before the keyed lookups below.
// Destinations: "robinhood chain" (4663) and "arc" (5042, Circle's chain —
// USDC gas, so its sentence never carries "including gas").
const FUND_RE = new RegExp(
  String.raw`\bfund\s+(robin\s?hoo?d(?:\s?chain)?|arc(?:\s?(?:chain|network|mainnet))?)\s+with\s+\$?(\d+(?:\.\d+)?)\s+from\s+(${chainAlt(['base', 'ethereum', 'arbitrum', 'optimism'])})\b`,
  'i',
)
const fundDestOf = (word: string): LifiDestination => (/robin/i.test(word) ? LIFI_DESTINATIONS[4663] : LIFI_DESTINATIONS[5042])

const FUND_ORIGINS: Record<string, { id: number; word: string }> = {
  base: { id: 8453, word: 'Base' },
  ethereum: { id: 1, word: 'Ethereum' },
  mainnet: { id: 1, word: 'Ethereum' },
  arb: { id: 42161, word: 'Arbitrum' },
  arbitrum: { id: 42161, word: 'Arbitrum' },
  optimism: { id: 10, word: 'Optimism' },
  op: { id: 10, word: 'Optimism' },
}

/**
 * A cross-chain segment whose DESTINATION is Robinhood Chain is a FUNDING
 * move, not a NEAR Intents swap: 1Click can't deliver to 4663 — the LiFi
 * funding legs are the only path (prod 2026-09-04: "Convert $1 USDC from
 * Base to USDG on Robinhood Chain" walked to the NEAR door / "Robinhood
 * Chain not supported by NEAR Intents"). Rewrites the ask into the canonical
 * funding sentence the funding parser reads, or answers with chips when the
 * amount is under the parity floor (LiFi's flat fee can make anything smaller
 * refuse at build) or sized in ETH (the plan is dollar-sized). Null when the
 * segment isn't this shape; a problem names an origin the plan can't leave.
 */
export function robinhoodFundingFromCrossChain(segment: string): { ask: string } | { clarify: ClarifyRequest; reply: string } | { problem: string } | null {
  const cc = parseCrossChainSwap(segment)
  if (!cc || 'problem' in cc) return null
  const destWord = canonicalChainWord(cc.destinationChain)
  const dest = destWord === 'robinhood' ? LIFI_DESTINATIONS[4663] : destWord === 'arc' ? LIFI_DESTINATIONS[5042] : null
  if (!dest) return null
  const stableSym = primaryStable(dest.chainId)!.symbol.toUpperCase()
  const token = cc.originToken.toUpperCase()
  const destToken = cc.destinationToken.toUpperCase()
  // "Bridge 0.01 ETH from Ethereum to Robinhood Chain" is the CANONICAL
  // bridge (lib/robinhood-bridge.ts — a native ETH deposit, the splash's own
  // chip), not a funding plan: leave it to the bridge layer below the jobs
  // gate. ETH from an L2 has no canonical bridge and DOES ride LiFi. Arc
  // has no canonical ETH bridge at all (and no ETH gas) — every Arc move
  // is a LiFi leg landing as USDC.
  if (dest.gasLeg && token === 'ETH' && (destToken === 'ETH' || destToken === 'WETH') && canonicalChainWord(cc.originChain) === 'ethereum') return null
  const origin = FUND_ORIGINS[canonicalChainWord(cc.originChain) ?? cc.originChain.toLowerCase()]
  if (!origin) {
    return { problem: `${dest.name} is funded from ${fundingOriginWords()} — NEAR Intents can't deliver to it, so move the funds to one of those chains first, then say “fund ${dest.word} with $${cc.amount} from base”.` }
  }
  const originWord = origin.word.toLowerCase()
  const chipsFor = (suffix: string, presets: number[]) => presets.map((usd) => ({ label: `$${usd} from ${origin.word}${suffix ? ` (${suffix.replace(/^using /, '')})` : ''}`, resume: `Fund ${dest.word} with $${usd} from ${originWord}${suffix ? ` ${suffix}` : ''}` }))
  const floor = MIN_VALUE_LEG_USD
  if (token === 'ETH') {
    // The plan is dollar-sized (LiFi legs are quoted in USD) — ask for the
    // dollar figure instead of pricing ETH here. On Robinhood Chain, ETH
    // asked to land as ETH moves as ETH (parseRobinhoodEthMove, one native
    // leg); only an ask that names another landing token takes the USDG legs.
    if (dest.gasLeg && destToken === 'ETH') {
      return {
        reply: `The canonical Robinhood Chain bridge only runs from Ethereum — from ${origin.word}, ETH moves as ETH by one LiFi leg sized in dollars (a few seconds, to your own address, and ETH is Robinhood Chain's gas too). Pick how much of your ${origin.word} ETH to move.`,
        clarify: {
          question: `How much ETH to move from ${origin.word}?`,
          options: [
            ...[10, 20, 50].map((usd) => ({ label: `$${usd} of ETH from ${origin.word}`, resume: `Move $${usd} of ETH from ${originWord} to robinhood chain` })),
            { label: 'Not now', resume: 'Never mind — leave my funds where they are.' },
          ],
        },
      }
    }
    return {
      reply: dest.gasLeg
        ? `The canonical Robinhood Chain bridge only runs from Ethereum — from ${origin.word} the money moves by a LiFi leg sized in dollars, landing as USDG (Robinhood Chain's dollar) with a little ETH for gas when the wallet there needs it. Pick how much of your ${origin.word} ETH to move.`
        : `${dest.name} has no ETH — the money moves by a LiFi leg sized in dollars and lands as ${stableSym}, which also pays for gas there. Pick how much of your ${origin.word} ETH to move.`,
      clarify: { question: `How much to move from ${origin.word}?`, options: [...chipsFor('using eth', [10, 20, 50]), { label: 'Not now', resume: 'Never mind — leave my funds where they are.' }] },
    }
  }
  const alt = fundingAltUsdcFor(origin.id)
  const suffix = token === 'USDC' ? '' : alt && alt.symbol.toUpperCase() === token ? `using ${alt.symbol.toLowerCase()}` : null
  if (suffix === null) {
    return { problem: `Only USDC${alt ? ` (or ${alt.symbol})` : ''} and ETH bridge onto ${dest.name} from ${origin.word} — swap your ${token} to USDC on ${origin.word} first, then say “fund ${dest.word} with $${cc.amount} from ${originWord}”.` }
  }
  if (destToken !== stableSym && destToken !== token && destToken !== 'USDC') {
    // "swap 20 USDC from base to AAPL on robinhood" — a funded buy: the
    // two-segment form compiles as fund → wait → buy. Hand it over as a chip
    // rather than guessing the buy size.
    return {
      reply: `On ${dest.name} the money lands as ${stableSym} first, then buys ${destToken} — that's a two-step job.`,
      clarify: { question: `Run it as one job?`, options: [{ label: `Fund $${cc.amount} from ${origin.word}, then buy ${destToken}`, resume: `Fund ${dest.word} with $${cc.amount} from ${originWord}${suffix ? ` ${suffix}` : ''}, then buy $${cc.amount} of ${destToken}` }, { label: 'Not now', resume: 'Never mind — leave my funds where they are.' }] },
    }
  }
  const fundUsd = Number(cc.amount)
  if (!Number.isFinite(fundUsd) || fundUsd <= 0) return null
  if (fundUsd < floor) {
    return {
      reply: `The smallest clean move onto ${dest.name} is $${floor} — LiFi's flat fee takes too big a share of anything smaller for the parity guard to be sure of it, so a $${cc.amount} leg could be built only to be withheld.`,
      clarify: { question: `Move a little more instead?`, options: [...chipsFor(suffix, [floor, 20, 50]), { label: 'Not now', resume: 'Never mind — leave my funds where they are.' }] },
    }
  }
  return { ask: `Fund ${dest.word} with $${cc.amount} from ${originWord}${suffix ? ` ${suffix}` : ''}` }
}

export function parseRobinhoodFunding(segment: string): RobinhoodFundingAsk | null {
  const m = normalizeChainWords(segment).match(FUND_RE)
  if (!m) return null
  const dest = fundDestOf(m[1])
  const fundUsd = Number(m[2])
  if (!Number.isFinite(fundUsd) || fundUsd <= 0) return null
  const originWord = m[3].toLowerCase().replace(/\s+/g, ' ')
  const origin = FUND_ORIGINS[canonicalChainWord(originWord) ?? originWord]
  if (!origin) return null
  return {
    fundUsd,
    // A stable-gas destination has no gas leg to include — "including gas"
    // there is a no-op, never a leg.
    gasIncluded: dest.gasLeg && /\bincluding\s+gas\b/i.test(segment),
    originChainId: origin.id,
    originWord: origin.word,
    token: /\busing\s+usdc\.?e\b/i.test(segment) ? 'USDC.e' : /\busing\s+eth\b/i.test(segment) ? 'ETH' : 'USDC',
    destChainId: dest.chainId,
    destName: dest.name,
  }
}

// "Move $10 of ETH from base to robinhood chain": the chip a buy of ETH gets
// when the wallet's only money is ETH (lib/lifi-bridge planRobinhoodEthMove).
// The ETH crosses as ETH in ONE LiFi leg instead of ETH → USDG → ETH. Dollar-
// sized like every funding leg, so it never collides with the canonical
// bridge's ETH-sized "bridge 0.01 ETH from ethereum to robinhood chain".
const MOVE_ETH_RE = new RegExp(
  String.raw`\b(?:move|bridge)\s+\$(\d+(?:\.\d+)?)(?:\s+worth)?\s+of\s+(?:my\s+)?eth\s+from\s+(${chainAlt(['base', 'ethereum', 'arbitrum', 'optimism'])})\s+(?:to|onto)\s+robin\s?hoo?d(?:\s?chain)?\b`,
  'i',
)

export interface RobinhoodEthMoveAsk {
  moveUsd: number
  originChainId: number
  originWord: string
}

export function parseRobinhoodEthMove(segment: string): RobinhoodEthMoveAsk | null {
  const m = normalizeChainWords(segment).match(MOVE_ETH_RE)
  if (!m) return null
  const moveUsd = Number(m[1])
  if (!Number.isFinite(moveUsd) || moveUsd <= 0) return null
  const originWord = m[2].toLowerCase().replace(/\s+/g, ' ')
  const origin = FUND_ORIGINS[canonicalChainWord(originWord) ?? originWord]
  return origin ? { moveUsd, originChainId: origin.id, originWord: origin.word } : null
}

// "Fund robinhood chain gas from base using eth": the gas leg on its own.
// The planner emits it when the token a buy is for pays the gas and another
// origin pays the value ("…, then Fund robinhood chain with $10.5 from
// arbitrum, then buy $10 of ETH"): gas is spent, never bought back. Robinhood
// Chain only — Arc's gas is the USDC that lands.
const FUND_GAS_RE = new RegExp(
  String.raw`\bfund\s+robin\s?hoo?d(?:\s?chain)?\s+gas\s+from\s+(${chainAlt(['base', 'ethereum', 'arbitrum', 'optimism'])})\b`,
  'i',
)

export function parseRobinhoodGasFunding(segment: string): { originChainId: number; originWord: string; token: string } | null {
  const m = normalizeChainWords(segment).match(FUND_GAS_RE)
  if (!m) return null
  const originWord = m[1].toLowerCase().replace(/\s+/g, ' ')
  const origin = FUND_ORIGINS[canonicalChainWord(originWord) ?? originWord]
  if (!origin) return null
  return {
    originChainId: origin.id,
    originWord: origin.word,
    token: /\busing\s+usdc\.?e\b/i.test(segment) ? 'USDC.e' : /\busing\s+eth\b/i.test(segment) ? 'ETH' : 'USDC',
  }
}

// The buy segment that follows a funding segment ("buy $10 of AAPL"). Only
// consulted once a funding step compiled — a bare "buy $X of Y" elsewhere
// belongs to the swap layer, not the jobs compiler.
const FUND_BUY_RE = /\bbuy\s+\$?(\d+(?:\.\d+)?)(?:\s+worth)?\s+of\s+([A-Za-z]{1,10})\b/i

// ── Same-chain swap segment ────────────────────────────────────────────────
// "swap 20 USDC for WETH on Arbitrum" — the exact follow-up the funding
// plan's chips emit for sell-token shortfalls. Narrow on purpose: the verb,
// an amount, both tokens, and an EXPLICIT first-class chain word. The
// "for|into|to <token>" connector keeps it disjoint from the cross-chain
// grammar (which demands from|on right after the first token).

export interface SameChainSwapSegment {
  amountHuman: string
  sellToken: string
  buyToken: string
  chainId: number
  chainName: string
}

const SWAP_SEG_CHAINS: Record<string, { id: number; name: string }> = {
  base: { id: 8453, name: 'Base' },
  arbitrum: { id: 42161, name: 'Arbitrum' },
  arb: { id: 42161, name: 'Arbitrum' },
  optimism: { id: 10, name: 'Optimism' },
  op: { id: 10, name: 'Optimism' },
  ethereum: { id: 1, name: 'Ethereum' },
  mainnet: { id: 1, name: 'Ethereum' },
  robinhood: { id: 4663, name: 'Robinhood Chain' },
  'robinhood chain': { id: 4663, name: 'Robinhood Chain' },
  arc: { id: 5042, name: 'Arc' },
  'arc chain': { id: 5042, name: 'Arc' },
  'arc network': { id: 5042, name: 'Arc' },
}

const SWAP_SEG_RE = new RegExp(
  `\\bswap\\s+(\\d+(?:\\.\\d+)?)\\s+\\$?([A-Za-z]{2,12})\\s+(?:for|into|to)\\s+\\$?([A-Za-z]{2,12})\\s+on\\s+(${chainAlt(['base', 'ethereum', 'arbitrum', 'optimism', 'robinhood', 'arc'])})\\b`,
  'i',
)

// "buy $50 of ETH on Base" / "buy $50 worth of AAPL on robinhood" — the
// dollar-buy job segment (MK2/EXEC). Disjoint from the funding fund-buy
// ("buy $X of Y" with no chain word, only after a funding leg).
const DOLLAR_BUY_SEG_RE = new RegExp(
  `\\bbuy\\s+\\$(\\d+(?:\\.\\d+)?)(?:\\s+worth)?\\s+of\\s+\\$?([A-Za-z]{2,12})\\s+on\\s+(${chainAlt(['base', 'ethereum', 'arbitrum', 'optimism', 'robinhood'])})\\b`,
  'i',
)

export function parseSameChainSwapSegment(segment: string): SameChainSwapSegment | null {
  const m = normalizeChainWords(segment).match(SWAP_SEG_RE)
  if (!m) return null
  const segWord = m[4].toLowerCase().replace(/\s+/g, ' ')
  const chain = SWAP_SEG_CHAINS[canonicalChainWord(segWord) ?? segWord]
  if (!chain) return null
  return { amountHuman: m[1], sellToken: m[2], buyToken: m[3], chainId: chain.id, chainName: chain.name }
}

/** Split a compound ask into segments on then/;/→ connectors. */
export function splitJobSegments(message: string): string[] {
  return message
    .split(/\s*(?:→|;|,?\s*(?:and\s+)?\bthen\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Connectors people actually use to join two intents in one message, beyond
 * the explicit then/;/→ the primary splitter knows. Every one of these was
 * probed and dropped an intent silently before this existed.
 *
 * Whitespace is REQUIRED around the symbolic ones so nothing inside a value
 * is ever cut: "0.5 ETH" survives the period rule (it needs `. ` with a
 * space), "USDC/cbBTC" survives the slash rule, "+5%" survives the plus.
 */
const COMPOUND_CONNECTOR_RE =
  /\s*(?:,?\s+(?:and\s+)?also\s+|,?\s+and\s+|,?\s+plus\s+|,?\s+followed\s+by\s+|,?\s+after\s+that\s+|\s+\+\s+|\s+&\s+|\s+\/\s+|\.\s+|,\s+|\n+)/i

/** Candidate pieces of a segment joined by one of the connectors above.
 *  Speculative only — expandCompoundSegments decides whether to use them. */
function compoundSplitCandidates(segment: string): string[] | null {
  const parts = segment
    .split(COMPOUND_CONNECTOR_RE)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length >= 2 ? parts : null
}

/**
 * Two intents joined by anything other than "then" ("lend 100 USDC on morpho
 * and stake 0.5 ETH on lido", "… plus …", "… also …", two lines, two
 * sentences) used to compile to NOTHING: the ask fell past the jobs gate to
 * the single-venue layers, each parser matched its OWN clause, and the first
 * gate to run claimed the turn while the other intent vanished — the #595
 * silent-drop through a different connector. Every connector in
 * COMPOUND_CONNECTOR_RE was probed and reproduced that drop.
 *
 * The split is SPECULATIVE and accepted only when every piece parses cleanly
 * on its own (steps, never a problem or a clarify). That conservatism is what
 * makes it safe: shapes where a connector belongs INSIDE one intent — a
 * multi-clause send sharing a trailing recipient ("send all my USDC on
 * arbitrum and 5 USDC on base to 0x…"), a pronoun follow-up, "buy $10 of AAPL
 * and $10 of TSLA" — leave at least one piece unparseable, so the split is
 * rejected and the segment stays whole, exactly as before.
 *
 * When a split DOES succeed it wins over the whole-segment reading, because a
 * parser matching the full string is matching its own clause and ignoring the
 * rest — the interpretation that keeps every intent is the honest one.
 */
function expandCompoundSegments(segments: string[], message: string): string[] {
  const out: string[] = []
  for (const seg of segments) {
    const candidates = compoundSplitCandidates(seg)
    if (!candidates) {
      out.push(seg)
      continue
    }
    const allParse = candidates.every((piece) =>
      JOB_SEGMENT_PARSERS.some((parser) => {
        const res = parser.parse(piece, { index: 0, fundingSeen: false, nft: null, message })
        return !!res && !('problem' in res) && !('clarify' in res)
      }),
    )
    if (allParse) out.push(...candidates)
    else out.push(seg)
  }
  return out
}

// ── Segment registry ───────────────────────────────────────────────────────

/** The NFT an earlier segment named — lets "buy X then send it to 0x…"
 *  resolve the pronoun deterministically within ONE compound ask. */
export interface JobNftContext {
  ref: string
  tokenId: string | null
  contract: string | null
  chainId: number | null
}

export interface JobSegmentCtx {
  /** 0-based index of the segment in the compound ask. */
  index: number
  /** True once a Robinhood funding segment compiled earlier in the ask. */
  fundingSeen: boolean
  /** The destination chain of the funding segment seen (4663 | 5042). */
  fundingDest?: number
  /** The last NFT an earlier segment named, or null. */
  nft: JobNftContext | null
  /** The FULL compound ask — clarify resume strings restate it with the
   *  ambiguous piece resolved, so a chip click round-trips this compiler. */
  message: string
}

export interface JobSegmentCompiled {
  steps: CompiledStep[]
  title: string
  /** Set to flag later segments (the funding parser gates the buy parser). */
  fundingSeen?: boolean
  fundingDest?: number
  /** Set when the segment named an NFT (threads pronoun follow-ups). */
  nft?: JobNftContext
}

export interface JobSegmentParser {
  id: string
  /** Plural noun phrase for the self-listing refusal copy ("token sends").
   *  Omit to keep an entry out of the copy (context-gated parsers). */
  label?: string
  parse: (seg: string, ctx: JobSegmentCtx) => JobSegmentCompiled | { problem: string } | { clarify: ClarifyRequest; reply?: string } | null
}

// ── Stock pairing at COMPILE time ──────────────────────────────────────────
// The 2026-07-21 "AAPLE" job: the buy segment compiled unvalidated and only
// failed at RUN time — step 3, after the funding legs had moved real money.
// Every Robinhood-bound token now pairs here, before the job exists: obvious
// names rewrite to the ticker, a suspected misspelling ASKS first (clarify
// chips whose resumes restate the whole compound ask, corrected — a chip
// click round-trips compileJobAsk), and nothing close refuses outright.
function pairJobStockToken(raw: string, ctx: JobSegmentCtx): { token: string } | { problem: string } | { clarify: ClarifyRequest } {
  const paired = pairStockToken(raw, 4663)
  if (paired.kind === 'ok') return { token: raw.toUpperCase() }
  if (paired.kind === 'paired') return { token: paired.symbol }
  if (paired.kind === 'unknown') {
    return { problem: `Robinhood Chain doesn't list "${raw}" — it carries 100 tokenized stocks (AAPL, NVDA, TSLA, …). Nothing was built.` }
  }
  const wordRe = new RegExp(`\\b${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  const options = paired.candidates.map((c) => ({ label: stockChipLabel(c), resume: ctx.message.replace(wordRe, c.symbol) }))
  if (options.length < 2) options.push({ label: 'None of these — cancel', resume: 'Never mind — don’t build anything.' })
  return {
    clarify: {
      question:
        paired.candidates.length === 1
          ? `"${raw}" isn't listed on Robinhood Chain — did you mean ${stockChipLabel(paired.candidates[0])}?`
          : `"${raw}" matches a few Robinhood Chain stocks — which did you mean?`,
      options: options.slice(0, 4),
    },
  }
}

// "send it to 0x…" / "transfer the nft to name.eth" — only consulted when an
// earlier segment in the same ask named an NFT (ctx.nft).
const NFT_PRONOUN_SEND_RE = /^(?:and\s+)?(?:send|transfer|gift)\s+(?:it|that|this|the\s+nft)\s+to\s+(0x[0-9a-fA-F]{40}|[a-zA-Z0-9][a-zA-Z0-9-]*\.eth)\s*[.!?]*\s*$/i

const shortRecipient = (to: string) => (to.startsWith('0x') ? `${to.slice(0, 6)}…${to.slice(-4)}` : to)
const sendAmountWord = (amountHuman: string) => (amountHuman === 'all' ? 'all your' : amountHuman)

/**
 * Every chainable action, in claim order. To make a new dapp/MCP action
 * chainable: add an entry here (narrow parser → CompiledSteps) and a
 * matching builder branch in lib/jobs-runner.ts:buildSignArtifact. Problems
 * are returned BARE — the compiler prefixes "Step N: ".
 */
export const JOB_SEGMENT_PARSERS: JobSegmentParser[] = [
  {
    id: 'robinhood-funding',
    label: 'Robinhood Chain funding plans',
    parse: (seg) => {
      // The ETH move: one value leg of native ETH, landing as ETH.
      const move = parseRobinhoodEthMove(seg)
      if (move) {
        if (move.moveUsd < ETH_MOVE_MIN_USD) {
          return { problem: `the smallest ETH move onto Robinhood Chain is $${ETH_MOVE_MIN_USD} (the size LiFi reliably fills), and $${move.moveUsd} is under it.` }
        }
        return {
          steps: [
            { kind: 'sign', builder: 'native-lifi-fund', title: `Move ~$${move.moveUsd} of ${move.originWord} ETH → ETH on Robinhood Chain`, params: { leg: 'eth', usd: move.moveUsd, origin: move.originChainId, token: 'ETH' } },
            { kind: 'wait', builder: 'wait', title: 'The ETH arrives on Robinhood Chain', params: {}, waitPredicate: { kind: 'chain-arrival', fromSteps: [0] } },
          ],
          title: `Move $${move.moveUsd} of ETH from ${move.originWord} to Robinhood Chain`,
          fundingSeen: true,
          fundingDest: 4663,
        }
      }
      // The gas leg on its own (the bought token paying gas beside another
      // origin's value leg).
      const gasOnly = parseRobinhoodGasFunding(seg)
      if (gasOnly) {
        if (gasOnly.token !== 'USDC' && gasOnly.token !== 'ETH' && fundingAltUsdcFor(gasOnly.originChainId)?.symbol !== gasOnly.token) {
          return { problem: `${gasOnly.originWord} has no ${gasOnly.token} in the chain registry — only Arbitrum's bridged USDC.e is supported.` }
        }
        return {
          steps: [
            { kind: 'sign', builder: 'native-lifi-fund', title: `Bridge ~$${GAS_LEG_USD} of gas ETH → Robinhood Chain (from ${gasOnly.originWord})`, params: { leg: 'gas', usd: GAS_LEG_USD, origin: gasOnly.originChainId, token: gasOnly.token } },
            { kind: 'wait', builder: 'wait', title: 'Gas arrives on Robinhood Chain', params: {}, waitPredicate: { kind: 'chain-arrival', fromSteps: [0] } },
          ],
          title: `Fund Robinhood Chain gas from ${gasOnly.originWord}`,
          fundingSeen: true,
          fundingDest: 4663,
        }
      }
      let fund = parseRobinhoodFunding(seg)
      if (!fund) {
        // "swap 20 USDC from base to USDG on robinhood" IS this segment —
        // claimed here, ahead of the cross-chain entry, so it never becomes
        // a NEAR leg to a chain NEAR can't reach.
        const redirect = robinhoodFundingFromCrossChain(seg)
        if (!redirect) return null
        if ('clarify' in redirect) return { clarify: redirect.clarify, reply: redirect.reply }
        if ('problem' in redirect) return { problem: redirect.problem }
        fund = parseRobinhoodFunding(redirect.ask)
        if (!fund) return null
      }
      // A bridged-variant ask only compiles where the registry knows the
      // token — "using usdc.e" from Base would otherwise become a job whose
      // every build refuses. Native ETH exists on every origin.
      if (fund.token !== 'USDC' && fund.token !== 'ETH' && fundingAltUsdcFor(fund.originChainId)?.symbol !== fund.token) {
        return { problem: `${fund.originWord} has no ${fund.token} in the chain registry — only Arbitrum's bridged USDC.e is supported.` }
      }
      const usdgUsd = Math.max(0, Number((fund.fundUsd - (fund.gasIncluded ? GAS_LEG_USD : 0)).toFixed(2)))
      if (usdgUsd <= 0) {
        return { problem: `$${fund.fundUsd} isn't enough to fund ${fund.destName}${fund.gasIncluded ? ` — the gas leg alone is ~$${GAS_LEG_USD}` : ''}.` }
      }
      const destStable = primaryStable(fund.destChainId)?.symbol ?? 'USDC'
      // `dest` rides in the step params only for a non-default destination,
      // so every Robinhood job compiled before Arc stays byte-identical.
      const destParam = fund.destChainId === 4663 ? {} : { dest: fund.destChainId }
      const steps: CompiledStep[] = []
      const arrivalFrom: number[] = []
      if (fund.gasIncluded) {
        steps.push({ kind: 'sign', builder: 'native-lifi-fund', title: `Bridge ~$${GAS_LEG_USD} of gas ETH → ${fund.destName} (from ${fund.originWord})`, params: { leg: 'gas', usd: GAS_LEG_USD, origin: fund.originChainId, token: fund.token, ...destParam } })
        arrivalFrom.push(steps.length - 1)
      }
      steps.push({ kind: 'sign', builder: 'native-lifi-fund', title: `Move $${usdgUsd} of ${fund.originWord} ${fund.token} → ${destStable} on ${fund.destName}`, params: { leg: 'usdg', usd: usdgUsd, origin: fund.originChainId, token: fund.token, ...destParam } })
      arrivalFrom.push(steps.length - 1)
      steps.push({
        kind: 'wait',
        builder: 'wait',
        title: `Funds arrive on ${fund.destName}`,
        params: {},
        waitPredicate: { kind: 'chain-arrival', fromSteps: arrivalFrom },
      })
      return { steps, title: `Fund ${fund.destName} with $${fund.fundUsd} from ${fund.originWord}`, fundingSeen: true, fundingDest: fund.destChainId }
    },
  },
  {
    // Context-gated: only consulted once a funding segment compiled, and the
    // arrivalFrom indices above are relative to THIS ask — a bare "buy $X of
    // Y" in any other compound ask never lands here. No label on purpose.
    id: 'robinhood-fund-buy',
    parse: (seg, ctx) => {
      if (!ctx.fundingSeen) return null
      const buy = seg.match(FUND_BUY_RE)
      if (!buy) return null
      const buyUsd = Number(buy[1])
      const destChainId = ctx.fundingDest ?? 4663
      const destStable = primaryStable(destChainId)?.symbol ?? 'USDG'
      // Pair the ticker BEFORE the job exists — "AAPLE" must ask here, not
      // fail at step 3 after the funding legs already moved money. Only
      // Robinhood Chain carries the stock list; on Arc the buy token is one
      // of the chain's own pinned tokens (BTC → cirBTC, EURC), checked by
      // the registry, and anything else refuses by name.
      let buyToken: string
      if (destChainId === 4663) {
        const paired = pairJobStockToken(buy[2], ctx)
        if (!('token' in paired)) return paired
        buyToken = paired.token
      } else {
        const sym = buy[2].toUpperCase()
        const destChain = chainById(destChainId)
        const known = destChain?.tokens[sym]
        if (!known || sym === destStable) {
          // One name per contract (EUR/BTC are ask-side aliases of EURC/cirBTC).
          const seen = new Set<string>()
          const listed = Object.entries(destChain?.tokens ?? {})
            .filter(([k, t]) => k !== destStable && !seen.has(t.address.toLowerCase()) && seen.add(t.address.toLowerCase()))
            .map(([k]) => k)
          return { problem: `${destChain?.name ?? 'That chain'} doesn't trade "${buy[2]}" here — the tokens it lists are ${listed.join(', ')}. Nothing was built.` }
        }
        buyToken = sym
      }
      const title = `Buy ~$${buyUsd} of ${buyToken} with the arrived ${destStable}`
      return { steps: [{ kind: 'sign', builder: 'native-lifi-swap', title, params: { buyUsd, buyToken, sellToken: destStable, chainId: destChainId } }], title: `Buy $${buyUsd} of ${buyToken}` }
    },
  },
  {
    // NFT buys, sends, and listings — BEFORE the fungible transfer entry, so
    // "send my Pudgy Penguin #2489 to 0x…" claims here (the mentionsNft gate
    // keeps token sends out), and ALL run before the cross-chain parse: a
    // send names an explicit 0x/ENS recipient, which the bridge grammar would
    // otherwise half-claim as a malformed destination ("send 1 USDC on base
    // to nate.eth" must be a send, not a bridge problem). Builders re-anchor
    // ownership / live listings on-chain at offer time.
    id: 'nft',
    label: 'NFT buys/transfers/listings',
    parse: (seg, ctx) => {
      // "…then send it to 0x…" — the pronoun follow-up of an earlier NFT
      // segment in the SAME ask (a just-bought NFT has no other name yet).
      // Requires prior NFT context; a bare "send it to 0x…" never lands here.
      if (ctx.nft) {
        const pronoun = seg.match(NFT_PRONOUN_SEND_RE)
        if (pronoun) {
          const ask = { kind: 'transfer', ...ctx.nft, amount: '1', to: pronoun[1] }
          const title = `Send ${ctx.nft.ref} to ${pronoun[1]}`
          return { steps: [{ kind: 'sign', builder: 'native-nft-transfer', title, params: ask }], title, nft: ctx.nft }
        }
      }
      const ask = parseNftAsk(seg)
      if (!ask) return null
      if (ask.kind === 'problem') return { problem: ask.problem }
      const nft: JobNftContext = { ref: ask.ref, tokenId: ask.tokenId, contract: ask.contract, chainId: ask.chainId }
      if (ask.kind === 'buy') {
        // The wait IS the chain step: a follow-up transfer's ownership check
        // would refuse while the fill is still confirming.
        const title = `Buy ${ask.ref} on OpenSea${ask.maxPriceEth ? ` (≤ ${ask.maxPriceEth} ETH)` : ''}`
        return {
          steps: [
            { kind: 'sign', builder: 'native-nft-buy', title, params: ask as unknown as Record<string, unknown> },
            { kind: 'wait', builder: 'wait', title: `${ask.ref} lands in your wallet`, params: {}, waitPredicate: { kind: 'nft-owned', fromStep: 0 } },
          ],
          title,
          nft,
        }
      }
      if (ask.kind === 'transfer') {
        const title = `Send ${ask.ref} to ${ask.to}`
        return { steps: [{ kind: 'sign', builder: 'native-nft-transfer', title, params: ask as unknown as Record<string, unknown> }], title, nft }
      }
      const title = `List ${ask.ref} on OpenSea${ask.priceEth ? ` for ${ask.priceEth} ETH` : ' at floor'}`
      return { steps: [{ kind: 'sign', builder: 'native-nft-list', title, params: ask as unknown as Record<string, unknown> }], title, nft }
    },
  },
  {
    // Fungible sends — "send the 1 USDC on arbitrum to 0x…". The chain word
    // is mandatory (a compiled transfer never guesses its chain) and the
    // recipient must be an explicit 0x address or ENS name — which is also
    // why sitting ahead of the cross-chain entry is safe: a real bridge ask
    // ("swap 1 USDC from base to arbitrum") has no such recipient.
    id: 'transfer',
    label: 'token sends',
    parse: (seg) => {
      // Multi-clause first: "send all my USDC on arbitrum and an additional
      // 5 USDC on base to 0x…" — ONE recipient, one sign step per clause,
      // each step's build re-reading its own chain's live balance ('all'
      // resolves at sign time, never at compile time).
      const multi = parseMultiSendSegments(seg)
      if (multi && 'problem' in multi) return { problem: multi.problem }
      if (multi) {
        const steps: CompiledStep[] = multi.map((t) => ({
          kind: 'sign',
          builder: 'native-transfer',
          title: `Send ${sendAmountWord(t.amountHuman)} ${t.token.toUpperCase()} to ${shortRecipient(t.to)} on ${t.chainName}`,
          params: t as unknown as Record<string, unknown>,
        }))
        const parts = multi.map((t) => `${sendAmountWord(t.amountHuman)} ${t.token.toUpperCase()} (${t.chainName})`).join(' + ')
        return { steps, title: `Send ${parts} to ${shortRecipient(multi[0].to)}` }
      }
      const t = parseTransferSegment(seg)
      if (!t) return null
      if ('problem' in t) return { problem: t.problem }
      const title = `Send ${sendAmountWord(t.amountHuman)} ${t.token.toUpperCase()} to ${shortRecipient(t.to)} on ${t.chainName}`
      return { steps: [{ kind: 'sign', builder: 'native-transfer', title, params: t as unknown as Record<string, unknown> }], title }
    },
  },
  {
    id: 'cross-chain-swap',
    label: 'cross-chain swaps/bridges',
    parse: (seg) => {
      const cc = parseCrossChainSwap(seg)
      if (!cc) return null
      if ('problem' in cc) return { problem: cc.problem }
      const ccp = cc as CrossChainSwapParams
      // A job leg always pays out to the wallet running the job — later steps
      // spend what it delivers. A delivery address belongs on a single swap.
      if (ccp.recipient) return { problem: 'A separate delivery address works on a single swap, not inside a multi-step job — the next step needs the funds in your own wallet. Ask for the private swap on its own.' }
      const title = `${ccp.confidential ? 'Private bridge' : 'Bridge'} ${ccp.amount} ${ccp.originToken.toUpperCase()} (${ccp.originChain}) → ${ccp.destinationToken.toUpperCase()} (${ccp.destinationChain})`
      return {
        steps: [
          { kind: 'sign', builder: 'native-cross-chain', title, params: ccp as unknown as Record<string, unknown> },
          { kind: 'wait', builder: 'wait', title: 'Solver settles the swap', params: {}, waitPredicate: { kind: 'oneclick', fromStep: 0 } },
        ],
        title,
      }
    },
  },
  {
    // Same-chain swap segments — the funding plan's follow-up when the
    // shortfall was a swap's sell token ("fund Arbitrum, then swap 20 USDC
    // for WETH on Arbitrum"). Runs AFTER the cross-chain parse (a "from X to
    // Y" phrasing is a bridge, never this) and demands the chain word — a
    // compiled job step must never guess its chain.
    id: 'same-chain-swap',
    label: 'same-chain swaps',
    parse: (seg, ctx) => {
      const sameSwap = parseSameChainSwapSegment(seg)
      if (!sameSwap) return null
      // Robinhood-bound legs pair their tokens at compile time (obvious
      // names rewrite, suspected typos ask) — same rule as the fund-buy.
      if (sameSwap.chainId === 4663) {
        const sell = pairJobStockToken(sameSwap.sellToken, ctx)
        if (!('token' in sell)) return sell
        const buy = pairJobStockToken(sameSwap.buyToken, ctx)
        if (!('token' in buy)) return buy
        sameSwap.sellToken = sell.token
        sameSwap.buyToken = buy.token
      }
      const title = `Swap ${sameSwap.amountHuman} ${sameSwap.sellToken.toUpperCase()} → ${sameSwap.buyToken.toUpperCase()} on ${sameSwap.chainName}`
      return { steps: [{ kind: 'sign', builder: 'native-swap', title, params: sameSwap as unknown as Record<string, unknown> }], title }
    },
  },
  {
    // MK2/EXEC (2026-09-15): a DOLLAR buy as a job step — "buy $50 of ETH on
    // Base" is the chat's own swap sentence, but the registry had no segment
    // for it, so "Buy $50 of ETH on Base, then stake all the swapped ETH on
    // Lido" compiled to nothing and the Lido gate claimed the whole ask,
    // DROPPING the buy (the #595 partial-claim class). Sized in the chain's
    // primary stable (USDC; USDG on 4663 — the dollars ARE the units) and
    // handed to the same native-swap builder as a same-chain swap. The chain
    // word is REQUIRED (jobs stay strict; the chat layer's picker/4663
    // inference is not replicated here). A lone "buy $50 of ETH on base"
    // still belongs to the swap layer: compileJobAsk returns null under two
    // segments.
    id: 'dollar-buy',
    label: 'dollar buys on a named chain',
    parse: (seg, ctx) => {
      const m = normalizeWorth(normalizeChainWords(seg)).match(DOLLAR_BUY_SEG_RE)
      if (!m) return null
      const segWord = m[3].toLowerCase().replace(/\s+/g, ' ')
      const chain = SWAP_SEG_CHAINS[canonicalChainWord(segWord) ?? segWord]
      if (!chain) return null
      const stable = primaryStable(chain.id)
      if (!stable) return null
      const usd = Number(m[1])
      if (!Number.isFinite(usd) || usd <= 0) return { problem: 'names a dollar amount of zero.' }
      let buyToken = m[2]
      if (chain.id === 4663) {
        const buy = pairJobStockToken(buyToken, ctx)
        if (!('token' in buy)) return buy
        buyToken = buy.token
      }
      const sameSwap: SameChainSwapSegment = { amountHuman: String(usd), sellToken: stable.symbol, buyToken, chainId: chain.id, chainName: chain.name }
      const title = `Buy $${usd} of ${buyToken.toUpperCase()} on ${chain.name}`
      return { steps: [{ kind: 'sign', builder: 'native-swap', title, params: sameSwap as unknown as Record<string, unknown> }], title }
    },
  },
  {
    id: 'hyperliquid',
    label: 'Hyperliquid deposits/orders',
    parse: (seg) => {
      const hl = parseHlIntent(seg)
      if (!hl) return null
      if (hl.kind === 'open-unsized') {
        return { problem: `names a ${hl.isBuy ? 'long' : 'short'} on ${hl.coin} but no size — say e.g. "${hlUnsizedChips(hl)[0].resume}".` }
      }
      if (hl.kind === 'deposit') {
        const title = `Deposit ${hl.amountUsdc} USDC to Hyperliquid`
        return {
          steps: [
            { kind: 'sign', builder: 'native-hl-exec', title, params: hl as unknown as Record<string, unknown> },
            { kind: 'wait', builder: 'wait', title: 'Hyperliquid credits the deposit', params: {}, waitPredicate: { kind: 'hl-credit', minUsd: Math.min(hl.amountUsdc * 0.9, hl.amountUsdc - 0.5) } },
          ],
          title,
        }
      }
      const o = hl as HlOrderIntent
      const title =
        o.kind === 'close'
          ? `Close ${o.coin} on Hyperliquid`
          : `${o.leverage ? `${o.leverage}x ` : ''}${o.isBuy ? 'Long' : 'Short'} ${o.notionalUsd ? `$${o.notionalUsd} of ` : `${o.sizeUnits} `}${o.coin} on Hyperliquid`
      return { steps: [{ kind: 'sign', builder: 'native-hl-exec', title, params: hl as unknown as Record<string, unknown> }], title }
    },
  },
  {
    id: 'lido-stake',
    label: 'Lido stakes',
    parse: (seg) => {
      const lido = parseLidoStake(seg)
      if (!lido) return null
      if ('problem' in lido) return { problem: lido.problem }
      const title =
        lido.amount === 'max'
          ? `Stake the ETH on Lido${lido.receive === 'wstETH' ? ' (wstETH)' : ''}`
          : `Stake ${lido.amount} ETH on Lido${lido.receive === 'wstETH' ? ' (wstETH)' : ''}`
      return { steps: [{ kind: 'sign', builder: 'native-lido', title, params: lido as unknown as Record<string, unknown> }], title }
    },
  },
  {
    // Aave supply/repay segments — the ops a funding plan lands on. The
    // compiler has no selected-set context, so only EXPLICIT Aave asks
    // compile ("supply 20 USDC to aave"); weak/bare verbs stay chat-only.
    // Aave v4 builds run on Ethereum — a named other chain refuses honestly.
    id: 'aave-supply',
    label: 'Aave supplies/repays',
    parse: (seg) => {
      const aaveSup = parseAaveSupply(seg)
      if (!aaveSup || 'problem' in aaveSup || !aaveSup.explicitAave || aaveSup.weak) return null
      if (aaveSup.otherChain) return { problem: `Aave v4 builds run on Ethereum — I can't supply on ${aaveSup.otherChain}.` }
      const title = `Supply ${aaveSup.amountIsUsd ? `$${aaveSup.amount} of ` : `${aaveSup.amount} `}${aaveSup.token.toUpperCase()} to Aave v4${aaveSup.bestRate ? ' (best rate)' : ''}`
      return {
        steps: [{
          kind: 'sign',
          builder: 'native-aave-supply',
          title,
          params: {
            token: aaveSup.token,
            amount: aaveSup.amount,
            ...(aaveSup.amountIsUsd ? { amountIsUsd: true } : {}),
            ...(aaveSup.bestRate ? { bestRate: true } : {}),
          },
        }],
        title,
      }
    },
  },
  {
    id: 'aave-repay',
    label: 'Aave supplies/repays',
    parse: (seg) => {
      const aaveOp = parseAaveOp(seg)
      if (!aaveOp || 'problem' in aaveOp || aaveOp.op !== 'repay' || !aaveOp.explicitAave || aaveOp.weak) return null
      if (aaveOp.otherChain) return { problem: `Aave v4 builds run on Ethereum — I can't repay on ${aaveOp.otherChain}.` }
      const title = aaveOp.max ? `Repay the full ${aaveOp.token.toUpperCase()} debt on Aave v4` : `Repay ${aaveOp.amount} ${aaveOp.token.toUpperCase()} on Aave v4`
      return { steps: [{ kind: 'sign', builder: 'native-aave-repay', title, params: { token: aaveOp.token, amount: aaveOp.amount, max: aaveOp.max } }], title }
    },
  },
  {
    // Morpho lend/repay segments — the same discipline as the Aave entries:
    // the compiler has no selected-set context, so only EXPLICIT Morpho asks
    // compile ("lend 100 USDC on morpho"); weak/bare verbs stay chat-only.
    // The chain rides the segment (Base default, Ethereum on request); any
    // other named chain refuses honestly.
    id: 'morpho-lend',
    label: 'Morpho lends/repays',
    parse: (seg) => {
      const lend = parseMorphoLend(seg)
      if (!lend || 'problem' in lend || !lend.explicitMorpho || lend.weak) return null
      if (lend.otherChain) return { problem: `Morpho builds run on Base or Ethereum — I can't lend on ${lend.otherChain}.` }
      const title = `Lend ${lend.amountIsUsd ? `$${lend.amount} of ` : `${lend.amount} `}${lend.token.toUpperCase()} on Morpho (${lend.chainId === 1 ? 'Ethereum' : 'Base'})`
      return {
        steps: [{ kind: 'sign', builder: 'native-morpho-lend', title, params: { token: lend.token, amount: lend.amount, chainId: lend.chainId, ...(lend.amountIsUsd ? { amountIsUsd: true } : {}) } }],
        title,
      }
    },
  },
  {
    id: 'morpho-repay',
    label: 'Morpho lends/repays',
    parse: (seg) => {
      const mop = parseMorphoOp(seg)
      if (!mop || 'problem' in mop || mop.op !== 'repay' || !mop.explicitMorpho || mop.weak) return null
      if (mop.otherChain) return { problem: `Morpho builds run on Base or Ethereum — I can't repay on ${mop.otherChain}.` }
      const title = mop.max
        ? `Repay the full ${mop.token.toUpperCase()} debt on Morpho (${mop.chainId === 1 ? 'Ethereum' : 'Base'})`
        : `Repay ${mop.amount} ${mop.token.toUpperCase()} on Morpho (${mop.chainId === 1 ? 'Ethereum' : 'Base'})`
      return { steps: [{ kind: 'sign', builder: 'native-morpho-repay', title, params: { token: mop.token, amount: mop.amount, max: mop.max, chainId: mop.chainId } }], title }
    },
  },
  {
    id: 'guardian',
    label: 'guardian protection',
    parse: (seg) => {
      const parsed = parseGuardianArm(seg)
      if (!parsed) return null
      // A SPOT stop ("in my wallet" / "on Base" / "spot") is the Spot
      // Guardian's, not an HL policy — until it has a job segment of its
      // own it refuses BY NAME instead of arming the wrong venue
      // (MK2/EXEC found "…, then protect my ETH in my wallet with a 5% stop"
      // compiling to native-hl-guardian, 2026-09-15).
      if (parseSpotGuardArm(seg)) return { problem: `is a spot stop (the Spot Guardian on Base) — that isn't a job step yet; run the job, then send "${seg.trim()}" on its own.` }
      // The chat gate's coin fence — a stock segment refuses the job BY NAME
      // instead of compiling a guardian step no runner can arm. Sync: the
      // route warms the cached universe before compiling; cold falls back to
      // the static stock fence.
      const fence = fenceGuardianCoin(parsed, hlPerpUniverseCached())
      if (!fence.ok) return { problem: fence.problem }
      const arm = { ...parsed, coin: fence.coin }
      const title = `Arm ${arm.kind
 === 'stop_loss' ? 'stop-loss' : 'take-profit'} on ${arm.coin} (${arm.triggerMode === 'price' ? `px ${arm.triggerValue}` : `${arm.triggerValue}%`})`
      return { steps: [{ kind: 'auto', builder: 'native-hl-guardian', title, params: arm as unknown as Record<string, unknown> }], title }
    },
  },
]

/** The registry's own refusal listing — dedup'd, in claim order. */
const compilableKinds = (): string => {
  const labels = [...new Set(JOB_SEGMENT_PARSERS.map((p) => p.label).filter((l): l is string => !!l))]
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}` : labels[0] ?? ''
}

/**
 * Compile a compound ask, or explain exactly which segment can't be. Returns
 * null when the message isn't job-shaped (fewer than 2 parseable segments —
 * single asks belong to the native layers directly).
 */
export function compileJobAsk(rawMessage: string): CompiledJob | { problem: string } | { clarify: ClarifyRequest; reply?: string } | null {
  // Arrows are how our own cards print a pair ("USDG → AAPL") and "worth" is
  // what every card says before "of"; the segment grammars read words, so
  // rewrite both once here (lib/chain-lexicon) — a typo'd "worth" inside a
  // compound ("…, then buy $10 orth of AAPL") used to refuse the whole job.
  const message = normalizeArrows(normalizeWorth(rawMessage))
  const segments = expandCompoundSegments(splitJobSegments(message), message)
  // Single asks belong to the native layers — EXCEPT segments that are
  // multi-step on their own: a lone Robinhood funding segment (the MCP-path
  // fallback's bridge-only chips carry no follow-up; the legs + arrival
  // wait are already a job), and a multi-clause send ("send all my USDC on
  // arbitrum and 5 USDC on base to 0x…" — one sentence, two chains, two
  // signatures = a job even without a "then").
  const loneMultiStep = (seg: string) =>
    !!parseRobinhoodFunding(seg) || !!parseRobinhoodEthMove(seg) || !!parseRobinhoodGasFunding(seg) || robinhoodFundingFromCrossChain(seg) !== null || parseMultiSendSegments(seg) !== null
  if (segments.length < 2 && !(segments.length === 1 && loneMultiStep(segments[0]))) return null

  const steps: CompiledStep[] = []
  const titles: string[] = []
  let fundingSeen = false
  let fundingDest: number | undefined
  let nftSeen: JobNftContext | null = null
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    let matched = false
    for (const parser of JOB_SEGMENT_PARSERS) {
      const res = parser.parse(seg, { index: i, fundingSeen, fundingDest, nft: nftSeen, message })
      if (!res) continue
      if ('clarify' in res) return res // ask BEFORE the job exists — a chip click re-enters here resolved
      if ('problem' in res) return { problem: `Step ${i + 1}: ${res.problem}` }
      // Wait predicates reference steps by index. Entries author them LOCAL
      // to their own steps array (fromStep/fromSteps count from 0 within the
      // entry); the compiler rebases onto the job's absolute indices here, so
      // entries stay position-independent ("deposit … then fund robinhood …"
      // must not corrupt the funding legs' arrival pointers).
      const base = steps.length
      for (const s of res.steps) {
        const pred = s.waitPredicate as { fromStep?: number; fromSteps?: number[] } | undefined
        if (pred) {
          s.waitPredicate = {
            ...pred,
            ...(typeof pred.fromStep === 'number' ? { fromStep: base + pred.fromStep } : {}),
            ...(Array.isArray(pred.fromSteps) ? { fromSteps: pred.fromSteps.map((n) => base + n) } : {}),
          }
        }
        steps.push(s)
      }
      titles.push(res.title)
      if (res.fundingSeen) fundingSeen = true
      if (res.fundingDest) fundingDest = res.fundingDest
      if (res.nft) nftSeen = res.nft
      matched = true
      break
    }
    if (matched) continue

    // First segment already not ours → this isn't a job ask at all; let the
    // native layers / router handle the message. But once ANY segment
    // compiled, an unparseable later segment is an honest hard stop — a job
    // with a guessed step is worse than no job.
    if (steps.length === 0) return null
    return {
      problem:
        `I can compile steps that are ${compilableKinds()} — ` +
        `step ${i + 1} ("${seg.slice(0, 80)}") isn't one of those yet, so I won't guess. ` +
        `Amounts must be explicit (e.g. "deposit 20 usdc to hyperliquid").`,
    }
  }

  // A "job" of one real action + its waits is just that action — let the
  // native layer own it directly. Two exceptions mirror the gate at the
  // top: a lone Robinhood funding segment IS the job (legs + arrival wait),
  // and a lone segment that compiled to ≥2 sign/auto steps (a multi-clause
  // send) IS one too — two chains, two signatures.
  const actionSteps = steps.filter((s) => s.kind !== 'wait').length
  if (titles.length < 2 && actionSteps < 2 && !(titles.length === 1 && fundingSeen)) return null
  return { title: titles.join(' → '), steps }
}

export type { HlIntent, GuardianArmAsk, CrossChainSwapParams, AaveSupplyParams, AaveOpParams }
