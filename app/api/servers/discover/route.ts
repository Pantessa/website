import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { discoverMcpTools, bestIconSrc } from '@/lib/mcp-introspect'

/**
 * Read-only MCP tool discovery for the Add Server form's auto-fill — introspects
 * a public MCP base URL (`tools/list`) and returns the tool surface so the UI can
 * preview the endpoints (same shape the server detail page renders) before the
 * user saves. No DB write; SSRF-guarded to public https hosts by
 * discoverMcpTools. Signed-in callers only (2026-09-08, SECURITY-AUDIT §LOW):
 * the modal is signed-in-only past this step, and an open introspection
 * door is a free outbound-request amplifier against any public MCP.
 */
export async function POST(req: NextRequest) {
  const viewer = await getSessionAddress().catch(() => null)
  if (!viewer) return NextResponse.json({ error: 'Sign in to request an MCP.' }, { status: 401 })
  let body: { url?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  try {
    const { base, tools, serverInfo } = await discoverMcpTools(url)
    return NextResponse.json({
      base,
      // The server's self-declared branding, for logo/name auto-fill.
      serverInfo: serverInfo ?? null,
      logoUrl: bestIconSrc(serverInfo),
      tools: tools.map((t) => ({
        name: t.name,
        title: t.title ?? null,
        description: t.description ?? null,
        params: t.params,
        plannable: t.plannable,
        // The endpoint URL that will be stored/routed, matching the server page.
        url: `${base}/${t.name}`,
      })),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'MCP discovery failed' },
      { status: 502 }
    )
  }
}
