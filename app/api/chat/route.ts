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
  tool?: string // inference tool name
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
  const { text, txHash } = await askClaude(
    inference.endpoint!,
    inference.tool ?? 'ask_claude',
    plannerPrompt(message, smart),
  )
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
      (s) => s.kind === 'inference' && s.callable && s.endpoint && s.protocol === 'mcp',
    )
    const dataServers = activeServers.filter(
      (s) => s.kind === 'data' && s.callable && s.endpoint && s.protocol === 'http',
    )
    const listedOnly = activeServers.filter((s) => !s.callable)

    // Need a live inference provider to phrase an answer.
    if (!inference) {
      const picked = activeServers.find((s) => s.kind === 'inference')
      const hint = picked
        ? `“${picked.name}” isn't wired for live x402 yet. Add **Yeetful · Claude** — it's the live inference provider.`
        : 'Add an **Inference** server (e.g. **Yeetful · Claude**) so I can answer.'
      return NextResponse.json({ reply: `⚡ ${hint}` })
    }

    // Auto-callable endpoints for selected services that aren't hand-wired.
    // Planning costs one extra inference call, paid by the house wallet — so
    // smart calls need the burner even in wallet mode.
    const smart = hasAgentWallet() ? await loadSmartEndpoints(listedOnly) : []

    // ── Phase 1 (wallet): plan + return signing requests ─────────────────────
    if (walletAddress) {
      return await planWalletPayments(message, inference, dataServers, listedOnly, walletAddress, smart)
    }

    // ── Burner mode: the server's agent wallet pays everything in one shot ────
    if (hasAgentWallet()) {
      return await runWithBurner(message, inference, dataServers, listedOnly, smart)
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
  listedOnly: McpServer[],
  walletAddress: string,
  smart: PlannableEndpoint[],
) {
  const plan: PlannedCall[] = []

  for (const ds of dataServers) {
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

  // Smart calls: the planner (house-paid) picks endpoints for selected
  // directory services; the user's wallet signs the actual data payments.
  const smartServed = new Set<string>()
  if (smart.length > 0) {
    try {
      const { picks } = await planSmartPicks(inference, message, smart)
      const byId = new Map(smart.map((e) => [e.id, e]))
      for (const pick of picks) {
        const ep = byId.get(pick.endpointId)!
        const built = buildSmartRequest(ep, pick.params)
        if ('error' in built) continue
        const { request } = built
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
      console.warn('smart planning failed (continuing without):', err instanceof Error ? err.message : err)
    }
  }
  const stillListedOnly = listedOnly.filter((s) => !smartServed.has(s.slug))

  // Inference: the 402 gate is body-independent, so probe with a tiny dummy body.
  const infChallenge = await getChallenge(inference.endpoint!, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: dummyMcpBody(inference.tool ?? 'ask_claude'),
  })
  plan.push({
    id: `inference:${inference.slug}`,
    role: 'inference',
    name: inference.name,
    host: hostOf(inference.endpoint!),
    priceUsd: inference.priceUsd ?? '0.01',
    endpoint: inference.endpoint!,
    tool: inference.tool ?? 'ask_claude',
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
  })
}

/** Phase 2: attach the wallet's signatures, run the paid calls, answer. */
async function executeWithSignatures(
  message: string,
  plan: PlannedCall[],
  signatures: Record<string, string>,
  listedOnly: McpServer[],
) {
  if (!message.trim()) return NextResponse.json({ error: 'message is required' }, { status: 400 })

  const receipts: Receipt[] = []
  const contextBlocks: string[] = []
  const inferenceCall = plan.find((c) => c.role === 'inference')

  // Data calls first → gather context. Smart calls carry method/body.
  for (const c of plan.filter((c) => c.role === 'data')) {
    try {
      const header = paymentHeaderFor(c, signatures)
      const init: RequestInit = {
        method: c.method ?? 'GET',
        headers: {
          accept: 'application/json',
          ...(c.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(c.body ? { body: c.body } : {}),
      }
      const res = await fetchWithPaymentHeader(c.url!, init, header)
      if (!res.ok) throw new Error(await failureReason(res))
      const json = await res.json()
      contextBlocks.push(`### ${c.name}\n${truncate(JSON.stringify(json), 1500)}`)
      receipts.push({ name: c.name, endpoint: c.host, priceUsd: c.priceUsd, txHash: decodeSettlement(res)?.transaction, ok: true })
    } catch (err) {
      receipts.push({ name: c.name, endpoint: c.host, priceUsd: c.priceUsd, ok: false, note: err instanceof Error ? err.message : 'call failed' })
    }
  }

  if (!inferenceCall) {
    return NextResponse.json({ error: 'No inference call in plan.' }, { status: 400 })
  }

  // Inference with the real prompt (signed authorization is body-independent).
  const prompt = buildPrompt(message, contextBlocks)
  const header = paymentHeaderFor(inferenceCall, signatures)
  const res = await fetchWithPaymentHeader(
    inferenceCall.endpoint,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: inferenceCall.tool ?? 'ask_claude', arguments: { prompt } },
      }),
    },
    header,
  )
  if (!res.ok) throw new Error(await failureReason(res))
  const text = parseClaudeText(res.headers.get('content-type') ?? '', await res.text())
  receipts.push({ name: inferenceCall.name, endpoint: inferenceCall.host, priceUsd: inferenceCall.priceUsd, txHash: decodeSettlement(res)?.transaction, ok: true })

  const reply = text + paymentsFooter(receipts, listedOnly, 'your wallet')
  return NextResponse.json({ reply, receipts })
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
  listedOnly: McpServer[],
  smart: PlannableEndpoint[] = [],
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
        await recordLedger({ grantId: grant.id, host, amountUsd: 0, ok: false, note: violation })
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
        await recordLedger({ grantId: grant.id, host, amountUsd: price, ok: true, txHash, note: 'settled' })
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
          await recordLedger({ grantId: grant.id, host: infHost, amountUsd: infPrice, ok: true, txHash, note: 'settled' })
          spentToday += infPrice
          spentTotal += infPrice
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
              await recordLedger({ grantId: grant.id, host, amountUsd: 0, ok: false, note: violation })
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
              await recordLedger({ grantId: grant.id, host, amountUsd: price, ok: true, txHash: dataTx, note: 'settled' })
              spentToday += price
              spentTotal += price
            }
          } catch (err) {
            receipts.push({ name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, ok: false, note: err instanceof Error ? err.message : 'call failed' })
          }
        }
      } catch (err) {
        console.warn('smart planning failed (continuing without):', err instanceof Error ? err.message : err)
      }
    }
  }

  // Inference is the call that actually answers — if the grant blocks it, stop.
  if (policy && grant) {
    const violation = grantViolation(policy, infHost, infPrice, spentToday, spentTotal)
    if (violation) {
      await recordLedger({ grantId: grant.id, host: infHost, amountUsd: 0, ok: false, note: violation })
      const also = blocked.length ? ` Also blocked: ${blocked.join(', ')}.` : ''
      return NextResponse.json({
        reply: `🚫 Your spend grant blocked the inference call (${inference.name}: ${violation}).${also} Adjust the grant's allowlist or caps and try again.`,
        receipts,
        blocked: true,
      })
    }
  }

  const prompt = buildPrompt(message, contextBlocks)
  const { text, txHash } = await askClaude(inference.endpoint!, inference.tool ?? 'ask_claude', prompt)
  receipts.push({ name: inference.name, endpoint: infHost, priceUsd: inference.priceUsd ?? '0.01', txHash, ok: true })
  if (grant) {
    await recordLedger({ grantId: grant.id, host: infHost, amountUsd: infPrice, ok: true, txHash, note: 'settled' })
    spentToday += infPrice
  }

  let reply = text + paymentsFooter(receipts, listedOnly.filter((s) => !smartServed.has(s.slug)), 'the house wallet')
  if (grant && policy) {
    reply += `\n\n— spend grant “${grant.label}”: $${spentToday.toFixed(2)}/$${policy.perDayUsd} today`
    if (blocked.length) reply += ` · blocked ${blocked.join(', ')}`
  }
  return NextResponse.json({ reply, receipts })
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

