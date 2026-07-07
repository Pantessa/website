// Splash sources: for each connected MCP, how to turn its "overview" read tool
// into a SplashTile. THE scalability seam — a new MCP is one entry here, no new
// API route and (if it reuses a render primitive) no new frontend.
//
// Each source: match a connected server, call ≤1 read tool with the connected
// address, shape the result into a tile + suggested prompts. Failures are
// isolated per source (buildSplash filters nulls) so one dead MCP never blanks
// the whole splash.

import type { McpServer } from '@/lib/store'
import { callMcpTool } from '@/lib/mcp-call'
import { overrideFreeMcpBase } from '@/lib/endpoint-planner'
import type { HoldingRow, ProposalRow, SpaceRow, SplashTile, SuggestedPrompt } from './types'

/** Snapshot's stamp service resolves a space logo from its id — always
 *  available, no IPFS gateway flakiness. */
const spaceLogo = (spaceId: string) => `https://cdn.stamp.fyi/space/${encodeURIComponent(spaceId)}?s=96`

type McpCaller = (name: string, args: Record<string, unknown>) => Promise<unknown>

interface SplashSource {
  id: string
  /** Does this source apply to a connected server? */
  match: (s: McpServer) => boolean
  /** Build a tile (or null to contribute nothing). `call` is bound to this
   *  server's endpoint; `address` is the connected wallet. */
  build: (call: McpCaller, address: string, server: McpServer) => Promise<SplashTile | null>
}

// ── Uniswap → portfolio (holdings) ──────────────────────────────────────────

interface PortfolioPayload {
  totalUsd: number
  holdings: HoldingRow[]
  chainId: number
}

const uniswapSource: SplashSource = {
  id: 'uniswap',
  match: (s) => s.slug === 'uniswap' || s.slug === 'uniswap-free' || /uniswap/i.test(s.name),
  build: async (call, address, server) => {
    const data = (await call('balances', { owner: address })) as PortfolioPayload
    const holdings = Array.isArray(data.holdings) ? data.holdings : []
    const base = { id: 'uniswap-holdings', mcpSlug: server.slug, mcpName: server.name }
    if (holdings.length === 0) {
      return {
        ...base,
        render: 'empty',
        title: 'Your Base portfolio',
        message: 'No tokens found on Base for this wallet.',
        prompts: [{ label: 'Get a quote', prompt: 'What would it cost to swap 100 USDC into ETH on Base?' }],
      }
    }
    // Suggested prompts derived from what they actually hold.
    const prompts: SuggestedPrompt[] = []
    const stable = holdings.find((h) => /^(USDC|DAI|USDbC)$/i.test(h.symbol) && (h.valueUsd ?? 0) >= 10)
    if (stable) {
      const amt = Math.min(Math.floor(Number(stable.balance)), 100) || 1
      prompts.push({ label: `Put ${stable.symbol} to work`, prompt: `Swap ${amt} ${stable.symbol} into ETH on Base` })
    }
    const eth = holdings.find((h) => h.symbol === 'ETH' && (h.valueUsd ?? 0) >= 5)
    if (eth) prompts.push({ label: 'Best swap for my ETH', prompt: 'What is the best swap I could make with my ETH right now?' })
    const top = holdings.find((h) => !/^(USDC|DAI|USDbC|ETH|WETH)$/i.test(h.symbol) && (h.valueUsd ?? 0) >= 1)
    if (top) prompts.push({ label: `Sell my ${top.symbol}`, prompt: `Quote selling all my ${top.symbol} for USDC on Base` })
    if (prompts.length === 0) prompts.push({ label: 'Review my holdings', prompt: 'What can I do with the tokens in my wallet?' })

    return {
      ...base,
      render: 'holdings',
      title: 'Your Base portfolio',
      subtitle: `via ${server.name}`,
      chain: 'Base',
      totalUsd: typeof data.totalUsd === 'number' ? data.totalUsd : null,
      holdings: holdings.slice(0, 8),
      prompts: prompts.slice(0, 3),
    }
  },
}

