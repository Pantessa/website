// ─────────────────────────────────────────────────────────────────────────
//  POST /api/servers/[slug]/lint — the server page's "Run diagnostics".
//
//  Runs the routability linter (lib/mcp-lint) against one service and saves
//  the report to mcp_servers.routability. A lint run costs a handful of
//  house planner calls (direct Anthropic) + live probes, so it's throttled:
//  a fresh-enough saved report is returned as-is (cached: true) instead of
//  re-running. No auth needed — the report is public data about a public
//  service, and the cooldown bounds the spend.
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { lintService, type RoutabilityReport } from '@/lib/mcp-lint'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120 // planner-in-the-loop makes a few model calls

const COOLDOWN_MS = 10 * 60 * 1000

export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const server = await prisma.mcpServer.findUnique({ where: { slug }, select: { routability: true } })
    if (!server) return NextResponse.json({ error: 'unknown service' }, { status: 404 })

    // Fresh enough → serve the saved report (the button shows it instantly).
    const saved = server.routability as unknown as RoutabilityReport | null
    if (saved?.lintedAt && Date.now() - new Date(saved.lintedAt).getTime() < COOLDOWN_MS) {
      return NextResponse.json({ report: saved, cached: true })
    }

    const report = await lintService(slug, { probe: true, planner: true })
    if (!report) return NextResponse.json({ error: 'unknown service' }, { status: 404 })
    await prisma.mcpServer.update({ where: { slug }, data: { routability: report as unknown as object } })
    return NextResponse.json({ report, cached: false })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'lint failed' }, { status: 502 })
  }
}
