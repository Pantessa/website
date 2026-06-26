import { NextRequest, NextResponse } from 'next/server'
import { getAddress, isAddress } from 'viem'
import { getPaidFetch, hasAgentWallet } from '@/lib/agent-wallet'
import {
  decodeSettlement,
  failureReason,
  getChallenge,
  derivePayment,
  finalizePaymentHeader,
  fetchWithPaymentHeader,
  type PreparedPayment,
  type SigningRequest,
} from '@/lib/x402'
import type { McpServer } from '@/lib/store'
import { voteRequestFromToolResult, friendlyVoteError, type VoteRequest } from '@/lib/snapshot-vote'
import { parseVoteIntent, type VoteIntent } from '@/lib/vote-intent'
import { resolveProposal } from '@/lib/snapshot-read'
import { detectGovernanceIntent, runGovernanceTurn } from '@/lib/governance'
import { getSessionAddress } from '@/lib/auth'
import { grantViolation, type GrantPolicy } from '@/lib/spend-grant'
import {
  getActiveGrant,
  spentTodayUsd,
  spentTotalUsd,
  recordLedger,
  toPolicy,
} from '@/lib/grant-store'
import {
  loadPlannableEndpoints,
  plannerPrompt,
  parsePlannerPicks,
  buildSmartRequest,
  type PlannableEndpoint,
  type PlannedPick,
  type ConversationTurn,
} from '@/lib/endpoint-planner'
import { loadCatalog } from '@/lib/catalog'
import { routeMessage, selectInferenceProvider, compactForSynthesis, dedupePlannerPicks, type TraceStep, type SmartPick } from '@/lib/router'
import { buildSignableArtifact } from '@/lib/transaction-layer'
import { isCacheable, routeCacheKey, getCached, setCached } from '@/lib/route-cache'
import { recordRouteEvent, routeSavings } from '@/lib/route-telemetry'
import { newTurnId, recordTraceLine } from '@/lib/route-trace'
import { recordIncident } from '@/lib/incidents'
import type { RouterDecision } from '@/lib/router'

// x402 signing + paid fetch need the Node runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Receipt {
  name: string
  endpoint: string
  priceUsd: string
  txHash?: string
  ok: boolean
  note?: string
  /** Set only on NOT_ALLOWED (no-approval) blocks → the UI deep-links to
   *  /servers/<slug>#approve so the user can approve in one click. */
  slug?: string
}

/** A planned paid call — round-tripped to the browser so the wallet can sign it. */
interface PlannedCall {
  id: string
  role: 'data' | 'inference'
  name: string
  host: string
  priceUsd: string
  endpoint: string
  url?: string // data url (with query)
  method?: string // data call method (default GET); smart POSTs carry a body
  body?: string // JSON body for smart POST calls
  tool?: string // inference tool name (mcp) or gateway model id (http)
  protocol?: 'mcp' | 'http' // inference transport (default mcp)
  mcp?: boolean // data call is an MCP tools/call (parse the JSON-RPC result)
  prepared: PreparedPayment | null // null = endpoint didn't require payment
}

/** Smart endpoints planned for selected, non-hand-wired services (USE_DB only). */
async function loadSmartEndpoints(listedOnly: McpServer[]): Promise<PlannableEndpoint[]> {
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return []
  try {
    return await loadPlannableEndpoints(listedOnly.map((s) => s.slug).filter(Boolean))
  } catch (err) {
    console.warn('smart endpoints unavailable:', err instanceof Error ? err.message : err)
    return []
  }
}

/** Max prior turns + per-turn chars threaded into prompts (keeps cost bounded). */
const HISTORY_TURNS = 6
const HISTORY_CHARS = 600

/**
 * Sanitize client-supplied conversation history: keep only well-formed
 * user/assistant turns, strip our own footers/diagnostics from assistant
 * messages (they're UI scaffolding, not content), trim, and cap to the last
 * few turns so the planner + answer have context without unbounded prompt cost.
 */
export function sanitizeHistory(raw: unknown): ConversationTurn[] {
  if (!Array.isArray(raw)) return []
  const out: ConversationTurn[] = []
  for (const m of raw) {
    const role = (m as { role?: unknown }).role
    const content = (m as { content?: unknown }).content
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue
    // Drop the appended "ℹ️ Not called…", "⚙️ Diagnostics…", "💸 …" scaffolding.
    const clean = content.split(/\n\n(?:ℹ️|⚙️|💸)/)[0].trim()
    if (clean) out.push({ role, content: clean.slice(0, HISTORY_CHARS) })
  }
  return out.slice(-HISTORY_TURNS)
}

/** Recent conversation rendered for the answer prompt. */
function answerHistoryBlock(history: ConversationTurn[]): string {
  if (history.length === 0) return ''
  return history.map((h) => `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.content}`).join('\n')
}

/** Ask the inference model to pick endpoints + params for the user message. */
async function planSmartPicks(
  inference: McpServer,
  message: string,
  smart: PlannableEndpoint[],
  history: ConversationTurn[] = [],
): Promise<{ picks: PlannedPick[]; dropped: PlannableEndpoint[]; txHash?: string }> {
  const { text, txHash } = await callInference(inference, plannerPrompt(message, smart, history))
  // Never pay two services for the same capability — keep the best per
  // capability (same dedup the Auto-Router applies). dropped → surfaced as notes.
  const { picks, dropped } = dedupePlannerPicks(parsePlannerPicks(text, smart), smart)
  return { picks, dropped, txHash }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // ── Phase 2 (wallet): execute with client-provided signatures ────────────
    if (body.phase === 'execute') {
      return await executeWithSignatures(
        String(body.message ?? ''),
        Array.isArray(body.plan) ? (body.plan as PlannedCall[]) : [],
        (body.signatures ?? {}) as Record<string, string>,
        Array.isArray(body.listedOnly) ? (body.listedOnly as McpServer[]) : [],
        Array.isArray(body.notes) ? (body.notes as string[]).filter((n) => typeof n === 'string').slice(0, 8) : [],
        sanitizeHistory(body.history),
        typeof body.turnId === 'string' ? body.turnId : undefined,
      )
    }

    const message: string = body.message ?? ''
    const history = sanitizeHistory(body.history)
    const activeServers: McpServer[] = Array.isArray(body.activeServers) ? body.activeServers : []
    const walletAddress: string | undefined =
      typeof body.walletAddress === 'string' && isAddress(body.walletAddress)
        ? getAddress(body.walletAddress)
        : undefined

    if (!message.trim()) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    // ── Auto-Router: the engine picks services across the whole directory and
    //    streams its reasoning + the answer (burner mode; wallet is B5). The
    //    manual path below is untouched. ───────────────────────────────────
    if (body.autoRouter === true) {
      const inferenceSlug = typeof body.inferenceSlug === 'string' ? body.inferenceSlug : undefined
      return streamAutoRouter(message, history, walletAddress, undefined, undefined, inferenceSlug)
    }

    const inference = activeServers.find(
      (s) =>
        s.kind === 'inference' &&
        s.callable &&
        s.endpoint &&
        (s.protocol === 'mcp' || s.protocol === 'http'),
    )
    const dataServers = activeServers.filter(
      (s) => s.kind === 'data' && s.callable && s.endpoint && s.protocol === 'http',
    )
    // MCP *data* services (e.g. Yeetful · Nansen): callable over MCP, their wired
    // `tool` takes structured args (toolArgs) rather than the free-text prompt the
    // inference path sends. Handled by a dedicated tools/call path.
    const mcpDataServers = activeServers.filter(
      (s) => s.kind === 'data' && s.callable && s.endpoint && s.protocol === 'mcp' && s.tool,
    )
    const listedOnly = activeServers.filter((s) => !s.callable)

    // ── Vote intent: build a Snapshot vote for the user to sign ───────────────
    // Detected before the inference check — preparing a vote doesn't need an
    // inference agent. Gated on a snapshot MCP service being active.
    const snapshotSvc = activeServers.find(
      (s) =>
        s.kind === 'data' &&
        s.protocol === 'mcp' &&
        s.callable &&
        !!s.endpoint &&
        /snapshot/i.test(`${s.slug} ${s.endpoint}`),
    )
    if (snapshotSvc) {
      const intent = parseVoteIntent(message)
      if (intent.isVote) {
        return await prepareVoteTurn(intent, snapshotSvc, walletAddress)
      }
    }

    // Need a live inference provider to phrase an answer.
    if (!inference) {
      const picked = activeServers.find((s) => s.kind === 'inference')
      const hint = picked
        ? `“${picked.name}” isn't wired for live x402 yet. Try **Yeetful · Claude**, **ChatGPT**, **DeepSeek**, or **Google Gemini** — they're live.`
        : 'Add an **Inference** agent (e.g. **Yeetful · Claude** or **ChatGPT**) so I can answer.'
      return NextResponse.json({ reply: `⚡ ${hint}` })
    }

    // Auto-callable endpoints for selected services that aren't hand-wired.
    // Planning costs one extra inference call, paid by the house wallet — so
    // smart calls need the burner even in wallet mode. Every reason a service
    // can't be auto-called lands in `notes` so the reply can say WHY.
    const notes: string[] = []
    let smart: PlannableEndpoint[] = []
    if (listedOnly.length > 0) {
      if (!hasAgentWallet()) {
        notes.push(
          'Auto-calling is offline: no house wallet on the server (PRIVATE_KEY unset). The planner that wires directory services into a chat turn is house-paid, so these services can only be listed.',
        )
      } else if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) {
        notes.push('Auto-calling is offline: the endpoint directory DB is disabled (USE_DB / DATABASE_URL).')
      } else {
        smart = await loadSmartEndpoints(listedOnly)
        const plannable = new Set(smart.map((e) => e.serverSlug))
        const unplannable = listedOnly.filter((s) => !plannable.has(s.slug))
        if (unplannable.length > 0) {
          notes.push(
            `No machine-readable parameter schemas published for: ${unplannable.map((s) => s.name).join(', ')} — calls can't be constructed safely, so they stay listed-only.`,
          )
        }
      }
    }

    // ── Phase 1 (wallet): plan + return signing requests ─────────────────────
    if (walletAddress) {
      return await planWalletPayments(message, inference, dataServers, mcpDataServers, listedOnly, walletAddress, smart, notes, history)
    }

    // ── Burner mode: the server's agent wallet pays everything in one shot ────
    if (hasAgentWallet()) {
      return await runWithBurner(message, inference, dataServers, mcpDataServers, listedOnly, smart, notes, history)
    }

    // ── Demo mode: nothing can pay ───────────────────────────────────────────
    return NextResponse.json({ reply: demoReply(message, activeServers) })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Chat request failed'
    console.error('Chat error:', error)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

