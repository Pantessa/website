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
} from '@/lib/endpoint-planner'

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

/** Ask the inference model to pick endpoints + params for the user message. */
async function planSmartPicks(
  inference: McpServer,
  message: string,
  smart: PlannableEndpoint[],
): Promise<{ picks: PlannedPick[]; txHash?: string }> {
  const { text, txHash } = await callInference(inference, plannerPrompt(message, smart))
  return { picks: parsePlannerPicks(text, smart), txHash }
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
      )
    }

    const message: string = body.message ?? ''
    const activeServers: McpServer[] = Array.isArray(body.activeServers) ? body.activeServers : []
    const walletAddress: string | undefined =
      typeof body.walletAddress === 'string' && isAddress(body.walletAddress)
        ? getAddress(body.walletAddress)
        : undefined

    if (!message.trim()) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
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
      return await planWalletPayments(message, inference, dataServers, mcpDataServers, listedOnly, walletAddress, smart, notes)
    }

    // ── Burner mode: the server's agent wallet pays everything in one shot ────
    if (hasAgentWallet()) {
      return await runWithBurner(message, inference, dataServers, mcpDataServers, listedOnly, smart, notes)
    }

    // ── Demo mode: nothing can pay ───────────────────────────────────────────
    return NextResponse.json({ reply: demoReply(message, activeServers) })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Chat request failed'
    console.error('Chat error:', error)
    return NextResponse.json({ error: msg }, { status: 502 })
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
      const { picks } = await planSmartPicks(inference, message, smart)
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
) {
  if (!message.trim()) return NextResponse.json({ error: 'message is required' }, { status: 400 })

  const receipts: Receipt[] = []
  const contextBlocks: string[] = []
  const inferenceCall = plan.find((c) => c.role === 'inference')

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
      contextBlocks.push(`### ${c.name}\n${truncate(JSON.stringify(data), 1500)}`)
      const txHash = decodeSettlement(res)?.transaction
      receipts.push({ name: c.name, endpoint: c.host, priceUsd: c.priceUsd, txHash, ok: true })
      ledger(c, true, txHash)
    } catch (err) {
      const note = err instanceof Error ? err.message : 'call failed'
      receipts.push({ name: c.name, endpoint: c.host, priceUsd: c.priceUsd, ok: false, note })
      ledger(c, false, undefined, truncate(note, 120))
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
  const prompt = capPrompt(execProtocol, buildPrompt(message, contextBlocks))
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
  receipts.push({ name: inferenceCall.name, endpoint: inferenceCall.host, priceUsd: inferenceCall.priceUsd, txHash: infTx, ok: true })
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
) {
  const receipts: Receipt[] = []
  const contextBlocks: string[] = []

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
        receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', ok: false, note: `blocked: ${violation}` })
        blocked.push(`${ds.name} (${violation})`)
        continue
      }
    }

    try {
      const { json, txHash } = await paidGet(ds.endpoint!, ds.queryParam ?? 'q', message)
      contextBlocks.push(`### ${ds.name}\n${truncate(JSON.stringify(json), 1500)}`)
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
        receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', ok: false, note: `blocked: ${violation}` })
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
      contextBlocks.push(`### ${ds.name}\n${truncate(JSON.stringify(data), 1500)}`)
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
        const { picks, txHash } = await planSmartPicks(inference, message, smart)
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
              receipts.push({ name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, ok: false, note: `blocked: ${violation}` })
              blocked.push(`${ep.serverName} (${violation})`)
              continue
            }
          }
          try {
            const { json, txHash: dataTx } = await paidCall(request)
            contextBlocks.push(`### ${ep.serverName}\n${truncate(JSON.stringify(json), 1500)}`)
            receipts.push({ name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, txHash: dataTx, ok: true })
            smartServed.add(ep.serverSlug)
            if (grant) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ep.serverName, amountUsd: price, ok: true, txHash: dataTx, note: 'settled' })
              spentToday += price
              spentTotal += price
            }
          } catch (err) {
            receipts.push({ name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, ok: false, note: err instanceof Error ? err.message : 'call failed' })
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

  const prompt = buildPrompt(message, contextBlocks)
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
  return NextResponse.json({ reply, receipts, payer: 'the house wallet' })
}

async function paidGet(endpoint: string, queryParam: string, value: string) {
  const url = new URL(endpoint)
  url.searchParams.set(queryParam, value)
  const res = await getPaidFetch()(url.toString(), { method: 'GET', headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(await failureReason(res))
  return { json: await res.json(), txHash: decodeSettlement(res)?.transaction }
}

/** Pay + execute a planner-built request (GET with query or POST with body). */
async function paidCall(request: { url: string; method: string; headers: Record<string, string>; body?: string }) {
  const res = await getPaidFetch()(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body ? { body: request.body } : {}),
  })
  if (!res.ok) throw new Error(await failureReason(res))
  return { json: await res.json(), txHash: decodeSettlement(res)?.transaction }
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

function buildPrompt(message: string, contextBlocks: string[]): string {
  if (contextBlocks.length === 0) {
    return `You are Yeetful, a concise assistant. Answer the user directly.\n\nUser: ${message}`
  }
  return [
    `You are Yeetful, a concise assistant. Use the live data below (fetched and paid for over x402) to answer.`,
    `Cite specifics from the data. If the data doesn't cover it, say so briefly.`,
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
