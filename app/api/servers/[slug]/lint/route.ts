// ─────────────────────────────────────────────────────────────────────────
//  POST /api/servers/[slug]/lint — the server page's "Run diagnostics".
//
//  Runs the routability linter (lib/mcp-lint) against one service and saves
//  the report to mcp_servers.routability. A lint run costs a handful of
//  house planner calls (direct Anthropic) + live probes, so it's throttled:
//  a fresh-enough saved report is returned as-is (cached: true) instead of
//  re-running. READING a saved report is public (public data about a public
//  service). RUNNING a fresh lint needs a signed-in wallet and draws on its
//  own daily fuse (lib/inference-fuse): the per-service cooldown alone let an
//  anonymous loop run ~144 lints a day PER service across the directory, each
//  a handful of house model calls (pricing v2 audit, 2026-09-16).
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { lintService, type RoutabilityReport } from '@/lib/mcp-lint'
import { getSessionAddress } from '@/lib/auth'
import { bumpFuse } from '@/lib/inference-fuse'

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

    if (!(await getSessionAddress())) {
      return NextResponse.json(
        { error: 'Sign in to run diagnostics — a fresh run makes live model calls. The last saved report is public.', report: saved ?? null, signInRequired: true },
        { status: 401 },
      )
    }
    if (await bumpFuse('mcp-lint')) {
      return NextResponse.json(
        { error: 'Diagnostics are at their daily limit — back at midnight UTC. The last saved report is below.', report: saved ?? null },
        { status: 429 },
      )
    }

    const report = await lintService(slug, { probe: true, planner: true })
    if (!report) return NextResponse.json({ error: 'unknown service' }, { status: 404 })
    await prisma.mcpServer.update({ where: { slug }, data: { routability: report as unknown as object } })
    return NextResponse.json({ report, cached: false })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'lint failed' }, { status: 502 })
  }
}