// ── Vote intent ───────────────────────────────────────────────────────────────

/**
 * Resolve a vote intent into a signable Snapshot vote. Reads (proposal lookup)
 * are free; only the typed-data construction (prepare_vote) is paid, by the
 * house wallet — the user just signs the result. Returns a friendly clarifying
 * reply when the proposal or choice can't be pinned down.
 */
async function prepareVoteTurn(
  intent: VoteIntent,
  snapshotSvc: McpServer,
  walletAddress: string | undefined,
) {
  if (!walletAddress) {
    return NextResponse.json({
      reply:
        '🗳️ Connect your wallet to vote — Snapshot voting power is tied to your address, so you sign the vote yourself.',
    })
  }
  if (!intent.choiceText) {
    return NextResponse.json({
      reply: '🗳️ Which way? Say e.g. “vote For”, “vote against”, or “vote option 2”.',
    })
  }
  if (!hasAgentWallet()) {
    return NextResponse.json({
      reply:
        '🗳️ Voting needs the house wallet to prepare the signed message (x402), which isn’t configured here.',
    })
  }

  let resolved: Awaited<ReturnType<typeof resolveProposal>>
  try {
    resolved = await resolveProposal({ proposalId: intent.proposalId, spaceHint: intent.spaceHint })
  } catch (e) {
    return NextResponse.json({
      reply: `🗳️ Couldn’t reach Snapshot to find the proposal: ${e instanceof Error ? e.message : 'error'}.`,
    })
  }
  if (!('id' in resolved)) {
    const list = resolved.candidates
    if (list.length === 0) {
      return NextResponse.json({
        reply: intent.spaceHint
          ? `🗳️ No active proposals in ${intent.spaceHint} right now.`
          : '🗳️ No active proposals found. Name a DAO (e.g. aave.eth) or paste a proposal id.',
      })
    }
    // Offer the candidates as clickable chips (full ids retained in meta) so the
    // user picks one instead of pasting a 64-hex id they can only see truncated.
    const items = list.slice(0, 6).map((p) => ({ id: p.id, title: p.title, space: p.space.id }))
    const lines = items.map((p) => `· ${p.title} — ${p.space}`).join('\n')
    return NextResponse.json({
      reply: `🗳️ Which proposal? Pick one to vote ${intent.choiceText} on — or name the DAO/space:\n${lines}`,
      voteCandidates: { choiceText: intent.choiceText, items },
    })
  }

  const host = hostOf(snapshotSvc.endpoint!)
  const receipts: Receipt[] = []
  try {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'prepare_vote',
        arguments: { proposal: resolved.id, from: walletAddress, choiceText: intent.choiceText },
      },
    })
    const res = await getPaidFetch()(snapshotSvc.endpoint!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body,
    })
    if (!res.ok) throw new Error(await failureReason(res))
    const data = parseMcpDataResult(res.headers.get('content-type') ?? '', await res.text())
    const txHash = decodeSettlement(res)?.transaction
    receipts.push({ name: snapshotSvc.name, endpoint: host, priceUsd: snapshotSvc.priceUsd ?? '0.01', txHash, ok: true })
    const vote = voteRequestFromToolResult(data)
    if (!vote) {
      const note = typeof data === 'string' ? data : JSON.stringify(data)
      return NextResponse.json({ reply: `🗳️ ${friendlyVoteError(note)}`, receipts, payer: 'the house wallet' })
    }
    return NextResponse.json({ reply: `🗳️ ${vote.summary}`, receipts, payer: 'the house wallet', voteRequest: vote })
  } catch (err) {
    return NextResponse.json({ reply: `🗳️ ${friendlyVoteError(err)}`, receipts })
  }
}

// ── Wallet mode ──────────────────────────────────────────────────────────────

