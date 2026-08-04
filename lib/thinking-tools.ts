// ─────────────────────────────────────────────────────────────────────────
//  The thinking tools — Pantessa's OWN reasoning helpers, named.
//
//  This registry is the `yeetful-tool-*` naming pass (board card B4): the
//  router's decisions have always streamed as raw trace events
//  (analyze/shortlist/select/tool/…); here each decision gets a stable,
//  user-facing tool name so /tools, the chat terminal, and eventually the SDK
//  all narrate the machine the same way. Presentation names only — nothing
//  here changes routing behavior.
// ─────────────────────────────────────────────────────────────────────────

export interface ThinkingTool {
  id: string
  /** The stable public name, e.g. `yeetful-tool-server-picker`. */
  name: string
  /** What this tool decides, in one sentence. */
  decides: string
  /** input → output signature, terminal style. */
  signature: string
  /** Where it lives in the codebase (shown as provenance, not a link). */
  home: string
}

export const THINKING_TOOLS: ThinkingTool[] = [
  {
    id: 'server-picker',
    name: 'yeetful-tool-server-picker',
    decides: 'Which MCP answers this message — shortlist the catalog, rank by keyword + vector + reputation, pick.',
    signature: 'message + saved MCPs → the one server to use',
    home: 'lib/router.ts · lib/retrieval.ts (hybridShortlist, RRF)',
  },
  {
    id: 'endpoint-picker',
    name: 'yeetful-tool-endpoint-picker',
    decides: 'Which tool on the picked MCP, with which arguments. The planner proposes; deterministic code builds the request and refuses ambiguity.',
    signature: 'server + intent → endpoint + validated args',
    home: 'lib/endpoint-planner.ts (menu → pick → buildSmartRequest)',
  },
  {
    id: 'resolve-space',
    name: 'yeetful-tool-resolve-space',
    decides: 'Turns a DAO name into its governance space — "Nate DAO" → nategeier.dcl.eth. One match continues silently; several become a question.',
    signature: 'dao name → snapshot space id',
    home: 'lib/governance.ts (resolveSpaceByName)',
  },
  {
    id: 'resolve-token',
    name: 'yeetful-tool-resolve-token',
    decides: 'Turns a token symbol into its canonical Base address — merged official Uniswap + Coingecko lists, no guessed addresses ever.',
    signature: 'symbol → 0x… on Base',
    home: 'lib/token-list.ts (merged official lists)',
  },
  {
    id: 'venue-picker',
    name: 'yeetful-tool-venue-picker',
    decides: 'Where a swap executes — CoW by default (solver-routed, MEV-protected), Uniswap when you name it.',
    signature: 'swap intent → CoW | Uniswap',
    home: 'app/api/chat (swap fast-path) · lib/cow-build.ts · lib/uniswap-venue.ts',
  },
  {
    id: 'guardrails',
    name: 'yeetful-tool-guardrails',
    decides: 'Checks every transaction before it reaches your wallet: recipient, min-out, balance, allowance, validity. Signables break the loop — nothing auto-executes.',
    signature: 'built tx → sign button or refusal',
    home: 'lib/tx-guardrails.ts · lib/cow-guardrails.ts',
  },
  {
    id: 'policy-gate',
    name: 'yeetful-tool-policy-gate',
    decides: 'Allow or deny every spend against your grant — allowlist, per-call, per-day, lifetime caps. One gate, every path; denials are ledgered, not swallowed.',
    signature: 'payment attempt → allow | deny (receipted)',
    home: 'lib/spend-grant.ts (checkGrant)',
  },
  {
    id: 'house-synthesizer',
    name: 'yeetful-tool-house-synthesizer',
    decides: 'Who writes the answer when no paid inference is in scope — the house model, at $0, over fresh tool results.',
    signature: 'tool results → the answer ($0.00)',
    home: 'app/api/chat (HOUSE_INFERENCE)',
  },
]

export const toolById = (id: string): ThinkingTool | undefined =>
  THINKING_TOOLS.find((t) => t.id === id)

// ── trace-line → tool attribution ────────────────────────────────────────
// Maps an existing RouterTraceEvent (as persisted in route_trace_lines) to
// the thinking tool that produced it. This is the legibility layer over the
// SSE stream — analyze/shortlist/select/tool/eip712 → named yeetful tools.

interface TraceEventish {
  type?: string
  reason?: string
  name?: string
  label?: string
  receipt?: { name?: string }
}

export function toolIdForTraceEvent(event: unknown): string | null {
  const e = (event ?? {}) as TraceEventish
  switch (e.type) {
    case 'analyze':
    case 'shortlist':
    case 'candidate':
      return 'server-picker'
    case 'select':
      return /endpoint|planner/i.test(e.reason ?? '') ? 'endpoint-picker' : 'server-picker'
    case 'tool': {
      const n = (e.name ?? '').toLowerCase()
      if (n.includes('resolve_space') || n.includes('resolve-space')) return 'resolve-space'
      if (n.includes('token')) return 'resolve-token'
      return null // the MCP itself doing the work, not a yeetful tool
    }
    case 'pay':
      return 'policy-gate' // a pay line means checkGrant already said yes
    case 'eip712':
      return 'guardrails' // a sign surface only exists once guardrails passed
    case 'receipt':
      return /house/i.test(e.receipt?.name ?? '') ? 'house-synthesizer' : null
    case 'status':
      return /synthes|writing|answer/i.test(e.label ?? '') ? 'house-synthesizer' : null
    default:
      return null
  }
}

// ── /api/tools/stats payload ─────────────────────────────────────────────

export interface ToolRunRow {
  name: string
  runs: number
  example: string | null
}

export interface FlowRow {
  category: string
  service: string
  ok: boolean
  calls: number
  usd: number
}

export interface ToolsStats {
  /** trace-line counts by type, current 2-day window */
  trace: { type: string; n: number }[]
  /** deterministic sub-step runs (resolve_space etc.), 2-day window */
  toolRuns: ToolRunRow[]
  /** recent planner/server picks, newest first */
  selects: { service: string; reason: string | null; priceUsd: string | null; at: string }[]
  /** the latest routed turn, full ordered trace (for the anatomy panel) */
  latestTurn: { turnId: string; payer: string | null; lines: unknown[] } | null
  /** all-time ledger flow: category → service, settled vs denied */
  flow: FlowRow[]
  events: { turns: number; settled: number; blocked: number; costUsd: number }
  incidents: { status: string; n: number }[]
  endpoints: { total: number; withParams: number; embedded: number }
  generatedAt: string
}

export const EMPTY_TOOLS_STATS: ToolsStats = {
  trace: [],
  toolRuns: [],
  selects: [],
  latestTurn: null,
  flow: [],
  events: { turns: 0, settled: 0, blocked: 0, costUsd: 0 },
  incidents: [],
  endpoints: { total: 0, withParams: 0, embedded: 0 },
  generatedAt: '',
}

// ── the self-updating scoreboard (eval history) ──────────────────────────
// Numbers from ARCHITECTURE-reason-router.md Appendix A — each point is a
// shipped retrieval/planner change measured on the routing eval. Static by
// design: the eval runs offline; the page shows its trajectory.

export const EVAL_HISTORY = [
  { label: 'keyword v1', recallAtShortlist: 57 },
  { label: '+ tags & examples', recallAtShortlist: 67 },
  { label: 'hybrid RRF (pgvector)', recallAtShortlist: 87 },
  { label: '+ crowding rerank', recallAtShortlist: 93 },
] as const

export const EVAL_ANSWERED_AT_FULL = 77
