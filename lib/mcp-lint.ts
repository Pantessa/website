// ─────────────────────────────────────────────────────────────────────────
//  MCP routability lint (RR14) — the shared core behind `npm run mcp:lint`
//  (scripts/mcp-lint.ts) and the server page's Run-diagnostics button
//  (POST /api/servers/[slug]/lint). See §1d of ARCHITECTURE-reason-router.md
//  for the design; the CLI header documents the dimensions + weights.
// ─────────────────────────────────────────────────────────────────────────
import prisma from '@/lib/db'
import {
  loadPlannableEndpoints,
  plannerPrompt,
  parsePlannerPicks,
  buildSmartRequest,
  deriveDescription,
  isEscapeHatchEndpoint,
  type PlannableEndpoint,
} from '@/lib/endpoint-planner'

const PLANNER_MODEL = process.env.PLANNER_MODEL || 'claude-haiku-4-5-20251001'
const LINT_USER_ADDRESS = '0x0000000000000000000000000000000000000001' // construction-only dummy
const PROBE_CAP = 5
const QUESTION_CAP = 3

export type { Check, Dimension, RoutabilityReport } from '@/lib/mcp-lint-report'
import type { Check, Dimension, RoutabilityReport } from '@/lib/mcp-lint-report'

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const gradeOf = (score: number): RoutabilityReport['grade'] =>
  score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F'

// ── schema (25): can the router construct calls at all? ─────────────────────
async function schemaDimension(serverId: string, plannable: PlannableEndpoint[], fixes: string[]): Promise<Dimension> {
  const rows = await prisma.mcpEndpoint.findMany({
    where: { serverId },
    select: { url: true, method: true, parameters: true },
  })
  const total = rows.length
  const withParams = rows.filter((r) => Array.isArray(r.parameters) && (r.parameters as unknown[]).length > 0).length
  const checks: Check[] = []

  checks.push({
    ok: plannable.length > 0,
    note: plannable.length > 0 ? `${plannable.length} endpoints are planner-eligible` : 'NO planner-eligible endpoints — the router cannot construct a single call',
  })
  if (plannable.length === 0) fixes.push('Publish machine-readable parameter schemas (name/type/required per param) — without them every call is unconstructable and the service stays listed-only.')

  const coverage = total > 0 ? withParams / total : 0
  checks.push({ ok: coverage >= 0.5, note: `param-schema coverage ${withParams}/${total} endpoints (${Math.round(coverage * 100)}%)` })
  if (total > 0 && coverage < 0.5) fixes.push(`Add param schemas to the ${total - withParams} schema-less endpoints (or retire them) — schema-less POSTs are dead weight in the menu.`)

  // Typed + required-marked params across the plannable surface.
  const params = plannable.flatMap((e) => e.parameters)
  const typed = params.filter((p) => !!p.type).length
  const anyRequired = plannable.filter((e) => e.parameters.length > 0).every((e) => e.parameters.some((p) => p.required !== undefined))
  checks.push({ ok: params.length === 0 || typed / Math.max(params.length, 1) >= 0.8, note: `typed params ${typed}/${params.length}` })
  checks.push({ ok: anyRequired, note: anyRequired ? 'required flags present' : 'no required/optional marking — the planner cannot tell what it must fill' })
  if (!anyRequired && params.length > 0) fixes.push('Mark required vs optional on every parameter — the request builder refuses calls with missing required params, but only if it knows which ones are required.')

  const score = plannable.length === 0 ? 0 : clamp01(0.4 + 0.35 * coverage + 0.15 * (params.length ? typed / params.length : 1) + 0.1 * (anyRequired ? 1 : 0))
  return { key: 'schema', weight: 25, score, checks }
}