/** Probe every endpoint, derive an unsigned payment for the user's wallet. */
async function planWalletPayments(
  message: string,
  inference: McpServer,
  dataServers: McpServer[],
  mcpDataServers: McpServer[],
  listedOnly: McpServer[],
  walletAddress: string,
  smart: PlannableEndpoint[],
  notes: string[],
  history: ConversationTurn[] = [],
) {
  const plan: PlannedCall[] = []

  // Policy gate at PLAN time: never ask the wallet to sign a payment the
  // grant forbids. (Until now wallet mode relied purely on the human signing
  // each payment — the dashboard toggles only gated burner mode. Denials are
  // ledgered so the audit trail shows them.)
  const owner = await getSessionAddress()
  const grant = owner ? await getActiveGrant(owner) : null
  const policy: GrantPolicy | null = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const spentTotal = grant ? await spentTotalUsd(grant.id) : 0
  let plannedUsd = 0
  const planGate = async (name: string, host: string, price: number): Promise<string | null> => {
    if (!policy || !grant) return null
    const violation = grantViolation(policy, host, price, spentToday + plannedUsd, spentTotal + plannedUsd)
    if (violation) {
      await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: name, amountUsd: 0, ok: false, note: violation })
      return violation
    }
    plannedUsd += price
    return null
  }

  for (const ds of dataServers) {
    const dsViolation = await planGate(ds.name, hostOf(ds.endpoint!), Number(ds.priceUsd ?? '0.01'))
    if (dsViolation) {
      notes.push(`${ds.name} was blocked by your spend policy (${dsViolation}) — manage it on the Dashboard.`)
      continue
    }
    const url = new URL(ds.endpoint!)
    url.searchParams.set(ds.queryParam ?? 'q', message)
    const challenge = await getChallenge(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    plan.push({
      id: `data:${ds.slug}`,
      role: 'data',
      name: ds.name,
      host: hostOf(ds.endpoint!),
      priceUsd: ds.priceUsd ?? '0.01',
      endpoint: ds.endpoint!,
      url: url.toString(),
      prepared: challenge ? derivePayment(challenge, walletAddress) : null,
    })
  }

  // MCP data services: an x402-gated tools/call POST (flat-priced, like the MCP
  // inference path, so the plan-time body matches the execute-time body).
  for (const ds of mcpDataServers) {
    const dsViolation = await planGate(ds.name, hostOf(ds.endpoint!), Number(ds.priceUsd ?? '0.01'))
    if (dsViolation) {
      notes.push(`${ds.name} was blocked by your spend policy (${dsViolation}) — manage it on the Dashboard.`)
      continue
    }
    const reqd = mcpDataRequest(ds)
    const challenge = await getChallenge(reqd.url, {
      method: reqd.method,
      headers: reqd.headers,
      body: reqd.body,
    })
    plan.push({
      id: `mcpdata:${ds.slug}`,
      role: 'data',
      name: ds.name,
      host: hostOf(ds.endpoint!),
      priceUsd: ds.priceUsd ?? '0.01',
      endpoint: ds.endpoint!,
      url: reqd.url,
      method: reqd.method,
      body: reqd.body,
      mcp: true,
      prepared: challenge ? derivePayment(challenge, walletAddress) : null,
    })
  }

  // Smart calls: the planner (house-paid) picks endpoints for selected
  // directory services; the user's wallet signs the actual data payments.
  const smartServed = new Set<string>()
  if (smart.length > 0) {
    try {
      const { picks, dropped } = await planSmartPicks(inference, message, smart, history)
      for (const d of dropped) notes.push(`Skipped ${d.serverName} — another picked service covers the same capability; kept the better-rated/cheaper one.`)
      if (picks.length === 0) {
        const considered = [...new Set(smart.map((e) => e.serverName))].join(', ')
        notes.push(`The planner reviewed ${considered} but judged none of their endpoints relevant to this message.`)
      }
      const byId = new Map(smart.map((e) => [e.id, e]))
      for (const pick of picks) {
        const ep = byId.get(pick.endpointId)!
        const built = buildSmartRequest(ep, pick.params)
        if ('error' in built) {
          notes.push(`${ep.serverName}: planned call skipped — ${built.error}.`)
          continue
        }
        const { request } = built
        const smartViolation = await planGate(ep.serverName, hostOf(request.url), Number(ep.priceUsd))
        if (smartViolation) {
          notes.push(`${ep.serverName} was blocked by your spend policy (${smartViolation}) — manage it on the Dashboard.`)
          continue
        }
        const challenge = await getChallenge(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
        })
        smartServed.add(ep.serverSlug)
        plan.push({
          id: `smart:${ep.id}`,
          role: 'data',
          name: ep.serverName,
          host: hostOf(request.url),
          priceUsd: ep.priceUsd,
          endpoint: ep.url,
          url: request.url,
          method: request.method,
          body: request.body,
          prepared: challenge ? derivePayment(challenge, walletAddress) : null,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      console.warn('smart planning failed (continuing without):', msg)
      notes.push(`Endpoint planning failed (${truncate(msg, 120)}) — directory services skipped this turn.`)
    }
  }
  const stillListedOnly = listedOnly.filter((s) => !smartServed.has(s.slug))

  // Inference 402 probe. MCP gateways price flat (body-independent); http
  // gateways price by request size, so the probe carries the real model and
  // the execute-time prompt is capped into the same flat tier (see capPrompt).
  const infViolation = await planGate(
    inference.name,
    hostOf(inference.endpoint!),
    Number(inference.priceUsd ?? '0.01'),
  )
  if (infViolation) {
    return NextResponse.json({
      reply: `🚫 Your spend policy blocked the inference call (${inference.name}: ${infViolation}). Adjust it on your **Dashboard** and try again.`,
      blocked: true,
      notes,
    })
  }
  const infProtocol = inferenceProtocolOf(inference)
  const infTool = inference.tool ?? (infProtocol === 'http' ? 'openai/gpt-4o-mini' : 'ask_claude')
  const infChallenge = await getChallenge(inference.endpoint!, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: infProtocol === 'http' ? inferenceBody('http', infTool, 'probe') : dummyMcpBody(infTool),
  })
  plan.push({
    id: `inference:${inference.slug}`,
    role: 'inference',
    name: inference.name,
    host: hostOf(inference.endpoint!),
    priceUsd: inference.priceUsd ?? '0.01',
    endpoint: inference.endpoint!,
    tool: infTool,
    protocol: infProtocol,
    prepared: infChallenge ? derivePayment(infChallenge, walletAddress) : null,
  })

  // Signing requests the browser needs (one per call that requires payment).
  const payments = plan
    .filter((c) => c.prepared)
    .map((c) => ({
      id: c.id,
      name: c.name,
      host: c.host,
      priceUsd: c.priceUsd,
      signing: c.prepared!.signing as SigningRequest,
    }))

  return NextResponse.json({
    phase: 'awaiting-signatures',
    message,
    plan,
    payments,
    listedOnly: stillListedOnly,
    notes,
  })
}

/** Phase 2: attach the wallet's signatures, run the paid calls, answer. */
async function executeWithSignatures(
  message: string,
  plan: PlannedCall[],
  signatures: Record<string, string>,
  listedOnly: McpServer[],
  notes: string[] = [],
  history: ConversationTurn[] = [],
  /** The plan phase's turnId — so wallet settlements persist to the live feed
   *  under the same turn as the plan trace (grouped). Falls back to a fresh id. */
  turnId: string = newTurnId(),
) {
  if (!message.trim()) return NextResponse.json({ error: 'message is required' }, { status: 400 })

  const receipts: Receipt[] = []
  const contextBlocks: string[] = []
  const inferenceCall = plan.find((c) => c.role === 'inference')

  // Persist each wallet-mode receipt to the live routing feed (route_trace_lines)
  // — the burner path already does this via the SSE chokepoint; wallet mode is a
  // separate request, so do it here. Fire-and-forget; never fails the turn.
  let traceSeq = 0
  const pushReceipt = (r: Receipt) => {
    receipts.push(r)
    recordTraceLine(turnId, traceSeq++, { type: 'receipt', receipt: r }, 'wallet')
  }

  // Ledger wallet-mode payments too (the user pays the seller directly; we
  // record the receipt under their active grant so the dashboard sees it).
  // No grant → no ledger, same as before.
  const owner = await getSessionAddress()
  const grant = owner ? await getActiveGrant(owner) : null
  const ledger = (c: PlannedCall, ok: boolean, txHash?: string, note?: string) => {
    if (!grant) return
    void recordLedger({
      grantId: grant.id, orgId: grant.orgId ?? undefined,
      host: c.host,
      serviceName: c.name,
      amountUsd: ok ? Number(c.priceUsd) || 0 : 0,
      ok,
      txHash,
      note: note ?? (ok ? 'settled' : 'call failed'),
    }).catch(() => {})
  }

  // Data calls first → gather context. Smart calls carry method/body.
  for (const c of plan.filter((c) => c.role === 'data')) {
    try {
      const header = paymentHeaderFor(c, signatures)
      const init: RequestInit = {
        method: c.method ?? 'GET',
        headers: {
          accept: c.mcp ? 'application/json, text/event-stream' : 'application/json',
          ...(c.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(c.body ? { body: c.body } : {}),
      }
      const res = await fetchWithPaymentHeader(c.url!, init, header)
      if (!res.ok) throw new Error(await failureReason(res))
      const data = c.mcp
        ? parseMcpDataResult(res.headers.get('content-type') ?? '', await res.text())
        : await res.json()
      contextBlocks.push(`### ${c.name}\n${compactForSynthesis(data, 3500)}`)
      const txHash = decodeSettlement(res)?.transaction
      pushReceipt({ name: c.name, endpoint: c.host, priceUsd: c.priceUsd, txHash, ok: true })
      ledger(c, true, txHash)
    } catch (err) {
      const note = err instanceof Error ? err.message : 'call failed'
      pushReceipt({ name: c.name, endpoint: c.host, priceUsd: c.priceUsd, ok: false, note })
      ledger(c, false, undefined, truncate(note, 120))
      // Feed the self-heal loop from the wallet path too (deduped by service +
      // error class; links this turn's trace). Fire-and-forget.
      recordIncident({ service: c.name, message: note, turnId })
    }
  }

  if (!inferenceCall) {
    return NextResponse.json({ error: 'No inference call in plan.' }, { status: 400 })
  }

  // Inference with the real prompt. MCP authorizations are body-independent;
  // http prompts are capped into the plan-time price tier (capPrompt).
  const execProtocol: 'mcp' | 'http' = inferenceCall.protocol === 'http' ? 'http' : 'mcp'
  const execTool =
    inferenceCall.tool ?? (execProtocol === 'http' ? 'openai/gpt-4o-mini' : 'ask_claude')
  const prompt = capPrompt(execProtocol, buildPrompt(message, contextBlocks, history))
  const header = paymentHeaderFor(inferenceCall, signatures)
  const res = await fetchWithPaymentHeader(
    inferenceCall.endpoint,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: inferenceBody(execProtocol, execTool, prompt),
    },
    header,
  )
  if (!res.ok) throw new Error(await failureReason(res))
  const text = parseInferenceText(execProtocol, res.headers.get('content-type') ?? '', await res.text())
  const infTx = decodeSettlement(res)?.transaction
  pushReceipt({ name: inferenceCall.name, endpoint: inferenceCall.host, priceUsd: inferenceCall.priceUsd, txHash: infTx, ok: true })
  ledger(inferenceCall, true, infTx)

  const reply = text + infoFooter(listedOnly, notes)
  return NextResponse.json({ reply, receipts, payer: 'your wallet' })
}

/** Build the payment header for a planned call from its client signature. */
function paymentHeaderFor(call: PlannedCall, signatures: Record<string, string>) {
  if (!call.prepared) throw new Error(`${call.name} unexpectedly required no payment`)
  const sig = signatures[call.id]
  if (!sig) throw new Error(`Missing wallet signature for ${call.name}`)
  return finalizePaymentHeader(call.prepared, sig)
}

// ── Burner mode ──────────────────────────────────────────────────────────────

async function runWithBurner(
  message: string,
  inference: McpServer,
  dataServers: McpServer[],
  mcpDataServers: McpServer[],
  listedOnly: McpServer[],
  smart: PlannableEndpoint[] = [],
  notes: string[] = [],
  history: ConversationTurn[] = [],
) {
  const receipts: Receipt[] = []
  const contextBlocks: string[] = []
  // A vote built by the snapshot MCP's prepare_vote tool, hoisted out of the
  // tool result so the chat can render a Sign-vote button instead of dumping
  // the EIP-712 typed data into the inference prompt.
  let voteRequest: VoteRequest | null = null

  // Load the signed-in owner's active spend grant. When one exists, every
  // burner payment is gated by it (expiry → allowlist → per-call → per-day) and
  // ledgered; when absent, behavior is unchanged (no enforcement, no ledger).
  const owner = await getSessionAddress()
  const grant = owner ? await getActiveGrant(owner) : null
  const policy: GrantPolicy | null = grant ? toPolicy(grant) : null
  let spentToday = grant ? await spentTodayUsd(grant.id) : 0
  let spentTotal = grant ? await spentTotalUsd(grant.id) : 0
  const blocked: string[] = []

  for (const ds of dataServers) {
    const host = hostOf(ds.endpoint!)
    const price = Number(ds.priceUsd ?? '0.01')

    if (policy && grant) {
      const violation = grantViolation(policy, host, price, spentToday, spentTotal)
      if (violation) {
        await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ds.name, amountUsd: 0, ok: false, note: violation })
        receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', ok: false, note: `blocked: ${violation}`, slug: violation === 'NOT_ALLOWED' ? ds.slug : undefined })
        blocked.push(`${ds.name} (${violation})`)
        continue
      }
    }

    try {
      const { json, txHash } = await paidGet(ds.endpoint!, ds.queryParam ?? 'q', message)
      contextBlocks.push(`### ${ds.name}\n${compactForSynthesis(json, 3500)}`)
      receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', txHash, ok: true })
      if (grant) {
        await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ds.name, amountUsd: price, ok: true, txHash, note: 'settled' })
        spentToday += price
        spentTotal += price
      }
    } catch (err) {
      receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', ok: false, note: err instanceof Error ? err.message : 'call failed' })
    }
  }

  // ── MCP data services: pay + tools/call with structured args ──────────────
  for (const ds of mcpDataServers) {
    const host = hostOf(ds.endpoint!)
    const price = Number(ds.priceUsd ?? '0.01')

    if (policy && grant) {
      const violation = grantViolation(policy, host, price, spentToday, spentTotal)
      if (violation) {
        await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ds.name, amountUsd: 0, ok: false, note: violation })
        receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', ok: false, note: `blocked: ${violation}`, slug: violation === 'NOT_ALLOWED' ? ds.slug : undefined })
        blocked.push(`${ds.name} (${violation})`)
        continue
      }
    }

    try {
      const reqd = mcpDataRequest(ds)
      const res = await getPaidFetch()(reqd.url, { method: reqd.method, headers: reqd.headers, body: reqd.body })
      if (!res.ok) throw new Error(await failureReason(res))
      const data = parseMcpDataResult(res.headers.get('content-type') ?? '', await res.text())
      const txHash = decodeSettlement(res)?.transaction
      // prepare_vote returns a sign_vote payload — surface it as a button rather
      // than feeding the raw typed data to the model.
      const vote = voteRequestFromToolResult(data)
      if (vote) {
        voteRequest = vote
        contextBlocks.push(`### ${ds.name}\nPrepared a vote for the user to sign: ${vote.summary}`)
      } else {
        contextBlocks.push(`### ${ds.name}\n${compactForSynthesis(data, 3500)}`)
      }
      receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', txHash, ok: true })
      if (grant) {
        await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ds.name, amountUsd: price, ok: true, txHash, note: 'settled' })
        spentToday += price
        spentTotal += price
      }
    } catch (err) {
      receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', ok: false, note: err instanceof Error ? err.message : 'call failed' })
    }
  }

  // ── Smart calls: planner picks endpoints for non-wired selected services ──
  const infHost = hostOf(inference.endpoint!)
  const infPrice = Number(inference.priceUsd ?? '0.01')
  const smartServed = new Set<string>()
  if (smart.length > 0) {
    // The planning call is an extra inference payment — gate it like one.
    const plannerViolation = policy && grant ? grantViolation(policy, infHost, infPrice, spentToday, spentTotal) : null
    if (plannerViolation) {
      blocked.push(`endpoint planner (${plannerViolation})`)
    } else {
      try {
        const { picks, dropped, txHash } = await planSmartPicks(inference, message, smart, history)
        for (const d of dropped) notes.push(`Skipped ${d.serverName} — another picked service covers the same capability; kept the better-rated/cheaper one.`)
        if (grant) {
          await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: infHost, serviceName: inference.name, amountUsd: infPrice, ok: true, txHash, note: 'settled' })
          spentToday += infPrice
          spentTotal += infPrice
        }
        if (picks.length === 0) {
          const considered = [...new Set(smart.map((e) => e.serverName))].join(', ')
          notes.push(`The planner reviewed ${considered} but judged none of their endpoints relevant to this message.`)
        }
        const byId = new Map(smart.map((e) => [e.id, e]))
        for (const pick of picks) {
          const ep = byId.get(pick.endpointId)!
          const built = buildSmartRequest(ep, pick.params)
          if ('error' in built) {
            receipts.push({ name: ep.serverName, endpoint: hostOf(ep.url), priceUsd: ep.priceUsd, ok: false, note: `skipped: ${built.error}` })
            continue
          }
          const { request } = built
          const host = hostOf(request.url)
          const price = Number(ep.priceUsd)
          if (policy && grant) {
            const violation = grantViolation(policy, host, price, spentToday, spentTotal)
            if (violation) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ep.serverName, amountUsd: 0, ok: false, note: violation })
              receipts.push({ name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, ok: false, note: `blocked: ${violation}`, slug: violation === 'NOT_ALLOWED' ? ep.serverSlug : undefined })
              blocked.push(`${ep.serverName} (${violation})`)
              continue
            }
          }
          try {
            const { json, txHash: dataTx } = await paidCall(request)
            contextBlocks.push(`### ${ep.serverName}\n${compactForSynthesis(json, 3500)}`)
            receipts.push({ name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, txHash: dataTx, ok: true })
            smartServed.add(ep.serverSlug)
            if (grant) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ep.serverName, amountUsd: price, ok: true, txHash: dataTx, note: 'settled' })
              spentToday += price
              spentTotal += price
            }
          } catch (err) {
            const note = err instanceof Error ? err.message : 'call failed'
            receipts.push({ name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, ok: false, note })
            // Record the failed paid call for the self-heal loop — the default
            // (non-Auto-Router) chat path most users hit. Without this, only the
            // Auto-Router path fed incidents, so the table stayed empty and the
            // self-heal workflow had nothing to act on. Fire-and-forget; deduped
            // by service + error class.
            recordIncident({ service: ep.serverName, message: note })
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error'
        console.warn('smart planning failed (continuing without):', msg)
        notes.push(`Endpoint planning failed (${truncate(msg, 120)}) — directory services skipped this turn.`)
      }
    }
  }

  // Inference is the call that actually answers — if the grant blocks it, stop.
  if (policy && grant) {
    const violation = grantViolation(policy, infHost, infPrice, spentToday, spentTotal)
    if (violation) {
      await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: infHost, serviceName: inference.name, amountUsd: 0, ok: false, note: violation })
      const also = blocked.length ? ` Also blocked: ${blocked.join(', ')}.` : ''
      return NextResponse.json({
        reply: `🚫 Your spend grant blocked the inference call (${inference.name}: ${violation}).${also} Approve the agent on your **Dashboard** (or raise the caps) and try again.`,
        receipts,
        blocked: true,
      })
    }
  }

  const prompt = buildPrompt(message, contextBlocks, history)
  const { text, txHash } = await callInference(inference, prompt)
  receipts.push({ name: inference.name, endpoint: infHost, priceUsd: inference.priceUsd ?? '0.01', txHash, ok: true })
  if (grant) {
    await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: infHost, serviceName: inference.name, amountUsd: infPrice, ok: true, txHash, note: 'settled' })
    spentToday += infPrice
  }

  let reply = text + infoFooter(listedOnly.filter((s) => !smartServed.has(s.slug)), notes)
  if (grant && policy) {
    reply += `\n\n— spend grant “${grant.label}”: $${spentToday.toFixed(2)}/$${policy.perDayUsd} today`
    if (blocked.length) reply += ` · blocked ${blocked.join(', ')}`
  }
  return NextResponse.json({ reply, receipts, payer: 'the house wallet', voteRequest: voteRequest ?? undefined })
}

