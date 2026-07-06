import { NextRequest, NextResponse } from 'next/server'
import { discoverMcpTools } from '@/lib/mcp-introspect'

/**
 * Read-only MCP tool discovery for the Add Server form's auto-fill — introspects
 * a public MCP base URL (`tools/list`) and returns the tool surface so the UI can
 * preview the endpoints (same shape the server detail page renders) before the
 * user saves. No DB write, no auth; SSRF-guarded to public https hosts by
 * discoverMcpTools.
 */
export async function POST(req: NextRequest) {
  let body: { url?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  try {
    const { base, tools } = await discoverMcpTools(url)
    return NextResponse.json({
      base,
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
