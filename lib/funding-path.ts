// ─────────────────────────────────────────────────────────────────────────
//  Funding-path visualization (pure, client-safe) — turn a funding chip's
//  resume string into a drawable route the user can SEE before picking.
//
//  The resume string IS the contract (every funding chip round-trips the
//  jobs compiler), so the path is DERIVED from it rather than shipped as a
//  parallel payload: persisted messages, the embed, and every present and
//  future chip site visualize for free, and the drawing can never drift
//  from what the click actually runs. A resume that stops parsing simply
//  falls back to a plain text chip — and the harness fails loudly, because
//  every planner-emitted chip is pinned to parse here.
//
//  Grammar covered (the exact shapes the planners emit — lib/lifi-bridge's
//  fundSegment + advice donor leg, lib/funding-plan's legResume /
//  gasLegResume / planStrandedRescue):
//    "Fund robinhood chain with $14 from base[ using usdc.e][ including gas]"
//    "Swap 12.5 USDC from Base to ETH on Arbitrum"   (cross-chain leg)
//    "swap 0.001 ETH from ethereum to base"          (plain move / gas topup)
//    "Swap 12 USDC for ETH on Base"                  (same-chain venue swap)
//  Anything else ends the funding legs: the remainder (joined back with
//  ", then ") is the ACTION node — "buy $12 of AAPL", "stake …", etc.
// ─────────────────────────────────────────────────────────────────────────

export interface FundingPathNode {
  /** 'chain' = a wallet location the money passes through; 'action' = the
   *  goal the legs exist for (the follow-up ask). */
  kind: 'chain' | 'action'
  /** Display title ("Base", "Robinhood Chain", "Buy $12 of AAPL"). */
  title: string
  /** What departs from / arrives at this stop ("12.5 USDC", "USDG + gas"). */
  detail?: string
}

export interface FundingPath {
  /** At least 2 nodes; arrows[i] labels the hop nodes[i] → nodes[i+1]. */
  nodes: FundingPathNode[]
  arrows: string[]
}

/** Chain words as the resumes spell them → display titles. Kept local so
 *  the module stays client-safe (no server-lib imports); the harness pins
 *  every planner chain word to resolve here. */
const CHAIN_DISPLAY: Record<string, string> = {
  base: 'Base',
  ethereum: 'Ethereum',
  mainnet: 'Ethereum',
  arbitrum: 'Arbitrum',
  arb: 'Arbitrum',
  robinhood: 'Robinhood Chain',
  'robinhood chain': 'Robinhood Chain',
}

const chainDisplay = (word: string): string | null => CHAIN_DISPLAY[word.trim().toLowerCase()] ?? null

/** "usdc" → "USDC", but bridged variants keep their conventional casing
 *  ("usdc.e" → "USDC.e", never "USDC.E"). */
const tokenDisplay = (raw: string): string => raw.toUpperCase().replace(/\.E$/, '.e')

/** One parsed leg — from-stop, arrow label, to-stop. */
interface PathEdge {
  from: FundingPathNode
  label: string
  to: FundingPathNode
}

const chainNode = (title: string, detail?: string): FundingPathNode => ({ kind: 'chain', title, detail })

/** Parse ONE funding segment into an edge, or null when the segment isn't a
 *  funding leg (which ends the leg run — see fundingPathOf). */