async function paidGet(endpoint: string, queryParam: string, value: string) {
  const url = new URL(endpoint)
  url.searchParams.set(queryParam, value)
  const res = await getPaidFetch()(url.toString(), { method: 'GET', headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(await failureReason(res))
  return { json: await res.json(), txHash: decodeSettlement(res)?.transaction }
}

/** Pay + execute a planner-built request (GET with query or POST with body). */
// Resilience: a single hanging MCP must never stall a routed turn. Each paid
// data call is bounded; on timeout it throws → the engine records a failed
// observation and fails over to the next-best shortlisted provider.
const DATA_CALL_TIMEOUT_MS = 12_000
const INFERENCE_TIMEOUT_MS = 30_000

async function paidCall(request: { url: string; method: string; headers: Record<string, string>; body?: string }) {
  const res = await getPaidFetch()(request.url, {
    method: request.method,
    headers: request.headers,
    signal: AbortSignal.timeout(DATA_CALL_TIMEOUT_MS),
    ...(request.body ? { body: request.body } : {}),
  })
  if (!res.ok) throw new Error(await failureReason(res))
  return { json: await res.json(), txHash: decodeSettlement(res)?.transaction }
}

// ── Auto-Router (streaming) ─────────────────────────────────────────────────
//
// Burner-mode auto-routing with a live SSE trace. The engine (lib/router) picks
// services across the whole directory; each reasoning step, payment, receipt,
// and the final answer is streamed as `data: {json}\n\n`. Wire contract (the
// engine window renders by `type`): the four TraceStep shapes from lib/router
// (status / analyze / candidate / select), plus over-the-wire `pay`, `receipt`,
// `reply`, `error`, `done`. Grant gating + ledgering match burner mode exactly.
export function streamAutoRouter(
  message: string,
  history: ConversationTurn[],
  walletAddress?: string,
  /** When set (Bearer-key callers via /api/route), the spend scope is this
   *  address instead of the SIWE session — so the engine gates the agent's
   *  own grant. */
  ownerOverride?: string,
  /** The calling API key's id (Bearer via /api/route) — attributes routed spend
   *  to that agent so per-key budgets + the Agents tab reflect it (B22). */
  apiKeyId?: string,
  /** Optional inference-engine pin (slug, e.g. 'deepseek' | 'chatgpt' |
   *  'google-gemini' | 'claude'). Used by the live-service test to rotate
   *  engines; ignored when the slug isn't a callable inference. */
  inferenceSlug?: string,
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Accumulate the trace-type events as they stream so the turn's reasoning
      // can be persisted to Message.meta + replayed later (B16). No PII (service
      // slugs / intent / public tx hashes only); capped to keep meta small.
      const traceLog: unknown[] = []
      const TRACE_TYPES = new Set(['status', 'analyze', 'shortlist', 'candidate', 'select', 'note', 'pay', 'receipt', 'tool', 'eip712', 'error'])
      const trace = () => traceLog.slice(-60)
      // Persist the trace to the shared DB so it streams to the public Activity
      // page in real time (local dev + prod share one Neon DB). Fire-and-forget;
      // privacy-filtered in lib/route-trace. Payer: an agent key → 'agent', else
      // the house burner wallet.
      const turnId = newTurnId()
      const tracePayer = apiKeyId ? 'agent' : 'burner'
      let traceSeq = 0
      const send = (event: unknown) => {
        if (event && typeof event === 'object' && TRACE_TYPES.has((event as { type?: string }).type ?? '') && traceLog.length < 300) {
          traceLog.push(event)
          recordTraceLine(turnId, traceSeq++, event, tracePayer)
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      const startMs = Date.now()
      const finish = () => {
        send({ type: 'done' })
        controller.close()
      }
      // Routing telemetry helpers (B14): derive turn metrics from the decision +
      // the receipts collected so far. Privacy: service slugs + intent only.
      const shortlistedOf = (d: RouterDecision) => {
        const s = d.trace.find((x) => x.type === 'shortlist')
        return s && s.type === 'shortlist' ? s.candidates.length : 0
      }
      const intentOf = (d: RouterDecision) => {
        const a = d.trace.find((x) => x.type === 'analyze')
        return a && a.type === 'analyze' ? a.intent : undefined
      }
      const picksOf = (d: RouterDecision) => d.smartPicks.map((p) => ({ service: p.serverName, endpoint: p.endpointUrl, priceUsd: p.priceUsd }))
      try {
        send({ type: 'status', label: 'Starting the routing engine…' } satisfies TraceStep)

        // ── Governance fast-path: proposals/votes are free Snapshot reads + a
        //    gasless EIP-712 signature, not paid MCP calls. Run the transaction
        //    tools (resolve → list → build EIP-712 → sign → relay → results),
        //    each streamed as a terminal step. ─────────────────────────────────
        const govIntent = detectGovernanceIntent(message)
        if (govIntent) {
          send({
            type: 'analyze',
            intent: govIntent.kind === 'vote' ? 'Cast a governance vote' : 'Find open governance proposals',
            needs: govIntent.spaceQuery ? [`Snapshot space: ${govIntent.spaceQuery}`] : ['active Snapshot proposals'],
          } satisfies TraceStep)

          // Optional paid summary (item 1): the free Snapshot reads gather the
          // facts; Yeetful Claude phrases them conversationally. This is a REAL
          // burner-paid inference call — shown as select → pay → receipt in the
          // terminal — gated by the spend policy. Free template if unavailable.
          const govReceipts: Receipt[] = []
          const synthesize = async (prompt: string): Promise<string | null> => {
            if (!hasAgentWallet()) return null
            const catalog = await loadCatalog()
            const inference = selectInferenceProvider(catalog, inferenceSlug)
            if (!inference?.endpoint) return null
            const infHost = hostOf(inference.endpoint)
            const infPrice = Number(inference.priceUsd ?? '0.01')
            const owner = ownerOverride ?? (await getSessionAddress())
            const grant = owner ? await getActiveGrant(owner) : null
            if (grant) {
              const v = grantViolation(toPolicy(grant), infHost, infPrice, await spentTodayUsd(grant.id), await spentTotalUsd(grant.id))
              if (v) { send({ type: 'note', level: 'warn', label: `Skipped the conversational summary — spend policy (${v}).` }); return null }
            }
            send({ type: 'select', service: inference.name, endpoint: inference.endpoint, priceUsd: inference.priceUsd ?? undefined, reason: 'Phrase the Snapshot data conversationally' } satisfies TraceStep)
            send({ type: 'pay', service: inference.name, host: infHost, priceUsd: String(infPrice) })
            try {
              const r = await callInference(inference, prompt)
              const receipt: Receipt = { name: inference.name, endpoint: infHost, priceUsd: String(infPrice), txHash: r.txHash, ok: true }
              govReceipts.push(receipt)
              send({ type: 'receipt', receipt })
              if (grant) await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, apiKeyId, host: infHost, serviceName: inference.name, amountUsd: infPrice, ok: true, txHash: r.txHash, note: 'settled (governance summary)' })
              return r.text?.trim() || null
            } catch {
              send({ type: 'note', level: 'warn', label: 'Summary inference failed — showing the raw data.' })
              return null
            }
          }

          try {
            const gov = await runGovernanceTurn({ message, intent: govIntent, walletAddress, emit: send, synthesize })
            const paid = govReceipts.length > 0
            send({
              type: 'reply',
              content: gov.reply,
              receipts: govReceipts,
              payer: gov.cast ? 'your agent' : paid ? 'the house wallet' : 'none',
              trace: trace(),
              ...(gov.voteRequest ? { voteRequest: gov.voteRequest } : {}),
              ...(gov.voteProposal ? { voteProposal: gov.voteProposal } : {}),
            })
            recordRouteEvent({
              payer: gov.cast ? 'agent' : paid ? 'house' : 'none',
              latencyMs: Date.now() - startMs,
              intent: govIntent.kind,
              settledCount: govReceipts.length,
              totalCostUsd: govReceipts.reduce((a, r) => a + (Number(r.priceUsd) || 0), 0),
            })
          } catch (e) {
            send({ type: 'reply', content: `🗳️ Governance routing hit an error: ${e instanceof Error ? e.message : 'unknown error'}.`, receipts: [], payer: 'none' })
          }
          return finish()
        }

        const catalog = await loadCatalog()
        const inference = selectInferenceProvider(catalog, inferenceSlug)
        if (!inference) {
          send({
            type: 'reply',
            content: '⚡ No live inference engine is available. Enable an Inference agent (e.g. **Yeetful · Claude**) so I can answer.',
            receipts: [],
            payer: 'none',
          })
          recordRouteEvent({ blocked: true, payer: 'none', latencyMs: Date.now() - startMs })
          return finish()
        }

        // Auto-Router pays from the house wallet (burner). Wallet-signed routing
        // is B5; without a house wallet there's nothing to pay with.
        if (!hasAgentWallet()) {
          send({
            type: 'reply',
            content: '⚡ Auto Router needs the house wallet (PRIVATE_KEY) to pay per call, which isn’t configured here. Turn Auto Router off to pick agents and pay with your own wallet.',
            receipts: [],
            payer: 'none',
          })
          recordRouteEvent({ blocked: true, payer: 'none', latencyMs: Date.now() - startMs })
          return finish()
        }

        // Spend grant (burner): when the owner has an active grant, every
        // payment is gated + ledgered; absent → no enforcement, no ledger. The
        // owner is the Bearer key's scope (/api/route) or the SIWE session (chat).
        const owner = ownerOverride ?? (await getSessionAddress())
        const grant = owner ? await getActiveGrant(owner) : null
        const policy: GrantPolicy | null = grant ? toPolicy(grant) : null
        let spentToday = grant ? await spentTodayUsd(grant.id) : 0
        let spentTotal = grant ? await spentTotalUsd(grant.id) : 0
        const infHost = hostOf(inference.endpoint!)
        const infPrice = Number(inference.priceUsd ?? '0.01')
        const receipts: Receipt[] = []
        let savedUsd = 0 // accumulated cache savings this turn

        // Persist one route event from the receipts gathered so far + overrides.
        const recordTurn = (o: { blocked?: boolean; payer?: string; shortlisted?: number; picks?: { service: string; endpoint?: string; priceUsd?: string }[]; intent?: string }) =>
          recordRouteEvent({
            latencyMs: Date.now() - startMs,
            settledCount: receipts.filter((r) => r.ok && r.note !== 'cached').length,
            failedCount: receipts.filter((r) => !r.ok).length,
            cachedCount: receipts.filter((r) => r.note === 'cached').length,
            totalCostUsd: receipts.filter((r) => r.ok).reduce((a, r) => a + (Number(r.priceUsd) || 0), 0),
            savedUsd,
            ...o,
          })

        // The routing call AND the answer both hit the inference host — if the
        // grant forbids it, stop before spending a cent.
        if (policy && grant) {
          const violation = grantViolation(policy, infHost, infPrice, spentToday, spentTotal)
          if (violation) {
            await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: infHost, serviceName: inference.name, amountUsd: 0, ok: false, note: violation })
            send({ type: 'status', label: `Blocked by your spend policy (${violation}).` } satisfies TraceStep)
            send({
              type: 'reply',
              content: `🚫 Your spend policy blocked ${inference.name} (${violation}). Approve it (or raise the caps) on your **Dashboard** and try again.`,
              receipts,
              payer: 'the house wallet',
              blocked: true,
            })
            recordTurn({ blocked: true, payer: 'the house wallet' })
            return finish()
          }
        }

        // The routing/planning inference always tries the direct Anthropic API
        // first (the planner is the product — see planViaAnthropic). That call is
        // house-paid via the API key, off the x402 rail entirely, so it costs the
        // grant nothing and can't self-pay. Only when no ANTHROPIC_API_KEY is set
        // do we fall back to the paid inference MCP, and ONLY then do we ledger
        // the routing cost (burner: counts against the grant; wallet: house eats).
        const runRoutingInference = async (inf: McpServer, prompt: string) => {
          const direct = await planViaAnthropic(prompt)
          if (direct) return { text: direct, txHash: undefined }
          // Fell back to the paid answer engine for PLANNING — the weak path that
          // collapses routing. Make it loud (the silent fallback cost a whole
          // debugging cycle): a server warn + a visible note in the engine window.
          const why = process.env.ANTHROPIC_API_KEY ? 'Anthropic planner call failed' : 'ANTHROPIC_API_KEY not set'
          console.warn(`[reason-router] planner fell back to ${inf.name} — ${why}`)
          send({ type: 'note', level: 'warn', label: `Planner fell back to ${inf.name} (${why}) — routing quality degraded.` })
          const r = await callInference(inf, prompt)
          if (grant && !walletAddress) {
            await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, apiKeyId, host: infHost, serviceName: inference.name, amountUsd: infPrice, ok: true, txHash: r.txHash, note: 'settled (routing)' })
            spentToday += infPrice
            spentTotal += infPrice
          }
          return r
        }

        // ── Wallet mode: single planning pass (no executeCall) → hand the data +
        //    answer payments to the wallet to sign via the two-phase execute path.
        if (walletAddress) {
          const decision = await routeMessage({ message, history, catalog, onStep: (s) => send(s), runInference: runRoutingInference })
          const wPlan: PlannedCall[] = []
          let plannedUsd = 0
          const planGate = async (name: string, h: string, price: number): Promise<string | null> => {
            if (!policy || !grant) return null
            const v = grantViolation(policy, h, price, spentToday + plannedUsd, spentTotal + plannedUsd)
            if (v) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: h, serviceName: name, amountUsd: 0, ok: false, note: v })
              return v
            }
            plannedUsd += price
            return null
          }
          for (const pick of decision.smartPicks) {
            const host = hostOf(pick.request.url)
            const violation = await planGate(pick.serverName, host, Number(pick.priceUsd))
            if (violation) {
              const r: Receipt = { name: pick.serverName, endpoint: host, priceUsd: pick.priceUsd, ok: false, note: `blocked: ${violation}`, slug: violation === 'NOT_ALLOWED' ? pick.serverSlug : undefined }
              receipts.push(r)
              send({ type: 'receipt', receipt: r })
              continue
            }
            const challenge = await getChallenge(pick.request.url, { method: pick.request.method, headers: pick.request.headers, body: pick.request.body })
            wPlan.push({ id: `smart:${pick.endpointId}`, role: 'data', name: pick.serverName, host, priceUsd: pick.priceUsd, endpoint: pick.endpointUrl, url: pick.request.url, method: pick.request.method, body: pick.request.body, prepared: challenge ? derivePayment(challenge, walletAddress) : null })
          }
          const infProtocol = inferenceProtocolOf(inference)
          const infTool = inference.tool ?? (infProtocol === 'http' ? 'openai/gpt-4o-mini' : 'ask_claude')
          const infChallenge = await getChallenge(inference.endpoint!, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: infProtocol === 'http' ? inferenceBody('http', infTool, 'probe') : dummyMcpBody(infTool),
          })
          wPlan.push({ id: `inference:${inference.slug}`, role: 'inference', name: inference.name, host: infHost, priceUsd: inference.priceUsd ?? '0.01', endpoint: inference.endpoint!, tool: infTool, protocol: infProtocol, prepared: infChallenge ? derivePayment(infChallenge, walletAddress) : null })
          const payments = wPlan
            .filter((c) => c.prepared)
            .map((c) => ({ id: c.id, name: c.name, host: c.host, priceUsd: c.priceUsd, signing: c.prepared!.signing as SigningRequest }))
          // Carry the turnId so the wallet's execute phase persists its
          // settlements under THIS turn → they show in the live feed, grouped
          // with the plan trace.
          send({ type: 'plan', plan: wPlan, payments, listedOnly: [], notes: decision.notes, turnId })
          recordTurn({ payer: 'your wallet', shortlisted: shortlistedOf(decision), picks: picksOf(decision), intent: intentOf(decision) })
          return finish()
        }

        // ── Burner mode: multi-step loop. executeCall pays + gates + ledgers +
        //    streams each chosen call; routeMessage chains resolve→fetch and
        //    feeds results back, returning the gathered context to answer with.
        const executeCall = async (pick: SmartPick): Promise<{ data?: unknown; error?: string }> => {
          const host = hostOf(pick.request.url)
          const price = Number(pick.priceUsd)
          // Cache: an identical recent GET read is served for $0.00, no payment,
          // no gate (there's nothing to spend). Reads only; never actions/fails.
          const cacheable = isCacheable(pick.request)
          const cacheKey = cacheable ? routeCacheKey(pick.request) : ''
          if (cacheable) {
            const hit = getCached(cacheKey)
            if (hit !== undefined) {
              send({ type: 'note', level: 'info', label: `↺ ${pick.serverName}: served from cache ($0.00)` })
              const r: Receipt = { name: pick.serverName, endpoint: host, priceUsd: '0.00', ok: true, note: 'cached' }
              receipts.push(r)
              send({ type: 'receipt', receipt: r })
              savedUsd += Number(pick.priceUsd) || 0 // a re-pay avoided
              return { data: hit }
            }
          }
          if (policy && grant) {
            const violation = grantViolation(policy, host, price, spentToday, spentTotal)
            if (violation) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: pick.serverName, amountUsd: 0, ok: false, note: violation })
              const r: Receipt = { name: pick.serverName, endpoint: host, priceUsd: pick.priceUsd, ok: false, note: `blocked: ${violation}`, slug: violation === 'NOT_ALLOWED' ? pick.serverSlug : undefined }
              receipts.push(r)
              send({ type: 'receipt', receipt: r })
              return { error: `blocked: ${violation}` }
            }
          }
          send({ type: 'pay', service: pick.serverName, host, priceUsd: pick.priceUsd })
          const payStart = Date.now()
          try {
            const { json, txHash } = await paidCall(pick.request)
            const latencyMs = Date.now() - payStart
            const r: Receipt = { name: pick.serverName, endpoint: host, priceUsd: pick.priceUsd, txHash, ok: true }
            receipts.push(r)
            send({ type: 'receipt', receipt: r })
            if (grant) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, apiKeyId, host, serviceName: pick.serverName, amountUsd: price, ok: true, txHash, note: 'settled', latencyMs })
              spentToday += price
              spentTotal += price
            }
            // Cache a successful read — but NEVER a signable action (votes/txns
            // are time-sensitive + per-user) and never a non-GET.
            if (cacheable && !buildSignableArtifact(json)) setCached(cacheKey, json)
            return { data: json }
          } catch (err) {
            const note = err instanceof Error ? err.message : 'call failed'
            const r: Receipt = { name: pick.serverName, endpoint: host, priceUsd: pick.priceUsd, ok: false, note }
            receipts.push(r)
            send({ type: 'receipt', receipt: r })
            // Record the FAILED attempt (no spend) so reputation + failure-aware
            // routing learn from broken/dead endpoints — without this, a dead
            // gateway is invisible to the engine and gets picked again forever.
            // `error:`-prefixed so the public activity "blocked by policy" stat
            // (policy refusals) doesn't count call failures.
            if (grant) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, apiKeyId, host, serviceName: pick.serverName, amountUsd: 0, ok: false, note: `error: ${note}`.slice(0, 200) })
            }
            // Deduplicated incident for the self-heal loop (groups by service +
            // error class; links to this turn's trace). Fire-and-forget.
            recordIncident({ service: pick.serverName, message: note, turnId })
            return { error: note }
          }
        }

        const decision = await routeMessage({ message, history, catalog, onStep: (s) => send(s), runInference: runRoutingInference, executeCall })

        // Transaction layer: a routed tool returned a signable action — surface
        // it for explicit approval instead of synthesizing an answer. Votes reuse
        // the existing SignVoteButton (voteRequest meta); a raw tx rides txRequest.
        if (decision.artifact) {
          if (decision.artifact.kind === 'eip712-vote') {
            send({ type: 'reply', content: `🗳️ ${decision.artifact.summary}`, receipts, payer: 'the house wallet', voteRequest: decision.artifact.vote, trace: trace() })
          } else {
            send({ type: 'reply', content: `🔏 ${decision.artifact.summary}`, receipts, payer: 'the house wallet', txRequest: decision.artifact.tx, trace: trace() })
          }
          recordTurn({ payer: 'the house wallet', shortlisted: shortlistedOf(decision), picks: picksOf(decision), intent: intentOf(decision) })
          return finish()
        }

        // Re-gate the answer call against the now-higher running total.
        if (policy && grant) {
          const violation = grantViolation(policy, infHost, infPrice, spentToday, spentTotal)
          if (violation) {
            await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: infHost, serviceName: inference.name, amountUsd: 0, ok: false, note: violation })
            send({
              type: 'reply',
              content: `🚫 Your spend policy blocked the answer (${inference.name}: ${violation}). Raise the caps on your **Dashboard**.`,
              receipts,
              payer: 'the house wallet',
              blocked: true,
            })
            recordTurn({ blocked: true, payer: 'the house wallet', shortlisted: shortlistedOf(decision), picks: picksOf(decision), intent: intentOf(decision) })
            return finish()
          }
        }

        send({ type: 'status', label: 'Synthesizing the answer…' } satisfies TraceStep)
        const synthStart = Date.now()
        const { text, txHash } = await callInference(inference, buildPrompt(message, decision.context, history))
        const synthLatencyMs = Date.now() - synthStart
        const r: Receipt = { name: inference.name, endpoint: infHost, priceUsd: inference.priceUsd ?? '0.01', txHash, ok: true }
        receipts.push(r)
        send({ type: 'receipt', receipt: r })
        if (grant) {
          await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, apiKeyId, host: infHost, serviceName: inference.name, amountUsd: infPrice, ok: true, txHash, note: 'settled', latencyMs: synthLatencyMs })
        }

        // Value proof (B15): what smart routing saved this turn vs naive routing.
        const shortlistStep = decision.trace.find((s) => s.type === 'shortlist')
        const shortlistPrices = shortlistStep && shortlistStep.type === 'shortlist' ? shortlistStep.candidates.map((c) => Number(c.priceUsd) || 0) : []
        const sv = routeSavings({ shortlistPrices, pickPrices: decision.smartPicks.map((p) => Number(p.priceUsd) || 0), cacheSavedUsd: savedUsd })
        const routeReport = {
          considered: shortlistedOf(decision),
          picked: decision.smartPicks.map((p) => p.serverName),
          spentUsd: receipts.filter((r) => r.ok).reduce((a, r) => a + (Number(r.priceUsd) || 0), 0),
          cacheSavedUsd: sv.cacheSavedUsd,
          savedVsPriciestUsd: sv.savedVsPriciestUsd,
        }
        send({
          type: 'reply',
          content: text + infoFooter([], decision.notes),
          receipts,
          payer: 'the house wallet',
          routeReport,
          trace: trace(),
        })
        recordTurn({ payer: 'the house wallet', shortlisted: shortlistedOf(decision), picks: picksOf(decision), intent: intentOf(decision) })
        finish()
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'auto-router failed' })
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
}

