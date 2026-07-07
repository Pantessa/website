// ─────────────────────────────────────────────────────────────────────────
//  The Routable MCP spec — ONE source of truth for the conventions a Yeetful
//  router needs, the five things `npm run mcp:lint` grades, and the copy-paste
//  Claude Code prompt that fixes an MCP. Rendered by /docs/routable-mcp, cited
//  by lib/upgrade-prompt.ts (the routability panel + the embed self-heal card).
//
//  CLIENT-SAFE: pure strings/data, no server imports — the panel and the embed
//  insights component render these in the browser. Keep the dimension weights
//  in sync with lib/mcp-lint.ts (the grader).
// ─────────────────────────────────────────────────────────────────────────

import { SITE } from '@/lib/docs'

/** Stable, linkable home for the conventions — cited by every generated prompt. */
export const ROUTABLE_MCP_DOC_URL = `${SITE}/docs/routable-mcp`

/** The five weighted dimensions `npm run mcp:lint` grades (sum = 100). Mirrors
 *  lib/mcp-lint.ts; surfaced verbatim on the spec page and the score panel. */
export const ROUTABILITY_DIMENSIONS: {
  key: 'schema' | 'description' | 'probe' | 'planner' | 'affordances'
  weight: number
  title: string
  question: string
  detail: string
}[] = [
  {
    key: 'schema',
    weight: 25,
    title: 'Param schemas',
    question: 'Can the router construct a call at all?',
    detail:
      'Every tool/endpoint publishes machine-readable parameters — name, type, required-vs-optional, and a one-line description each. The request builder refuses calls it cannot validate, so a schema-less endpoint is invisible to the router.',
  },
  {
    key: 'description',
    weight: 20,
    title: 'Intent descriptions',
    question: 'Can the router FIND the right tool?',
    detail:
      'Descriptions read like a user’s question ("crypto spot price by symbol — price of ETH, BTC…"), never like a URL path. Add 2–3 example queries and tags so retrieval can match a plain-English ask to the tool.',
  },
  {
    key: 'probe',
    weight: 15,
    title: 'Liveness',
    question: 'Does the endpoint actually answer?',
    detail:
      'The linter probes each wired endpoint — a paid one should return a well-formed 402 challenge, a free one a 200. Dead or misconfigured endpoints score zero: the router will not route to what it cannot reach.',
  },
  {
    key: 'planner',
    weight: 30,
    title: 'Planner pick',
    question: 'Does a real router choose and build the call?',
    detail:
      'The heaviest dimension: the actual planner prompt runs against your surface and must both PICK a tool for a representative ask and let the builder CONSTRUCT the request (construction-only, zero spend). If the planner can’t choose or fill params, nothing else matters.',
  },
  {
    key: 'affordances',
    weight: 10,
    title: 'Affordances',
    question: 'Is it safe and identity-aware?',
    detail:
      'User-identity params are declared (so the router injects the caller’s own address instead of guessing), there’s a guarded escape hatch for long-tail intents, and anything signable is built-not-executed — unsigned payloads only, never custody.',
  },
]

/** The canonical conventions — the "build to this" contract. Kept as data so the
 *  spec page and the generated prompts render the SAME list. */
