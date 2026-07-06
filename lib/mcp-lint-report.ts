// Client-safe half of the routability linter (RR14): the report types +
// the Claude Code upgrade-prompt builder. NO server imports — the panel
// component renders these in the browser; lib/mcp-lint.ts (server) does
// the actual linting and re-exports these for callers that have both.

export interface Check {
  ok: boolean
  note: string
}
export interface Dimension {
  key: 'schema' | 'description' | 'probe' | 'planner' | 'affordances'
  weight: number
  /** 0..1 within the dimension; null = skipped (reweighted out). */
  score: number | null
  checks: Check[]
}
export interface RoutabilityReport {
  slug: string
  name: string
  score: number // 0..100 over non-skipped dimensions
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  dimensions: Dimension[]
  fixes: string[]
  lintedAt: string
}

/**
 * A copy-paste prompt for Claude Code that turns the lint report into an
 * UPGRADE session on the MCP's own codebase — the "fix it with Claude Code"
 * section of the routability panel. Self-contained: carries the failing
 * checks, the fix list, and the conventions the linter grades against, so
 * the MCP developer needs zero Yeetful context to act on it.
 */
export function buildUpgradePrompt(report: RoutabilityReport): string {
  const failing = report.dimensions
    .filter((d) => d.score !== null && d.score < 1)
    .map((d) => {
      const bad = d.checks.filter((c) => !c.ok).map((c) => `  - ${c.note}`)
      return bad.length ? `${d.key} (${Math.round((d.score ?? 0) * 100)}%):\n${bad.join('\n')}` : null
    })
    .filter(Boolean)
    .join('\n')

  return [
    `You are upgrading the MCP service "${report.name}" so an AI router can reliably discover, choose, and call its tools. Yeetful's Reason Router just graded it ${report.score}/100 (${report.grade}). I'll point you at the service's codebase; audit it against the findings below and implement the fixes.`,
    '',
    '## Failing checks',
    failing || '(all dimension checks passed — only polish remains)',
    '',
    '## Fixes, in priority order',
    ...report.fixes.map((f, i) => `${i + 1}. ${f}`),
    '',
    '## The conventions to build to (what the router needs)',
    '- **Param schemas on every tool/endpoint**: name, type, required-vs-optional, and a description per param. A router refuses to construct calls it cannot validate — schema-less endpoints are invisible.',
    "- **Descriptions that carry user intent**: write what a USER would ask ('crypto spot price by symbol — price of ETH, BTC…'), never what the URL is. Include 2–3 example queries.",
    "- **One guarded escape hatch instead of endless params**: if the backend has a native query language (GraphQL/SQL), expose ONE read-only general-query tool with strict guardrails (single read-only operation, allowlisted root fields, depth + page-size caps, response truncation) and a compact schema card in the tool description (root fields + useful filters + one example). Long-tail intents then need no new endpoints.",
    "- **Declare user-identity params**: any param that should be the CALLER's own address (their votes, follows, balances, orders) must say so in its description ('the user's own wallet address') so routers can inject identity server-side instead of guessing.",
    '- **Server-side joins for the headline intent**: if answering the #1 user question takes two chained calls (e.g. resolve follows → filter proposals), add one param that does the join server-side.',
    "- **Build, don't execute**: anything signable returns an UNSIGNED payload (typed data / tx template) for the user's own wallet. Never hold keys, never sign, never submit on the user's behalf.",
    '- **Free tiers still need rate limiting**: no payment gate means no natural throttle.',
    '',
    'Start by reading the tool/endpoint definitions and their input schemas, then apply the fixes smallest-first. After each change, restate which failing check it clears.',
  ].join('\n')
}