async function askClaude(endpoint: string, tool: string, prompt: string) {
  const res = await getPaidFetch()(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: { prompt } } }),
  })
  if (!res.ok) throw new Error(await failureReason(res))
  const text = parseClaudeText(res.headers.get('content-type') ?? '', await res.text())
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

function paymentsFooter(receipts: Receipt[], listedOnly: McpServer[], payer: string): string {
  const paid = receipts.filter((r) => r.ok)
  const spent = paid.reduce((sum, r) => sum + Number(r.priceUsd || 0), 0)
  const lines = receipts.map(
    (r) =>
      `${r.ok ? '✓' : '✗'} ${r.name} · $${r.priceUsd}${r.txHash ? ` · tx ${short(r.txHash)}` : ''}${
        r.note ? ` · ${r.note}` : ''
      }`,
  )
  let footer = `\n\n———\n💸 Paid ~$${spent.toFixed(2)} from ${payer} over ${paid.length} x402 call${
    paid.length === 1 ? '' : 's'
  } on Base\n${lines.join('\n')}`
  if (listedOnly.length > 0) {
    footer += `\n\nℹ️ Directory-only (not wired for live calls yet): ${listedOnly.map((s) => s.name).join(', ')}`
  }
  return footer
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
function short(tx: string): string {
  return tx.length > 14 ? `${tx.slice(0, 8)}…${tx.slice(-4)}` : tx
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