/**
 * Inference request body for either transport. `http` = an OpenAI-compatible
 * x402 gateway (BlockRun): `tool` carries the gateway model id, output capped
 * at 256 tokens to match the flat per-call price tier.
 */
function inferenceBody(protocol: 'mcp' | 'http', tool: string, prompt: string): string {
  if (protocol === 'http') {
    return JSON.stringify({
      model: tool,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 256,
    })
  }
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: { prompt } },
  })
}

function parseInferenceText(protocol: 'mcp' | 'http', contentType: string, raw: string): string {
  if (protocol === 'http') {
    try {
      const json = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] }
      const text = json.choices?.[0]?.message?.content
      if (typeof text === 'string' && text.trim()) return text.trim()
    } catch {
      /* fall through */
    }
    throw new Error('Gateway returned no completion text.')
  }
  return parseClaudeText(contentType, raw)
}

function inferenceProtocolOf(s: { protocol?: string | null }): 'mcp' | 'http' {
  return s.protocol === 'http' ? 'http' : 'mcp'
}

/**
 * BlockRun prices per request size: flat $0.001 up to ~2.4K input tokens, then
 * it grows. The wallet flow signs the plan-time amount, so the execute-time
 * prompt must stay inside the same (flat) price tier — cap http prompts well
 * under the threshold. MCP (Yeetful · Claude) is flat-priced; no cap needed.
 */
