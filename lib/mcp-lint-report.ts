// Client-safe half of the routability linter (RR14): the report types +
// the Claude Code upgrade-prompt builder. NO server imports — the panel
// component renders these in the browser; lib/mcp-lint.ts (server) does
// the actual linting and re-exports these for callers that have both.
//
// The "conventions to build to" now live in lib/routable-mcp.ts (the single
// source shared with /docs/routable-mcp and the embed self-heal card) so the
// contract never drifts between the score panel and the analytics prompt.

import { conventionsAsPromptLines, ROUTABLE_MCP_DOC_URL } from '@/lib/routable-mcp'

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
    `## The conventions to build to (what the router needs) — full spec: ${ROUTABLE_MCP_DOC_URL}`,
    ...conventionsAsPromptLines(),
    '',
    'Start by reading the tool/endpoint definitions and their input schemas, then apply the fixes smallest-first. After each change, restate which failing check it clears.',
  ].join('\n')
}
