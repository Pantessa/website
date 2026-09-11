/**
 * The PURE replica of the chat route's native-gate ladder, shared by the
 * costless audits (audit-asks.ts replays surfaced example asks through it;
 * audit-funding.ts replays funding-chip resume strings). Mirrors
 * app/api/chat/route.ts gate ORDER (vote → aave → dca → jobs → rebalance →
 * guardian →
 * lido → hyperliquid → robinhood bridge → nft (gallery → market → build) →
 * transfer →
 * swap/cross-chain) with the working set assumed to be ALL free MCPs
 * (usable), no chain picker, no pending context. Route-level gating that
 * needs live data (stock-list warm, balances) is approximated — this
 * simulates PARSE outcomes, not builds. Keep it the ONLY replica: new
 * gates land here once, both audits inherit them.
 */
import { parseVoteIntent } from '../lib/vote-intent'
import { parseAaveSupply, parseAaveOp } from '../lib/aave-supply'
import { parseDcaRun, parseDcaCreate, parseDcaManage } from '../lib/dca'
import { parseDcaAutoToggle } from '../lib/dca-auto'
import { parseMorphoLend, parseMorphoOp } from '../lib/morpho-supply'
import { compileJobAsk } from '../lib/jobs'
import { parseRebalanceAsk } from '../lib/rebalance'
import { parseMosaicAsk } from '../lib/mosaic'
import { parseGuardianArm } from '../lib/hl-guardian'
import { fenceGuardianCoin } from '../lib/hl-guardian-fence'

import { parseSpotGuardArm, parseSpotGuardManage } from '../lib/spot-guard'
import { isLidoGuidedAsk, parseLidoStake } from '../lib/lido-stake'
import { parseHlIntent } from '../lib/hyperliquid-exec'
import { parseRobinhoodBridge } from '../lib/robinhood-bridge'
import { parseChartAsk } from '../lib/charts'
import { mentionsNft, parseNftAsk, parseNftListAsk, parseNftMarketAsk } from '../lib/nft-layer'
import { parseTransferSegment } from '../lib/transfer-exec'
import { parseSwapIntent, detectCrossChain } from '../lib/swap-intent'
import { parseCrossChainSwap } from '../lib/cross-chain-swap'
import { parseStockListAsk } from '../lib/stock-list'
import { tokenHome } from '../lib/token-home'

export type Kind = 'action' | 'clarify' | 'planner'
export interface Outcome {
  gate: string
  kind: Kind
  note?: string
  /** A clarify that carries resumable chips (the user taps, never retypes). */
  chips?: true
  /** Where the turn came from (see LadderOptions); 'chat' when omitted. */
  origin?: 'chat' | 'link'
}

/**
 * The turn's ORIGIN. The route reads the same message through the same
 * ladder whether it arrived from /chat, an /i link (`intentLinkSlug`) or an
 * embed — the only thing a link origin changes today is the fee tier the
 * swap layer stamps (LINK_SWAP_FEE_BPS, C2b). audit:asks replays every
 * actionable ask in BOTH origins and fails on any class drift, so a rung
 * that starts behaving differently for link turns (SECURITY's E5 raw-address
 * refusal is the first candidate) must be mirrored here on purpose, never
 * discovered on a stranger's phone (links.md round 2: a $0 wallet got
 * "Sign & send swap" on a link because a phrasing fell to the planner).
 */
export interface LadderOptions {
  origin?: 'chat' | 'link'
}

const NATIVE_CHAINS = new Set(['base', 'ethereum', 'arbitrum', 'optimism', 'robinhood'])

/** Pure replica of the route ladder — same order, all free MCPs active. */
export function simulateLadder(message: string, opts: LadderOptions = {}): Outcome {
  const out = simulateLadderInner(message)
  return opts.origin === 'link' ? { ...out, origin: 'link' } : out
}