const HTTP_PROMPT_MAX_CHARS = 4000
function capPrompt(protocol: 'mcp' | 'http', prompt: string): string {
  return protocol === 'http' ? truncate(prompt, HTTP_PROMPT_MAX_CHARS) : prompt
}

// The planner is the product, so the routing/SELECTION call always runs on a
// known-good model via the direct Anthropic API (house key) — decoupled from
// whichever paid engine ends up ANSWERING. This keeps picks reliable no matter
// what the answer engine is, and sidesteps the x402 self-pay break (a from==to
// transfer when the answer engine's payTo is the house burner). Returns null on
// any failure or when no key is set, so the caller falls back to the paid MCP.
const PLANNER_MODEL = process.env.PLANNER_MODEL || 'claude-haiku-4-5-20251001'
async function planViaAnthropic(prompt: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: PLANNER_MODEL, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
    const text = (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim()
    return text || null
  } catch {
    return null
  }
}

async function callInference(
  inference: Pick<McpServer, 'endpoint' | 'tool' | 'protocol'>,
  prompt: string,
) {
  const protocol = inferenceProtocolOf(inference)
  const tool = inference.tool ?? (protocol === 'http' ? 'openai/gpt-4o-mini' : 'ask_claude')
  const res = await getPaidFetch()(inference.endpoint!, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: inferenceBody(protocol, tool, capPrompt(protocol, prompt)),
    signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(await failureReason(res))
  const text = parseInferenceText(protocol, res.headers.get('content-type') ?? '', await res.text())
  return { text, txHash: decodeSettlement(res)?.transaction }
}

// ── shared MCP parsing ─────────────────────────────────────────────────────────

interface JsonRpcResult {
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }
  error?: { code: number; message: string }
}

