import { NextResponse } from 'next/server'
import { isAddress } from 'viem'
import prisma from '@/lib/db'
import type { McpServer } from '@/lib/store'
import { buildSplash, type FeaturedEndpoint, type SplashServer } from '@/lib/splash/sources'
import type { RowsTile, StatRow, SuggestedPrompt } from '@/lib/splash/types'
import { chainByKey } from '@/lib/chains'
import { listDcaSchedules } from '@/lib/dca-exec'
import { cadenceLabel, dcaRunChip, periodPhrase } from '@/lib/dca'

/** The wallet's recurring buys as a rows tile — due periods lead with their
 *  one-tap chip (the resume-string contract from lib/dca.ts). Env-fenced in
 *  the store; fail-soft: a DB hiccup never blanks the rest of the splash. */
async function dcaTileFor(address: string): Promise<RowsTile | null> {
  const schedules = await listDcaSchedules(address).catch(() => [])
  if (schedules.length === 0) return null
  const rows: StatRow[] = schedules.map((s) => {
    const chip = dcaRunChip(s)
    const due = s.status === 'active' && s.period === 'due'
    return {
      label: `$${s.buyUsd} → ${s.buyToken} ${cadenceLabel(s.cadence)}`,
      sub: `on ${s.chainName}`,
      chartSymbol: s.buyToken,
      value: s.status === 'paused' ? 'paused' : s.period === 'bought' ? `bought ${periodPhrase(s.cadence)}` : s.period === 'live' ? 'awaiting signature' : 'due now',
      tone: due ? ('pos' as const) : undefined,
      actions: [
        ...(due ? [{ label: chip.label, prompt: chip.prompt }] : []),
        s.status === 'paused'
          ? { label: 'Resume', prompt: `resume my ${s.buyToken} dca` }
          : { label: 'Pause', prompt: `pause my ${s.buyToken} dca` },
        { label: 'Cancel', prompt: `cancel my ${s.buyToken} dca` },
      ],
    }
  })
  const dueChips: SuggestedPrompt[] = schedules
    .filter((s) => s.status === 'active' && s.period === 'due')
    .map((s) => {
      const chip = dcaRunChip(s)
      return { label: chip.label, prompt: chip.prompt }
    })
  return {
    id: 'dca-schedules',
    mcpSlug: 'yeetful',
    mcpName: 'Recurring buys',
    title: 'DCA · you sign every buy',
    render: 'rows',
    rows,
    prompts: dueChips.length > 0 ? dueChips.slice(0, 4) : [{ label: 'List my recurring buys', prompt: 'list my dcas' }],
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Derive an MCP base URL (…/mcp) from a stored server row: its own `endpoint`
 *  column, else the shared prefix of a child endpoint url — free MCPs keep the
 *  base only in `mcp_endpoints` (the `<base>/mcp#tool` or `/mcp/tool`
 *  convention), so `mcp_servers.endpoint` is null for them. */
function mcpBaseOf(endpoint: string | null, childUrl: string | null): string | null {
  for (const u of [endpoint, childUrl]) {
    if (!u) continue
    const m = u.match(/^(.+\/mcp)(?:[#/].*)?$/)
    if (m) return m[1]
  }
  return null
}

/**
 * The connected-wallet splash. Given a wallet address and the connected MCP
 * set (by slug), returns a tile per MCP that has an "overview" read (Uniswap
 * portfolio, Snapshot proposals, …). Base URLs are resolved server-side from
 * the DB — the client doesn't carry free-MCP endpoints. Pure free-MCP reads:
 * no spend, no auth. The chat UI paints this before the first keystroke.
 */
export async function POST(req: Request) {
  let body: { address?: string; servers?: Pick<McpServer, 'slug'>[]; manualSlugs?: string[]; chain?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  // The chain picker's selection ('base'/'ethereum'/…) — unknown keys mean
  // no filter, same as the "All chains" default.
  const chain = typeof body.chain === 'string' ? chainByKey(body.chain) : null

  const address = typeof body.address === 'string' ? body.address.trim() : ''
  if (!isAddress(address)) {
    // No/invalid wallet → no splash (caller falls back to the normal empty state).
    return NextResponse.json({ address: '', tiles: [] })
  }
  // Recurring buys aren't an MCP — the tile rides on the wallet alone, so a
  // due period surfaces even before any server card resolves.
  const dcaTile = await dcaTileFor(address)
  const slugs = [
    ...new Set((Array.isArray(body.servers) ? body.servers : []).map((s) => s?.slug).filter((s): s is string => !!s)),
  ]
  if (slugs.length === 0) return NextResponse.json({ address, tiles: dcaTile ? [dcaTile] : [] })
  // MCPs the user explicitly toggled on — these always paint a card (a
  // preview when the wallet has no activity). Only honored for slugs that are
  // in the requested set anyway; this flag can't conjure extra servers.
  const manual = new Set(
    (Array.isArray(body.manualSlugs) ? body.manualSlugs : []).filter((s): s is string => typeof s === 'string'),
  )

  try {
    const rows = await prisma.mcpServer.findMany({
      where: { slug: { in: slugs } },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        endpoint: true,
        exampleQueries: true,
        endpoints: { select: { url: true }, take: 1 },
      },
    })
    // Featured ("ping first") endpoints drive the generic quick-view tile for
    // MCPs with no hand-coded splash source.
    const featuredRows = await prisma.mcpEndpoint.findMany({
      where: { server: { slug: { in: slugs } }, featured: true },
      select: { serverId: true, url: true, description: true, parameters: true },
      orderBy: { position: 'asc' },
    })
    const featuredByServer = new Map<string, typeof featuredRows>()
    for (const f of featuredRows) {
      featuredByServer.set(f.serverId, [...(featuredByServer.get(f.serverId) ?? []), f])
    }
    // Resolve each to a minimal server carrying the MCP base URL for buildSplash.
    const resolved: SplashServer[] = rows
      .map((r) => {
        const base = mcpBaseOf(r.endpoint, r.endpoints[0]?.url ?? null)
        // No callable base normally means no card — but a hand-picked MCP
        // still gets its preview (buildSplash skips the tool calls for it).
        if (!base && !manual.has(r.slug)) return null
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          description: r.description,
          endpoint: base,
          exampleQueries: r.exampleQueries,
          forceShow: manual.has(r.slug),
          featuredEndpoints: (featuredByServer.get(r.id) ?? []).map((f) => ({
            url: f.url,
            description: f.description,
            parameters: Array.isArray(f.parameters) ? (f.parameters as FeaturedEndpoint['parameters']) : null,
          })),
        } as SplashServer
      })
      .filter((s): s is SplashServer => s !== null)

    const tiles = await buildSplash(address, resolved, chain)
    return NextResponse.json({ address, tiles: dcaTile ? [dcaTile, ...tiles] : tiles })
  } catch (err) {
    return NextResponse.json({ address, tiles: dcaTile ? [dcaTile] : [], error: err instanceof Error ? err.message : 'splash failed' })
  }
}
