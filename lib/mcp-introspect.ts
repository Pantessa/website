// MCP tool discovery — introspect any MCP server straight from its base URL.
//
// Powers the "Add MCP Server" flow (POST /api/servers): paste a base URL like
// https://cow-mcp.yeetful.com/ and we discover every tool via a JSON-RPC
// `tools/list` call to `<origin>/mcp`, then map each tool into the routable
// endpoint shape the planner understands (`lib/endpoint-planner.ts`
// loadPlannableEndpoints + mcpToolOf). No agentic.market, no hand-wiring — the
// endpoints come entirely from the server's own advertised schema.

export interface DiscoveredParam {
  group: 'body'
  name: string
  type?: string
  description?: string
  required?: boolean
  enumValues?: string[]
  /** JSON-Schema `pattern` — a server-side regex the value must match. Captured
   *  so the planner menu can surface the required format; without it a
   *  regex-constrained param (e.g. Aave `build_supply.currency`) reaches the
   *  routing model as a bare string and gets filled with a value the tool
   *  rejects (`-32602 … validation:"regex"`). */
  pattern?: string
  /** A representative value the schema advertises (`examples[0]`/`default`) —
   *  shown in the menu to steer the model toward a valid form. */
  example?: unknown
}

export interface DiscoveredTool {
  name: string
  title?: string
  description?: string
  params: DiscoveredParam[]
  /** false ⇒ display-only (param-less, or a state-changing/signing tool the
   *  planner must never construct with guessed args — mirrors seed-cow-free). */
  plannable: boolean
}

/** An MCP-declared icon (spec SEP-973, initialize→result.serverInfo.icons).
 *  `src` is an absolute https:// URL or a data: URI. */
export interface McpIcon {
  src: string
  mimeType?: string
  sizes?: string
  theme?: 'light' | 'dark'
}

/** The `serverInfo` an MCP returns from `initialize` — its own name/branding.
 *  All fields best-effort: many servers omit icons/title/websiteUrl. */
export interface McpServerInfo {
  name?: string
  title?: string
  websiteUrl?: string
  icons?: McpIcon[]
}

export interface McpDiscovery {
  /** The normalized `<origin>/mcp` base the planner posts tools/call to. */
  base: string
  tools: DiscoveredTool[]
  /** The server's self-declared identity from `initialize`, when it answers.
   *  Used to auto-pull a logo (serverInfo.icons) at add time. */
  serverInfo?: McpServerInfo
}

/** Names that mutate state or need a signed envelope — never planner-callable
 *  (the planner can't fabricate a signature, and a guessed submit/cancel is
 *  dangerous). Matches the plannable:false set the free-mcp seeds hand-curate
 *  (submit_order, cancel_orders, …). `build_*` stays plannable — it only
 *  constructs typed data the user signs. */
const MUTATING_RE = /(^|_)(submit|cancel|send|sign|execute|relay|approve|revoke|delete|withdraw|transfer|deposit)(_|$)/i

/**
 * Normalize a user-pasted URL to the MCP endpoint (`<origin>/mcp`). Accepts the
 * bare host, the origin, or a URL already ending in `/mcp`.
 */
export function normalizeMcpBase(input: string): string {
  const trimmed = input.trim()
  const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  let path = u.pathname.replace(/\/+$/, '') // drop trailing slash(es)
  if (!/\/mcp$/i.test(path)) path = `${path}/mcp`
  return `${u.origin}${path}`
}

/** Reject non-https and private/loopback hosts — the stored base is called
 *  server-side by the router, so an internal URL would be an SSRF vector. */
export function assertPublicHttps(base: string): void {
  const u = new URL(base)
  if (u.protocol !== 'https:') throw new Error('MCP URL must use https://')
  const host = u.hostname.toLowerCase()
  const isPrivate =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  if (isPrivate) throw new Error('MCP URL must be a public host')
}

type JsonSchemaProp = {
  type?: string | string[]
  description?: string
  enum?: unknown[]
  pattern?: string
  examples?: unknown[]
  default?: unknown
}
type ToolDef = {
  name?: string
  title?: string
  description?: string
  inputSchema?: { properties?: Record<string, JsonSchemaProp>; required?: string[] }
}

function mapType(t?: string | string[]): string | undefined {
  const v = Array.isArray(t) ? t.find((x) => x !== 'null') : t
  if (v === 'integer') return 'number'
  return v
}

function toParams(tool: ToolDef): DiscoveredParam[] {
  const props = tool.inputSchema?.properties ?? {}
  const required = new Set(tool.inputSchema?.required ?? [])
  return Object.entries(props).map(([name, prop]) => {
    const enumValues = Array.isArray(prop.enum) ? prop.enum.map(String) : undefined
    const pattern = typeof prop.pattern === 'string' && prop.pattern.length > 0 ? prop.pattern : undefined
    const example =
      Array.isArray(prop.examples) && prop.examples.length > 0 ? prop.examples[0] : prop.default
    return {
      group: 'body' as const,
      name,
      type: mapType(prop.type),
      description: typeof prop.description === 'string' ? prop.description : undefined,
      required: required.has(name),
      ...(enumValues ? { enumValues } : {}),
      ...(pattern ? { pattern } : {}),
      ...(example !== undefined && example !== null ? { example } : {}),
    }
  })
}

/** Parse a Streamable-HTTP MCP response, which may be SSE
 *  (`event: message\ndata: {json}`) or a plain JSON body. Returns the parsed
 *  JSON-RPC result object that carries `.tools`, or null. */