function parseClaudeText(contentType: string, raw: string): string {
  const parsed = parseMcpBody(contentType, raw)
  if (parsed.error) throw new Error(parsed.error.message)
  const text =
    parsed.result?.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim() ?? ''
  if (!text) throw new Error('inference returned an empty completion')
  return text
}

// MCP Streamable HTTP may answer with application/json or an SSE stream.
function parseMcpBody(contentType: string, raw: string): JsonRpcResult {
  if (contentType.includes('text/event-stream')) {
    const data = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('')
    return JSON.parse(data) as JsonRpcResult
  }
  return JSON.parse(raw) as JsonRpcResult
}

function dummyMcpBody(tool: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: { prompt: 'ping' } } })
}

// ── MCP data services ──────────────────────────────────────────────────────────
// An MCP *data* service's wired `tool` takes structured args (from `toolArgs`),
// not a free-text prompt. A single tools/call POST works — mcp-handler is
// stateless, same as the inference path. (v1: args are the stored defaults; the
// user's message shapes the LLM's answer, not yet the query — a planner that
// fills MCP args from the message is a follow-up.)
function mcpDataRequest(server: McpServer): {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: string
} {
  const args = server.toolArgs && typeof server.toolArgs === 'object' ? server.toolArgs : {}
  return {
    url: server.endpoint!,
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: server.tool, arguments: args },
    }),
  }
}

