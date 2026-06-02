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
  url?: string // data GET url (with query)
  tool?: string // inference tool name
  prepared: PreparedPayment | null // null = endpoint didn't require payment
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

    // ── Phase 1 (wallet): plan + return signing requests ─────────────────────
    if (walletAddress) {
      return await planWalletPayments(message, inference, dataServers, listedOnly, walletAddress)
    }

    // ── Burner mode: the server's agent wallet pays everything in one shot ────
    if (hasAgentWallet()) {
      return await runWithBurner(message, inference, dataServers, listedOnly)
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
    listedOnly,
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

  // Data calls first → gather context.
  for (const c of plan.filter((c) => c.role === 'data')) {
    try {
      const header = paymentHeaderFor(c, signatures)
      const res = await fetchWithPaymentHeader(c.url!, { method: 'GET', headers: { accept: 'application/json' } }, header)
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
) {
  const receipts: Receipt[] = []
  const contextBlocks: string[] = []

  for (const ds of dataServers) {
    try {
      const { json, txHash } = await paidGet(ds.endpoint!, ds.queryParam ?? 'q', message)
      contextBlocks.push(`### ${ds.name}\n${truncate(JSON.stringify(json), 1500)}`)
      receipts.push({ name: ds.name, endpoint: hostOf(ds.endpoint!), priceUsd: ds.priceUsd ?? '0.01', txHash, ok: true })
    } catch (err) {
      receipts.push({ name: ds.name, endpoint: hostOf(ds.endpoint!), priceUsd: ds.priceUsd ?? '0.01', ok: false, note: err instanceof Error ? err.message : 'call failed' })
    }
  }

  const prompt = buildPrompt(message, contextBlocks)
  const { text, txHash } = await askClaude(inference.endpoint!, inference.tool ?? 'ask_claude', prompt)
  receipts.push({ name: inference.name, endpoint: hostOf(inference.endpoint!), priceUsd: inference.priceUsd ?? '0.01', txHash, ok: true })

  const reply = text + paymentsFooter(receipts, listedOnly, 'the house wallet')
  return NextResponse.json({ reply, receipts })
}

async function paidGet(endpoint: string, queryParam: string, value: string) {
  const url = new URL(endpoint)
  url.searchParams.set(queryParam, value)
  const res = await getPaidFetch()(url.toString(), { method: 'GET', headers: { accept: 'application/json' } })
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
