import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mirror a directory runner toggle into the DB so the admin adoption view can
// rank which agents get picked (the `agent_added` / `agent_removed` analytics
// events, which Vercel won't hand back by slug). Public + fire-and-forget: the
// client never awaits the result, and a signed-out (guest) toggle still counts
// with a null address. Body: { slug: string, active: boolean }.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const slug = typeof body.slug === 'string' ? body.slug.slice(0, 200) : null
  if (!slug || typeof body.active !== 'boolean') {
    return NextResponse.json({ error: 'slug (string) and active (boolean) required.' }, { status: 400 })
  }

  // Best-effort attribution: record the wallet if signed in, else null. Never
  // fail the request over auth — a guest toggle is a legitimate event.
  const address = (await getSessionAddress().catch(() => null))?.toLowerCase() ?? null

  try {
    await prisma.agentToggleEvent.create({
      data: { slug, active: body.active, address },
    })
  } catch {
    // Telemetry must never surface as an error to the toggling user.
    return NextResponse.json({ ok: false }, { status: 200 })
  }
  return NextResponse.json({ ok: true })
}