// ── description (20): can the router FIND the right tool? ───────────────────
function descriptionDimension(server: { description: string; tags: string[]; exampleQueries: string[] }, plannable: PlannableEndpoint[], fixes: string[]): Dimension {
  const checks: Check[] = []
  const weak: string[] = []
  for (const e of plannable) {
    const d = (e.description ?? '').trim()
    // A description that deriveDescription would have to synthesize (thin) or
    // that reads like a URL path carries no intent signal for retrieval.
    const synthesized = deriveDescription(d.length >= 16 ? d : null, null, e.url) !== d
    const wordy = d.split(/\s+/).length >= 6
    if (!d || synthesized || !wordy || d.length < 40) weak.push(e.url)
  }
  const okShare = plannable.length ? 1 - weak.length / plannable.length : 0
  checks.push({ ok: weak.length === 0 && plannable.length > 0, note: plannable.length ? `${plannable.length - weak.length}/${plannable.length} endpoint descriptions carry real intent` : 'no plannable endpoints to describe' })
  if (weak.length > 0) fixes.push(`Rewrite ${weak.length} endpoint description(s) to say what a USER would ask for ("crypto spot price by symbol — price of ETH, BTC…"), not what the URL is. Weak: ${weak.slice(0, 3).map((u) => u.split('/').slice(-2).join('/')).join(', ')}${weak.length > 3 ? '…' : ''}`)

  const hasTags = server.tags.length > 0
  const hasExamples = server.exampleQueries.length > 0
  checks.push({ ok: hasTags, note: hasTags ? `capability tags: ${server.tags.slice(0, 5).join(', ')}` : 'no capability tags (R1)' })
  checks.push({ ok: hasExamples, note: hasExamples ? `${server.exampleQueries.length} example queries` : 'no example user queries' })
  if (!hasExamples) fixes.push('Add example user queries ("what DAO votes are live?") — they bridge phrasing gaps keyword overlap cannot (and mcp:lint uses them as planner test questions).')

  const score = clamp01(0.6 * okShare + 0.15 * (hasTags ? 1 : 0) + 0.25 * (hasExamples ? 1 : 0))
  return { key: 'description', weight: 20, score, checks }
}

