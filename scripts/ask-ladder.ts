/**
 * The PURE replica of the chat route's native-gate ladder, shared by the
 * costless audits (audit-asks.ts replays surfaced example asks through it;
 * audit-funding.ts replays funding-chip resume strings). Mirrors
 * app/api/chat/route.ts gate ORDER (vote → aave → dca → jobs → guardian →
 * lido → hyperliquid → robinhood bridge → nft → transfer →
 * swap/cross-chain) with the working set assumed to be ALL free MCPs
 * (usable), no chain picker, no pending context. Route-level gating that
 * needs live data (stock-list warm, balances) is approximated — this
 * simulates PARSE outcomes, not builds. Keep it the ONLY replica: new
 * gates land here once, both audits inherit them.
 */
import { parseVoteIntent } from '../lib/vote-intent'
import { parseAaveSupply, parseAaveOp } from '../lib/aave-supply'
import { parseDcaRun, parseDcaCreate, parseDcaManage } from '../lib/dca'
import { compileJobAsk } from '../lib/jobs'
import { parseGuardianArm } from '../lib/hl-guardian'
import { isLidoGuidedAsk, parseLidoStake } from '../lib/lido-stake'
import { parseHlIntent } from '../lib/hyperliquid-exec'
import { parseRobinhoodBridge } from '../lib/robinhood-bridge'
import { mentionsNft, parseNftAsk } from '../lib/nft-layer'
import { parseTransferSegment } from '../lib/transfer-exec'
import { parseSwapIntent, detectCrossChain } from '../lib/swap-intent'
import { parseCrossChainSwap } from '../lib/cross-chain-swap'

export type Kind = 'action' | 'clarify' | 'planner'
export interface Outcome {
  gate: string
  kind: Kind
  note?: string
}

const NATIVE_CHAINS = new Set(['base', 'ethereum', 'arbitrum', 'robinhood'])

/** Pure replica of the route ladder — same order, all free MCPs active. */
export function simulateLadder(message: string): Outcome {
  const vote = parseVoteIntent(message)
  if (vote.isVote) return { gate: 'vote', kind: 'action' }

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
  if (dc) return 'problem' in dc ? { gate: 'dca', kind: 'clarify', note: dc.problem } : { gate: 'dca', kind: 'action' }
  const dm = parseDcaManage(message)
  if (dm) return { gate: 'dca', kind: 'action', note: dm.op }

  const job = compileJobAsk(message)
  if (job) {
    if ('problem' in job) return { gate: 'jobs', kind: 'clarify', note: job.problem }
    if ('clarify' in job) return { gate: 'jobs', kind: 'clarify', note: String((job as { clarify: unknown }).clarify) }
    return { gate: 'jobs', kind: 'action', note: `${(job as { steps: unknown[] }).steps?.length ?? '?'} steps` }
  }

  if (parseGuardianArm(message)) return { gate: 'guardian', kind: 'action' }
  if (isLidoGuidedAsk(message)) return { gate: 'lido', kind: 'action', note: 'guided' }
  const lido = parseLidoStake(message)
  if (lido) return 'problem' in lido ? { gate: 'lido', kind: 'clarify', note: lido.problem } : { gate: 'lido', kind: 'action' }

  if (parseHlIntent(message)) return { gate: 'hyperliquid', kind: 'action' }

  const rb = parseRobinhoodBridge(message)
  if (rb) return 'problem' in rb ? { gate: 'rh-bridge', kind: 'clarify', note: rb.problem } : { gate: 'rh-bridge', kind: 'action' }

  if (mentionsNft(message)) {
    const nft = parseNftAsk(message)
    if (nft) return nft.kind === 'problem' ? { gate: 'nft', kind: 'clarify', note: (nft as { problem?: string }).problem } : { gate: 'nft', kind: 'action', note: nft.kind }
  }

  const tr = parseTransferSegment(message, { fallbackChainId: null })
  if (tr) return 'problem' in tr ? { gate: 'transfer', kind: 'clarify', note: tr.problem } : { gate: 'transfer', kind: 'action' }

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
    return { gate: 'swap', kind: 'action', note: `${sw.sellAmountHuman ?? '$' + sw.sellAmountUsd} ${sw.sellToken ?? '(stable)'}→${sw.buyToken}` }
  }

  return { gate: 'planner', kind: 'planner' }
}