// ── Snapshot → open proposals in followed spaces ─────────────────────────────

interface SnapshotProposal {
  id: string
  title: string
  choices: string[]
  scores?: number[]
  end: number
  space: { id: string; name: string }
}

const snapshotSource: SplashSource = {
  id: 'snapshot',
  match: (s) => /snapshot/i.test(`${s.slug} ${s.name}`),
  build: async (call, address, server) => {
    const data = (await call('list_proposals', { follower: address, state: 'active', first: 12 })) as {
      proposals?: SnapshotProposal[]
      note?: string
    }
    const raw = Array.isArray(data.proposals) ? data.proposals : []
    const base = { id: 'snapshot-proposals', mcpSlug: server.slug, mcpName: server.name }
    if (raw.length === 0) {
      return {
        ...base,
        render: 'empty',
        title: 'Governance',
        message: data.note || 'No open proposals in the spaces this wallet follows.',
        prompts: [{ label: 'Find active DAOs', prompt: 'What are the most active DAOs on Snapshot right now?' }],
      }
    }
    const proposals: ProposalRow[] = raw.map((p) => {
      const leadIdx = Array.isArray(p.scores) && p.scores.length
        ? p.scores.reduce((best, s, i, arr) => (s > arr[best] ? i : best), 0)
        : -1
      const hasVotes = Array.isArray(p.scores) && p.scores.some((s) => s > 0)
      return {
        id: p.id,
        title: p.title,
        spaceId: p.space.id,
        spaceName: p.space.name,
        avatarUrl: spaceLogo(p.space.id),
        choices: p.choices ?? [],
        leadingChoice: hasVotes && leadIdx >= 0 ? p.choices[leadIdx] ?? null : null,
        endsAt: p.end,
      }
    })
    // Unique followed spaces (for the logo strip).
    const spaces: SpaceRow[] = [...new Map(proposals.map((p) => [p.spaceId, p])).values()].map((p) => ({
      id: p.spaceId,
      name: p.spaceName,
      avatarUrl: p.avatarUrl,
    }))
    const first = proposals[0]
    const prompts: SuggestedPrompt[] = [
      { label: `Summarize “${truncate(first.title, 32)}”`, prompt: `Summarize the ${first.spaceName} proposal "${first.title}" and tell me what's at stake.` },
      { label: 'What needs my vote?', prompt: 'Which of my open Snapshot proposals should I prioritize, and why?' },
    ]
    if (spaces.length > 1) {
      prompts.push({ label: `${spaces.length} DAOs open`, prompt: `Give me a one-line summary of each open proposal across the ${spaces.length} DAOs I follow.` })
    }
    return {
      ...base,
      render: 'proposals',
      title: 'Proposals to vote on',
      subtitle: `${proposals.length} open · ${spaces.length} ${spaces.length === 1 ? 'space' : 'spaces'} you follow`,
      spaces,
      proposals,
      prompts,
    }
  },
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

/** All registered splash sources. Exported for tests; a new MCP appends here. */
export const SPLASH_SOURCES: SplashSource[] = [uniswapSource, snapshotSource]

/**
 * Build the splash tiles for a connected wallet across the connected MCP set.
 * Runs every matching source in parallel; a source that throws or times out
 * is dropped so one bad MCP can't blank the dashboard.
 */
export async function buildSplash(address: string, servers: McpServer[]): Promise<SplashTile[]> {
  const jobs: Promise<SplashTile | null>[] = []
  for (const server of servers) {
    if (!server.endpoint) continue
    const endpoint = overrideFreeMcpBase(server.endpoint)
    for (const source of SPLASH_SOURCES) {
      if (!source.match(server)) continue
      const call: McpCaller = (name, args) => callMcpTool(endpoint, name, args)
      jobs.push(source.build(call, address, server).catch(() => null))
    }
  }
  const tiles = await Promise.all(jobs)
  return tiles.filter((t): t is SplashTile => t !== null)
}