function parseSegment(seg: string): PathEdge | null {
  // "Fund robinhood chain with $14 from base[ using usdc.e][ including gas]"
  const fund = seg.match(/^fund robinhood chain with \$([\d.,]+) from ([a-z][a-z ]*?)(?: using ([a-z0-9.]+))?( including gas)?$/i)
  if (fund) {
    const from = chainDisplay(fund[2])
    if (!from) return null
    const token = tokenDisplay(fund[3] ?? 'USDC')
    return {
      from: chainNode(from, `$${fund[1]} ${token}`),
      label: 'bridge',
      to: chainNode('Robinhood Chain', fund[4] ? 'USDG + gas' : 'USDG'),
    }
  }
  // "Swap 12.5 USDC from Base to ETH on Arbitrum" — the amount leaves the
  // origin as one token and arrives on the destination as another (or the
  // same). Matched BEFORE the plain move: this shape has the " on <chain>".
  const cross = seg.match(/^swap ([\d.,]+) ([a-z0-9.]+) from ([a-z][a-z ]*?) to ([a-z0-9.]+) on ([a-z][a-z ]*)$/i)
  if (cross) {
    const from = chainDisplay(cross[3])
    const to = chainDisplay(cross[5])
    if (!from || !to) return null
    const sell = tokenDisplay(cross[2])
    const buy = tokenDisplay(cross[4])
    return {
      from: chainNode(from, `${cross[1]} ${sell}`),
      label: sell === buy ? 'bridge' : 'bridge + swap',
      to: chainNode(to, buy),
    }
  }
  // "swap 0.001 ETH from ethereum to base" — a plain cross-chain move (the
  // gas-topup donor leg and the generic cc segment): same token, new chain.
  const move = seg.match(/^swap ([\d.,]+) ([a-z0-9.]+) from ([a-z][a-z ]*?) to ([a-z][a-z ]*)$/i)
  if (move) {
    const from = chainDisplay(move[3])
    const to = chainDisplay(move[4])
    if (!from || !to) return null
    const token = tokenDisplay(move[2])
    return { from: chainNode(from, `${move[1]} ${token}`), label: 'bridge', to: chainNode(to, token) }
  }
  // "Swap 12 USDC for ETH on Base" — a same-chain venue swap.
  const same = seg.match(/^swap ([\d.,]+) ([a-z0-9.]+) for ([a-z0-9.]+) on ([a-z][a-z ]*)$/i)
  if (same) {
    const chain = chainDisplay(same[4])
    if (!chain) return null
    return {
      from: chainNode(chain, `${same[1]} ${tokenDisplay(same[2])}`),
      label: 'swap',
      to: chainNode(chain, tokenDisplay(same[3])),
    }
  }
  return null
}

/**
 * Derive the drawable route from a chip's resume string. Null when the
 * resume opens with anything other than a funding leg — "Not now" chips,
 * plain planner clarifies, and vote options all stay plain text.
 *
 * Legs parse left-to-right; the first non-leg segment and everything after
 * it collapse into ONE action node (a follow-up may itself contain
 * ", then" — the HL funded ask does). Consecutive stops on the same chain
 * fold together, so a donor-topup job reads
 * Ethereum → Base → Robinhood Chain → Buy … rather than repeating Base.
 */
export function fundingPathOf(resume: string): FundingPath | null {
  const segments = resume.split(/,\s*then\s+/i).map((s) => s.trim()).filter(Boolean)
  const nodes: FundingPathNode[] = []
  const arrows: string[] = []
  let i = 0
  for (; i < segments.length; i++) {
    const edge = parseSegment(segments[i])
    if (!edge) break
    const tail = nodes[nodes.length - 1]
    if (tail && tail.title === edge.from.title) {
      // Fold: the leg departs where the previous one landed. The DEPARTING
      // detail wins — a donor-topup job should read Ethereum [0.001 ETH] →
      // Base [$14 USDC] → Robinhood Chain, not repeat the ETH that landed.
      if (edge.from.detail) tail.detail = edge.from.detail
    } else {
      if (tail) arrows.push('then')
      nodes.push(edge.from)
    }
    arrows.push(edge.label)
    nodes.push(edge.to)
  }
  if (nodes.length === 0) return null
  if (i < segments.length) {
    const action = segments.slice(i).join(', then ')
    arrows.push('then')
    nodes.push({ kind: 'action', title: action.charAt(0).toUpperCase() + action.slice(1) })
  }
  return { nodes, arrows }
}
