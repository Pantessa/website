import { NextRequest, NextResponse } from 'next/server'
import { getPaidFetch, hasAgentWallet } from '@/lib/agent-wallet'
import { decodeSettlement, failureReason } from '@/lib/x402'
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const message: string = body.message ?? ''
    const activeServers: McpServer[] = Array.isArray(body.activeServers) ? body.activeServers : []

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

    // No agent wallet → demo mode (explain how to go live).
    if (!hasAgentWallet()) {
      return NextResponse.json({ reply: demoReply(message, activeServers) })
    }

    // Need a live inference provider to phrase an answer.
    if (!inference) {
      const picked = activeServers.find((s) => s.kind === 'inference')
      const hint = picked
        ? `“${picked.name}” isn't wired for live x402 yet. Add **Yeetful · Claude** — it's the live inference provider.`
        : 'Add an **Inference** server (e.g. **Yeetful · Claude**) so I can answer.'
      return NextResponse.json({ reply: `⚡ ${hint}` })
    }

    const receipts: Receipt[] = []
    const contextBlocks: string[] = []

    // 1) Pay each callable Data server for context.
    for (const ds of dataServers) {
      try {
        const { json, txHash } = await paidGet(ds.endpoint!, ds.queryParam ?? 'q', message)
        contextBlocks.push(`### ${ds.name}\n${truncate(JSON.stringify(json), 1500)}`)
        receipts.push({
          name: ds.name,
          endpoint: hostOf(ds.endpoint!),
          priceUsd: ds.priceUsd ?? '0.01',
          txHash,
          ok: true,
        })
      } catch (err) {
        receipts.push({
          name: ds.name,
          endpoint: hostOf(ds.endpoint!),
          priceUsd: ds.priceUsd ?? '0.01',
          ok: false,
          note: err instanceof Error ? err.message : 'call failed',
        })
      }
    }

    // 2) Pay the Inference server to answer using the gathered data.
    const prompt = buildPrompt(message, contextBlocks)
    const { text, txHash } = await askClaude(inference.endpoint!, inference.tool ?? 'ask_claude', prompt)
    receipts.push({
      name: inference.name,
      endpoint: hostOf(inference.endpoint!),
      priceUsd: inference.priceUsd ?? '0.01',
      txHash,
      ok: true,
    })

    const reply = text + paymentsFooter(receipts, listedOnly)
    return NextResponse.json({ reply, receipts })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Chat request failed'
    console.error('Chat error:', error)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

// ── x402 callers ─────────────────────────────────────────────────────────────

async function paidGet(endpoint: string, queryParam: string, value: string) {
  const url = new URL(endpoint)
  url.searchParams.set(queryParam, value)
  const res = await getPaidFetch()(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(await failureReason(res))
  const txHash = decodeSettlement(res)?.transaction
  const json = await res.json()
  return { json, txHash }
}

async function askClaude(endpoint: string, tool: string, prompt: string) {
  const res = await getPaidFetch()(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: tool, arguments: { prompt } },
    }),
  })
  if (!res.ok) throw new Error(await failureReason(res))
  const txHash = decodeSettlement(res)?.transaction
  const parsed = parseMcpBody(res.headers.get('content-type') ?? '', await res.text())
  if (parsed.error) throw new Error(parsed.error.message)
  const text =
    parsed.result?.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim() ?? ''
  if (!text) throw new Error('inference returned an empty completion')
  return { text, txHash }
}

interface JsonRpcResult {
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }
  error?: { code: number; message: string }
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

function paymentsFooter(receipts: Receipt[], listedOnly: McpServer[]): string {
  const paid = receipts.filter((r) => r.ok)
  const spent = paid.reduce((sum, r) => sum + Number(r.priceUsd || 0), 0)
  const lines = receipts.map(
    (r) =>
      `${r.ok ? '✓' : '✗'} ${r.name} · $${r.priceUsd}${r.txHash ? ` · tx ${short(r.txHash)}` : ''}${
        r.note ? ` · ${r.note}` : ''
      }`,
  )
  let footer = `\n\n———\n💸 Paid ~$${spent.toFixed(2)} over ${paid.length} x402 call${
    paid.length === 1 ? '' : 's'
  } on Base\n${lines.join('\n')}`
  if (listedOnly.length > 0) {
    footer += `\n\nℹ️ Directory-only (not wired for live calls yet): ${listedOnly
      .map((s) => s.name)
      .join(', ')}`
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
    `🔌 **Demo mode** — no agent wallet configured.`,
    ``,
    `You asked: “${message}”`,
    `Selected x402 servers: ${names}`,
    ``,
    `To go live, set **PRIVATE_KEY** (a funded Base burner with USDC) in \`.env.local\`. ` +
      `Then I'll pay each selected Data endpoint for context and pay the Inference endpoint to answer — all over x402, settled in USDC on Base.`,
  ].join('\n')
}
