// Direct MCP tool call, outside the endpoint planner. Used by the splash
// dashboard to read a connected MCP's "overview" tools (balances, proposals)
// for the connected wallet. These are all FREE MCP reads (never x402-gated),
// so a plain fetch is enough — no burner wallet required.
//
// Mirrors the JSON-RPC `tools/call` + envelope-unwrap the chat route does for
// prepare_vote (app/api/chat/route.ts), kept as a small shared primitive so
// any server-side caller can hit one tool without the planner.

interface JsonRpcResult {
  result?: { content?: { type: string; text?: string }[]; isError?: boolean }
  error?: { message: string }
}

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

/** Unwrap an MCP tools/call response to its JSON (or text) payload. Throws on
 *  a JSON-RPC error or an isError tool result. */
export function parseMcpResult(contentType: string, raw: string): unknown {
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

/**
 * Call one MCP tool by name and return its parsed payload. `endpoint` is the
 * service's `/mcp` URL (a trailing `#tool` fragment, the planner's convention,
 * is ignored by fetch). Times out so a slow MCP never hangs the splash.
 */
export async function callMcpTool(
  endpoint: string,
  name: string,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`MCP ${name} failed: ${res.status}`)
  return parseMcpResult(res.headers.get('content-type') ?? '', await res.text())
}