function extractToolsPayload(body: string): { tools?: unknown } | null {
  const tryParse = (s: string): { result?: { tools?: unknown }; tools?: unknown } | null => {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }
  // Whole body as JSON first.
  const whole = tryParse(body)
  if (whole?.result && typeof whole.result === 'object') return whole.result as { tools?: unknown }
  if (whole && 'tools' in whole) return whole as { tools?: unknown }
  // Otherwise walk SSE `data:` lines (last one wins).
  const dataLines = body
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
  for (const line of dataLines.reverse()) {
    const parsed = tryParse(line)
    const result = parsed?.result ?? parsed
    if (result && typeof result === 'object' && 'tools' in result) return result as { tools?: unknown }
  }
  return null
}

/** Parse a JSON-RPC `result` object from a Streamable-HTTP body (SSE or plain
 *  JSON), without requiring any particular key inside it. Last SSE frame wins. */
function extractRpcResult(body: string): Record<string, unknown> | null {
  const tryParse = (s: string): { result?: unknown } | null => {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }
  const whole = tryParse(body)
  if (whole && typeof whole.result === 'object' && whole.result) return whole.result as Record<string, unknown>
  const dataLines = body
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
  for (const line of dataLines.reverse()) {
    const parsed = tryParse(line)
    if (parsed && typeof parsed.result === 'object' && parsed.result) return parsed.result as Record<string, unknown>
  }
  return null
}

/** Absolute-ize an icon `src`: pass through https:// and data: URIs, and
 *  resolve site-relative paths against the server origin. Drops anything else
 *  (a malformed src shouldn't poison the logo field). */
function normalizeIconSrc(src: unknown, origin: string): string | null {
  if (typeof src !== 'string' || !src) return null
  if (/^data:image\//i.test(src)) return src
  try {
    const u = new URL(src, origin)
    return u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

function parseServerInfo(result: Record<string, unknown> | null, origin: string): McpServerInfo | undefined {
  const si = result?.serverInfo
  if (!si || typeof si !== 'object') return undefined
  const s = si as Record<string, unknown>
  const rawIcons = Array.isArray(s.icons) ? (s.icons as Record<string, unknown>[]) : []
  const icons = rawIcons
    .map((ic) => {
      const src = normalizeIconSrc(ic?.src, origin)
      return src ? ({ src, mimeType: typeof ic.mimeType === 'string' ? ic.mimeType : undefined, sizes: typeof ic.sizes === 'string' ? ic.sizes : undefined } as McpIcon) : null
    })
    .filter((x): x is McpIcon => x !== null)
  const info: McpServerInfo = {
    name: typeof s.name === 'string' ? s.name : undefined,
    title: typeof s.title === 'string' ? s.title : undefined,
    websiteUrl: typeof s.websiteUrl === 'string' ? s.websiteUrl : undefined,
    ...(icons.length > 0 ? { icons } : {}),
  }
  return info
}

/**
 * Best-effort `initialize` handshake to read the server's own `serverInfo`
 * (name/title/icons — MCP spec SEP-973). Never throws: a server that doesn't
 * answer initialize (or omits serverInfo) just yields `undefined`, and tool
 * discovery proceeds regardless.
 */
export async function discoverServerInfo(base: string, timeoutMs = 8_000): Promise<McpServerInfo | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'yeetful-directory', version: '1.0' },
        },
      }),
      signal: controller.signal,
    })
    if (!res.ok) return undefined
    const info = parseServerInfo(extractRpcResult(await res.text()), new URL(base).origin)
    // Only return something if it actually carries a usable field.
    if (info && (info.name || info.title || info.websiteUrl || info.icons)) return info
    return undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** The single best logo icon from a serverInfo, preferring a dark-theme mark
 *  (our UI is dark) then the first declared. Returns its `src` or null. */
export function bestIconSrc(info?: McpServerInfo): string | null {
  if (!info?.icons?.length) return null
  const dark = info.icons.find((i) => i.theme === 'dark')
  return (dark ?? info.icons[0]).src
}

/**
 * Discover the full tool surface of an MCP server from its base URL.
 * Throws on unreachable/invalid servers so the caller can report why.
 */
export async function discoverMcpTools(input: string, timeoutMs = 10_000): Promise<McpDiscovery> {
  const base = normalizeMcpBase(input)
  assertPublicHttps(base)

  // The server's own branding (serverInfo.icons) rides along, in parallel and
  // best-effort — it must never block or fail tool discovery.
  const serverInfoP = discoverServerInfo(base)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    throw new Error(`Could not reach the MCP server at ${base}`)
  }
  clearTimeout(timer)

  if (!res.ok) throw new Error(`MCP server returned HTTP ${res.status} for tools/list`)

  const text = await res.text()
  const payload = extractToolsPayload(text)
  const rawTools = payload && Array.isArray(payload.tools) ? (payload.tools as ToolDef[]) : null
  if (!rawTools) throw new Error('MCP server did not return a tools/list — not an MCP endpoint?')

  const tools: DiscoveredTool[] = rawTools
    .filter((t) => typeof t.name === 'string' && t.name.length > 0)
    .map((t) => {
      const params = toParams(t)
      // Display-only when param-less (nothing for the planner to fill) or the
      // name signals a mutating/signing action.
      const plannable = params.length > 0 && !MUTATING_RE.test(t.name!)
      return {
        name: t.name!,
        title: typeof t.title === 'string' ? t.title : undefined,
        description: typeof t.description === 'string' ? t.description : undefined,
        params,
        plannable,
      }
    })

  return { base, tools, serverInfo: await serverInfoP }
}
