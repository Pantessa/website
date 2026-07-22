import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { EVENT_KINDS, INTENT_SLUG_RE, type IntentEventKind } from '@/lib/intent-links'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Best-effort funnel events from the /i runtime (POST, unauthenticated —
 * the visitor has no session yet at 'open'). kind: open|connect|built|signed.
 *
 * Scope note: these power the CREATOR'S per-link funnel only. valueUsd here
 * is client-reported and never feeds the global money-moved metric — that
 * stays guardrail-priced server-side in embed_turns (#478).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!INTENT_SLUG_RE.test(slug)) return NextResponse.json({ error: 'Bad slug.' }, { status: 400 })

  let body: { kind?: string; wallet?: string; valueUsd?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const kind = body.kind as IntentEventKind
  if (!EVENT_KINDS.includes(kind)) return NextResponse.json({ error: 'Bad kind.' }, { status: 400 })

  const link = await prisma.intentLink.findUnique({ where: { id: slug }, select: { id: true, revoked: true } })
  if (!link || link.revoked) return NextResponse.json({ error: 'Unknown link.' }, { status: 404 })

  const wallet = typeof body.wallet === 'string' && /^0x[0-9a-fA-F]{40}$/.test(body.wallet) ? body.wallet.toLowerCase() : null
  const valueUsd =
    (kind === 'built' || kind === 'signed') && typeof body.valueUsd === 'number' && isFinite(body.valueUsd) && body.valueUsd >= 0 && body.valueUsd < 10_000_000
      ? body.valueUsd
      : null

  await prisma.intentLinkEvent.create({ data: { slug, kind, wallet, valueUsd } })
  return NextResponse.json({ ok: true })
}