/** Parse an MCP data tool result — the data arrives as a JSON string inside
 *  result.content[].text. Throws on transport/tool errors. */
function parseMcpDataResult(contentType: string, raw: string): unknown {
  const parsed = parseMcpBody(contentType, raw)
  if (parsed.error) throw new Error(parsed.error.message)
  const text =
    parsed.result?.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim() ?? ''
  if (parsed.result?.isError) throw new Error(text || 'MCP tool returned an error')
  if (!text) throw new Error('MCP tool returned no content')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildPrompt(message: string, contextBlocks: string[], history: ConversationTurn[] = []): string {
  const convo = answerHistoryBlock(history)
  if (contextBlocks.length === 0) {
    const convoBlock = convo ? `Conversation so far:\n${convo}\n\n` : ''
    return `You are Yeetful, a concise assistant. Continue the conversation and answer the user's latest message directly, using the earlier turns for context.\n\n${convoBlock}User: ${message}`
  }
  return [
    `You are Yeetful, a concise assistant. Use the live data below (fetched and paid for over x402) to answer.`,
    `Cite specifics from the data. If the data doesn't cover it, say so briefly.`,
    ...(convo ? [``, `Conversation so far:`, convo] : []),
    ``,
    `DATA:`,
    contextBlocks.join('\n\n'),
    ``,
    `User question: ${message}`,
  ].join('\n')
}

/**
 * Per-receipt lines and the paid-total used to be embedded here as text; they
 * now render structurally from Message.meta (receipts + payer) — see
 * components/MessageReceipts. Only information with no structured home stays
 * in the reply: listed-only services and planner diagnostics.
 */
function infoFooter(listedOnly: McpServer[], notes: string[] = []): string {
  let footer = ''
  if (listedOnly.length > 0) {
    footer += `\n\nℹ️ Not called this turn: ${listedOnly.map((s) => s.name).join(', ')}`
  }
  if (notes.length > 0) {
    footer += `\n\n⚙️ Diagnostics:\n${notes.map((n) => `· ${n}`).join('\n')}`
  }
  return footer
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function demoReply(message: string, servers: McpServer[]): string {
  const names = servers.map((s) => s.name).join(', ') || 'none'
  return [
    `🔌 **Demo mode** — no payer available.`,
    ``,
    `You asked: “${message}”`,
    `Selected x402 servers: ${names}`,
    ``,
    `Two ways to go live:`,
    `• **Connect a wallet** (top right) with USDC on Base — you'll sign a quick payment per call and pay for your own usage.`,
    `• Or set **PRIVATE_KEY** (a funded Base burner) in \`.env.local\` so the house wallet pays.`,
    ``,
    `Either way, I'll pay each selected Data endpoint for context and the Inference endpoint to answer — all over x402 on Base.`,
  ].join('\n')
}