// ── probe (15): is anything alive at the other end? ──────────────────────────
async function probeDimension(plannable: PlannableEndpoint[], fixes: string[]): Promise<Dimension> {
  const checks: Check[] = []
  // One representative per host/base, capped — MCP tool rows share one base.
  const seen = new Set<string>()
  const targets: { url: string; free: boolean }[] = []
  for (const e of plannable) {
    const base = e.url.replace(/[#/][A-Za-z0-9_]+$/, '')
    if (seen.has(base)) continue
    seen.add(base)
    targets.push({ url: e.url, free: e.priceUsd === '0' })
    if (targets.length >= PROBE_CAP) break
  }
  let alive = 0
  for (const t of targets) {
    try {
      const isMcpTool = /\/mcp[#/][A-Za-z0-9_]+$/.test(t.url)
      const probeUrl = isMcpTool ? t.url.replace(/[#/][A-Za-z0-9_]+$/, '') : t.url
      const res = await fetch(probeUrl, {
        method: isMcpTool ? 'POST' : 'GET',
        headers: isMcpTool
          ? { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
          : { accept: 'application/json' },
        body: isMcpTool ? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) : undefined,
        signal: AbortSignal.timeout(8000),
      })
      // Healthy: a 402 challenge (x402 gate up), or 2xx (free/open). 4xx that
      // isn't 402 usually means param validation — the endpoint EXISTS.
      const healthy = res.status === 402 || res.ok || (t.free === false && res.status >= 400 && res.status < 500 && res.status !== 404)
      checks.push({ ok: healthy, note: `${probeUrl} → HTTP ${res.status}${res.status === 402 ? ' (x402 challenge — healthy)' : ''}` })
      if (healthy) alive++
    } catch (e) {
      checks.push({ ok: false, note: `${t.url} → unreachable (${e instanceof Error ? e.name : 'error'})` })
    }
  }
  if (targets.length > 0 && alive < targets.length) fixes.push(`${targets.length - alive}/${targets.length} probed hosts are dead or unreachable — fix or delist them; the reputation penalty buries repeat failures anyway.`)
  return { key: 'probe', weight: 15, score: targets.length ? alive / targets.length : null, checks }
}

// ── planner (30): survive contact with the REAL router ──────────────────────
async function anthropic(prompt: string, maxTokens = 1024): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: PLANNER_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
    return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim() || null
  } catch {
    return null
  }
}

async function lintQuestions(server: { name: string; description: string; exampleQueries: string[] }, plannable: PlannableEndpoint[]): Promise<string[]> {
  if (server.exampleQueries.length >= QUESTION_CAP) return server.exampleQueries.slice(0, QUESTION_CAP)
  const menu = plannable.slice(0, 8).map((e) => `- ${e.description ?? e.url}`).join('\n')
  const gen = await anthropic(
    `Below is an API service and its endpoints. Write ${QUESTION_CAP} SHORT, natural user questions (one per line, no numbering, no quotes) that a chat user would plausibly type and that this service should answer. Vary phrasing; include one that needs a parameter value.\n\nService: ${server.name} — ${server.description}\nEndpoints:\n${menu}`,
    400,
  )
  const generated = (gen ?? '').split('\n').map((l) => l.trim()).filter((l) => l.length > 8 && l.length < 160).slice(0, QUESTION_CAP)
  return [...server.exampleQueries, ...generated].slice(0, QUESTION_CAP)
}

async function plannerDimension(server: { name: string; description: string; exampleQueries: string[] }, plannable: PlannableEndpoint[], fixes: string[]): Promise<Dimension> {
  const checks: Check[] = []
  if (!process.env.ANTHROPIC_API_KEY) {
    checks.push({ ok: false, note: 'skipped — ANTHROPIC_API_KEY not set (dimension reweighted out)' })
    return { key: 'planner', weight: 30, score: null, checks }
  }
  if (plannable.length === 0) {
    checks.push({ ok: false, note: 'no plannable endpoints — nothing for the planner to pick' })
    return { key: 'planner', weight: 30, score: 0, checks }
  }
  const questions = await lintQuestions(server, plannable)
  if (questions.length === 0) {
    checks.push({ ok: false, note: 'could not derive test questions' })
    return { key: 'planner', weight: 30, score: null, checks }
  }
  let points = 0
  for (const q of questions) {
    // The REAL prompt + parser + builder the chat path uses — construction
    // only, nothing paid or executed. Context vars offered like production.
    const prompt = plannerPrompt(q, plannable, [], '', { userAddress: LINT_USER_ADDRESS })
    const text = await anthropic(prompt)
    const picks = text ? parsePlannerPicks(text, plannable) : []
    if (picks.length === 0) {
      checks.push({ ok: false, note: `"${q}" → planner picked NOTHING` })
      fixes.push(`The planner declined "${q}" against this service's own menu — the endpoint descriptions don't signal that capability.`)
      continue
    }
    const built = buildSmartRequest(plannable.find((e) => e.id === picks[0].endpointId)!, picks[0].params, { userAddress: LINT_USER_ADDRESS })
    if ('error' in built) {
      points += 0.4
      checks.push({ ok: false, note: `"${q}" → picked, but request build FAILED: ${built.error}` })
      fixes.push(`Planner picked a tool for "${q}" but the request could not be constructed (${built.error}) — usually an unmarked/undocumented required param.`)
    } else {
      points += 1
      checks.push({ ok: true, note: `"${q}" → picked + constructed (${built.request.mcp ? 'tools/call' : built.request.method})` })
    }
  }
  return { key: 'planner', weight: 30, score: clamp01(points / questions.length), checks }
}

// ── affordances + safety (10) ────────────────────────────────────────────────
function affordancesDimension(server: { description: string }, plannable: PlannableEndpoint[], allDescriptions: string, fixes: string[]): Dimension {
  const checks: Check[] = []
  // Param descriptions BELONG in this haystack — identity guidance
  // ($USER_ADDRESS) lives on the param, not the endpoint blurb.
  const paramDescs = plannable.flatMap((e) => e.parameters).map((pm) => `${pm.name} ${pm.description ?? ''}`).join('\n')
  const hay = `${server.description}\n${allDescriptions}\n${paramDescs}`.toLowerCase()

  // Context-var readiness: user-identity params documented for the router.
  const addressParams = plannable.flatMap((e) => e.parameters).filter((p) => {
    const hayP = `${p.name} ${p.description ?? ''}`
    // Wallet-identity params only: "from"/wallet/voter/…, or any param whose
    // description speaks EVM ("0x…", wallet). A real-estate street `address`
    // is not user identity — require the wallet context for that name.
    if (/wallet|voter|follower|owner|account|signer|payer/i.test(hayP)) return true
    if (/^from$/i.test(p.name)) return true
    return /\baddress\b/i.test(p.name) && /wallet|evm|0x|signer|payer/i.test(p.description ?? '')
  })
  const mentionsUserAddress = hay.includes('$user_address') || /user'?s (own |wallet )?address/.test(hay)
  const ctxReady = addressParams.length === 0 || mentionsUserAddress
  checks.push({
    ok: ctxReady,
    note: addressParams.length === 0 ? 'no user-identity params (n/a)' : mentionsUserAddress ? `identity params documented for context vars ($USER_ADDRESS)` : `${addressParams.length} address-like params with no user-identity guidance`,
  })
  if (!ctxReady) fixes.push('Document identity params for the router ("the user\'s own wallet address — $USER_ADDRESS") so "my/do I…" questions fill them automatically instead of guessing.')

  // Escape hatch: one general query tool (tiered surface, §1c).
  const escapeHatch = plannable.some((e) => isEscapeHatchEndpoint(e.url, e.description))
  checks.push({ ok: escapeHatch, note: escapeHatch ? 'general query escape hatch present' : 'no escape-hatch tool — every uncovered filter needs a new endpoint (whack-a-mole)' })
  if (!escapeHatch) fixes.push('Consider ONE guarded general-query tool exposing the backend\'s native query language (see snapshot-free graphql_query) so long-tail intents need no new endpoints.')

  // Signing hygiene: build-don't-execute; custody smells are a hard flag.
  const custody = /private key|we sign|signs? on your behalf|custod|executes? the (swap|trade|transaction)/i.test(hay)
  checks.push({ ok: !custody, note: custody ? '⚠ CUSTODY SMELL — descriptions suggest the service signs/executes with its own keys' : 'signing hygiene: build-don\'t-execute language (or no signables)' })
  if (custody) fixes.push('SAFETY: the service appears to sign/execute itself. Pantessa routes signables to the USER\'s wallet — restructure to return unsigned payloads (build-don\'t-execute).')

  const score = clamp01(0.4 * (ctxReady ? 1 : 0) + 0.2 * (escapeHatch ? 1 : 0) + 0.4 * (custody ? 0 : 1))
  return { key: 'affordances', weight: 10, score, checks }
}

// ── assemble ─────────────────────────────────────────────────────────────────
export async function lintService(slug: string, opts: { probe: boolean; planner: boolean }): Promise<RoutabilityReport | null> {
  const server = await prisma.mcpServer.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, description: true, tags: true, exampleQueries: true },
  })
  if (!server) return null
  const plannable = await loadPlannableEndpoints([slug])
  const fixes: string[] = []

  const dims: Dimension[] = []
  dims.push(await schemaDimension(server.id, plannable, fixes))
  dims.push(descriptionDimension(server, plannable, fixes))
  dims.push(opts.probe ? await probeDimension(plannable, fixes) : { key: 'probe', weight: 15, score: null, checks: [{ ok: false, note: 'skipped (--no-probe)' }] })
  dims.push(opts.planner ? await plannerDimension(server, plannable, fixes) : { key: 'planner', weight: 30, score: null, checks: [{ ok: false, note: 'skipped (--no-planner)' }] })
  const allDescriptions = plannable.map((e) => e.description ?? '').join('\n')
  dims.push(affordancesDimension(server, plannable, allDescriptions, fixes))

  // Weighted over the dimensions that actually ran.
  const active = dims.filter((d) => d.score !== null)
  const weightSum = active.reduce((s, d) => s + d.weight, 0)
  const score = weightSum > 0 ? Math.round(active.reduce((s, d) => s + (d.score as number) * d.weight, 0) / weightSum * 100) : 0

  return { slug: server.slug, name: server.name, score, grade: gradeOf(score), dimensions: dims, fixes, lintedAt: new Date().toISOString() }
}