function simulateLadderInner(message: string): Outcome {
  const vote = parseVoteIntent(message)
  if (vote.isVote) return { gate: 'vote', kind: 'action' }

  // Chart asks are a READ the product owns (ChartOverlay) — the gate sits
  // right after governance in the route, ahead of every money layer, and a
  // money verb makes the parser refuse so those layers keep their asks.
  const chart = parseChartAsk(message)
  if (chart) return chart.pair ? { gate: 'chart', kind: 'action', note: `${chart.pair.label} overlay` } : { gate: 'chart', kind: 'clarify', note: `${chart.symbol} chartless — refused by name` }

  // Aave gates: with every free MCP active the route's set-hint passes but
  // rival venues exist, so weak verbs fall through — replicate by requiring
  // the explicit venue word (parseAaveSupply itself rejects rival-venue
  // messages via its OTHER_VENUE_RE).
  if (/\baave\b/i.test(message)) {
    const as = parseAaveSupply(message)
    if (as) return 'problem' in as ? { gate: 'aave-supply', kind: 'clarify', note: as.problem } : { gate: 'aave-supply', kind: 'action' }
    const ao = parseAaveOp(message)
    if (ao) return 'problem' in ao ? { gate: 'aave-op', kind: 'clarify', note: ao.problem } : { gate: 'aave-op', kind: 'action' }
  }

  if (parseDcaRun(message)) return { gate: 'dca', kind: 'action', note: 'run chip' }
  const dc = parseDcaCreate(message)
  // A non-EVM coin (SOL/XRP/DOGE…) refuses by name in the DCA layer — no
  // schedule buys a Base look-alike (lib/token-home).
  if (dc && !('problem' in dc) && tokenHome(dc.buyToken)) return { gate: 'dca', kind: 'clarify', note: `${dc.buyToken} lives on ${tokenHome(dc.buyToken)} — refused by name` }
  if (dc) return 'problem' in dc ? { gate: 'dca', kind: 'clarify', note: dc.problem } : { gate: 'dca', kind: 'action' }
  const dm = parseDcaManage(message)
  if (dm) return { gate: 'dca', kind: 'action', note: dm.op }
  // DCA autopilot toggles ("make my ETH dca autonomous", "turn off my dca
  // autopilot") — /docs/dca teaches both; they were invisible to this
  // replica until the 2026-09-08 squad replay (they read as planner falls).
  const da = parseDcaAutoToggle(message)
  if (da) return { gate: 'dca-auto', kind: 'action', note: da.op }

  const job = compileJobAsk(message)
  if (job) {
    if ('problem' in job) return { gate: 'jobs', kind: 'clarify', note: job.problem }
    if ('clarify' in job) {
      const c = (job as { clarify: { question: string; options: { label: string }[] }; reply?: string })
      return { gate: 'jobs', kind: 'clarify', note: `${c.reply ?? c.clarify.question} [${c.clarify.options.map((o) => o.label).join(' | ')}]`, ...(c.clarify.options.length ? { chips: true as const } : {}) }
    }
    return { gate: 'jobs', kind: 'action', note: `${(job as { steps: unknown[] }).steps?.length ?? '?'} steps` }
  }

  // Morpho sits AFTER jobs and BEFORE mosaic in the route (a single-venue
  // gate, so below the compound compiler — the #595 invariant). Seeded
  // splash chips ("lend 100 USDC on morpho") reach it; the replica had no
  // rung, so the audit could never see a Morpho dead-end.
  if (/\bmorpho\b/i.test(message)) {
    const ml = parseMorphoLend(message)
    if (ml) return 'problem' in ml ? { gate: 'morpho-lend', kind: 'clarify', note: ml.problem } : { gate: 'morpho-lend', kind: 'action' }
    const mo = parseMorphoOp(message)
    if (mo) return 'problem' in mo ? { gate: 'morpho-op', kind: 'clarify', note: mo.problem } : { gate: 'morpho-op', kind: 'action', note: mo.op }
  }

  // Mosaic sits AFTER jobs (a compound "tile …, then …" keeps its claim)
  // and BEFORE rebalance, mirroring the route. Its turn is a live-scan tile
  // plan whose legs are same-chain-swap sentences the jobs compiler
  // re-parses — the harness round-trips them.
  const mosaic = parseMosaicAsk(message)
  if (mosaic) {
    return 'problem' in mosaic
      ? { gate: 'mosaic', kind: 'clarify', note: mosaic.problem }
      : { gate: 'mosaic', kind: 'action', note: 'scan → tile plan' }
  }

  // Rebalance sits AFTER jobs (compound asks keep their claim) and BEFORE
  // spot-guard, mirroring the route. Its turn is a live-scan offer whose
  // chips re-enter this ladder — the harness round-trips them.
  if (parseRebalanceAsk(message)) return { gate: 'rebalance', kind: 'action', note: 'live scan → offer/quiet' }

  // Spot guardian runs BEFORE the HL guardian in the route — same here.
  if (parseSpotGuardArm(message) || parseSpotGuardManage(message)) return { gate: 'spot-guard', kind: 'action' }
  // The HL guardian's coin fence (lib/hl-guardian fenceGuardianCoin). The
  // replica has no live universe, so it reads the COLD fence the route falls
  // back to: a Robinhood Chain stock refuses by name with chips; anything
  // else passes to the arm path, which validates against live meta.
  const arm = parseGuardianArm(message)
  if (arm) {
    const fence = fenceGuardianCoin(arm, null)
    if (!fence.ok) return { gate: 'guardian', kind: 'clarify', note: fence.problem, ...(fence.chips.length ? { chips: true as const } : {}) }
    return { gate: 'guardian', kind: 'action' }
  }

  if (isLidoGuidedAsk(message)) return { gate: 'lido', kind: 'action', note: 'guided' }
  const lido = parseLidoStake(message)
  if (lido) return 'problem' in lido ? { gate: 'lido', kind: 'clarify', note: lido.problem } : { gate: 'lido', kind: 'action' }

  const hl = parseHlIntent(message)
  // An unsized open answers size chips (resumes round-trip into full orders).
  if (hl) return hl.kind === 'open-unsized' ? { gate: 'hyperliquid', kind: 'clarify', note: 'unsized → size chips' } : { gate: 'hyperliquid', kind: 'action' }

  const rb = parseRobinhoodBridge(message)
  if (rb) return 'problem' in rb ? { gate: 'rh-bridge', kind: 'clarify', note: rb.problem } : { gate: 'rh-bridge', kind: 'action' }

  if (mentionsNft(message)) {
    // The READ half runs first in the route (gallery, then the market reads),
    // and both always answer with a live artifact — never a clarify.
    if (parseNftListAsk(message)) return { gate: 'nft-gallery', kind: 'action', note: 'wallet gallery read' }
    const nftMarket = parseNftMarketAsk(message)
    if (nftMarket) return { gate: 'nft-market', kind: 'action', note: nftMarket.kind }
    const nft = parseNftAsk(message)
    if (nft) return nft.kind === 'problem' ? { gate: 'nft', kind: 'clarify', note: (nft as { problem?: string }).problem } : { gate: 'nft', kind: 'action', note: nft.kind }
  }

  const tr = parseTransferSegment(message, { fallbackChainId: null })
  if (tr) return 'problem' in tr ? { gate: 'transfer', kind: 'clarify', note: tr.problem } : { gate: 'transfer', kind: 'action' }

  // "what stocks can I buy on robinhood" — the stock-list READ sits right
  // before the swap gate in the route (a live list + buy chips; never the
  // planner's brokerage prose).
  if (parseStockListAsk(message)) return { gate: 'stock-list', kind: 'action', note: '4663 list + buy chips' }

  const sw = parseSwapIntent(message)
  const xcEarly = detectCrossChain(message)
  if (sw.isSwap || xcEarly.crossChain) {
    const xc = xcEarly
    const foreign = !xc.crossChain && xc.chains.length === 1 && !NATIVE_CHAINS.has(xc.chains[0])
    if (xc.crossChain || foreign) {
      const cc = parseCrossChainSwap(message)
      if (cc && 'problem' in cc) return { gate: 'cross-chain', kind: 'clarify', note: cc.problem }
      if (cc) return { gate: 'cross-chain', kind: 'action', note: `${cc.amount} ${cc.originToken} ${cc.originChain}→${cc.destinationChain}` }
      return { gate: 'cross-chain', kind: 'planner', note: 'cross-chain-shaped, no imperative parse' }
    }
    if (!sw.isSwap) return { gate: 'planner', kind: 'planner' }
    if (sw.problem) return { gate: 'swap', kind: 'clarify', note: sw.problem }
    // Non-EVM homes refuse by name with the Hyperliquid side chips (the
    // route's nonEvmHomeDoor) — before any pricing touches a Base squat.
    const home = tokenHome(sw.buyToken) ?? tokenHome(sw.sellToken)
    if (sw.mode !== 'limit' && home) return { gate: 'swap', kind: 'clarify', note: `${(tokenHome(sw.buyToken) ? sw.buyToken : sw.sellToken)!.toUpperCase()} lives on ${home} — HL door` }
    return { gate: 'swap', kind: 'action', note: `${sw.sellAll ? 'all (sized live)' : (sw.sellAmountHuman ?? '$' + sw.sellAmountUsd)} ${sw.sellToken ?? '(stable)'}→${sw.buyToken ?? '(stable)'}` }
  }

  return { gate: 'planner', kind: 'planner' }
}