export const ROUTABLE_MCP_CONVENTIONS: { title: string; body: string }[] = [
  {
    title: 'Param schemas on every tool',
    body:
      'name, type, required-vs-optional, and a description per param. A router refuses to construct calls it cannot validate — schema-less endpoints are invisible.',
  },
  {
    title: 'Descriptions that carry user intent',
    body:
      "Write what a USER would ask ('crypto spot price by symbol — price of ETH, BTC…'), never what the URL is. Include 2–3 example queries.",
  },
  {
    title: 'One guarded escape hatch instead of endless params',
    body:
      'If the backend has a native query language (GraphQL/SQL), expose ONE read-only general-query tool with strict guardrails (single read-only operation, allowlisted root fields, depth + page-size caps, response truncation) and a compact schema card in the tool description. Long-tail intents then need no new endpoints.',
  },
  {
    title: 'Declare user-identity params',
    body:
      "Any param that should be the CALLER's own address (their votes, follows, balances, orders) must say so in its description ('the user's own wallet address') so routers can inject identity server-side instead of guessing.",
  },
  {
    title: 'Server-side joins for the headline intent',
    body:
      'If answering the #1 user question takes two chained calls (e.g. resolve follows → filter proposals), add one param that does the join server-side.',
  },
  {
    title: "Build, don't execute",
    body:
      "Anything signable returns an UNSIGNED payload (typed data / tx template) for the user's own wallet. Never hold keys, never sign, never submit on the user's behalf.",
  },
  {
    title: 'Free tiers still need rate limiting',
    body: 'No payment gate means no natural throttle. @yeetful/mcp-kit ships a per-IP limiter and a clean /mcp handler.',
  },
]

/** The conventions as prompt bullet lines — shared by every generated prompt so
 *  the "build to this" contract never drifts between the panel and the card. */
export function conventionsAsPromptLines(): string[] {
  return ROUTABLE_MCP_CONVENTIONS.map((c) => `- **${c.title}**: ${c.body}`)
}

/** A health-grounded upgrade prompt for the /health cockpit — carries the
 *  MCP's live health signals (score, weakest lever, unresolved failures) so the
 *  fix targets what analytics say is actually broken, then the conventions. */
export function buildHealthUpgradePrompt(input: {
  name: string
  health: number | null
  status: string
  headline: string
  incidents: { open: number; occurrences: number; topTitle: string | null }
  routabilityGrade?: string | null
}): string {
  const inc = input.incidents
  const incLine =
    inc.open > 0
      ? `Live traffic shows ${inc.occurrences} unresolved failure${inc.occurrences === 1 ? '' : 's'} across ${inc.open} incident${inc.open === 1 ? '' : 's'}${inc.topTitle ? ` (worst: ${inc.topTitle})` : ''}.`
      : 'No hard failures logged — the gap is discovery/construction, not crashes.'
  return [
    `Improve the MCP service "${input.name}". Yeetful scores its health ${input.health ?? '—'}/100 (${input.status})${input.routabilityGrade ? `, routability grade ${input.routabilityGrade}` : ''}.`,
    `Weakest lever: ${input.headline}. ${incLine}`,
    '',
    `Make it routable so an AI agent router can discover, choose, and call its tools. Full spec: ${ROUTABLE_MCP_DOC_URL}`,
    '',
    'Audit this codebase against the conventions below and fix the weakest lever first:',
    '',
    ...conventionsAsPromptLines(),
    '',
    'After each change, restate which convention it satisfies and whether it addresses the weakest lever above.',
  ].join('\n')
}

/** A self-contained, report-free Claude Code prompt to make ANY MCP routable —
 *  the /docs/routable-mcp copy button. When a lint report or live analytics
 *  exist, lib/upgrade-prompt.ts prepends the concrete findings to this. */
export const ROUTABLE_MCP_CLAUDE_PROMPT = [
  'Make this MCP server routable by an AI agent router (Yeetful’s Reason Router).',
  '',
  'The goal: an agent should be able to DISCOVER the right tool from a plain-English',
  'ask, CONSTRUCT a valid call to it, and (for anything signable) get back an unsigned',
  `payload the user's own wallet signs. Full spec: ${ROUTABLE_MCP_DOC_URL}`,
  '',
  'Audit this codebase against the conventions below and implement the fixes,',
  'smallest-first, asking me to confirm anything ambiguous:',
  '',
  ...conventionsAsPromptLines(),
  '',
  'Then self-check: for the top 3 things a user would ask this MCP, confirm a tool',
  'exists, its description matches the ask, and its params are fully schema’d. Restate',
  'which convention each change satisfies. If the service exposes a free (non-paid)',
  'tier, make sure @yeetful/mcp-kit (or an equivalent) rate-limits it.',
].join('\n')
