import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { resolveEmbedKey, sightingOrigin } from '@/lib/embed-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Per-turn embed telemetry — the client posts one compact beacon after each
// embedded chat turn (and again when something gets signed):
//   { key, sessionId, page?, prompt?, outcome, artifact?, chain?, detail?, txUrl? }
// KEYED embeds only: telemetry is a feature of the embed key (it's what the
// owner dashboard renders); keyless mounts record nothing here. Public +
// self-reported by design (it runs on host sites) — inputs are clamped and
// allowlisted, and a bad beacon is dropped with a 202, never an error.

const OUTCOMES = new Set(['answered', 'clarify', 'tx-built', 'signed', 'refused', 'credit-gate', 'error'])
const ARTIFACTS = new Set(['cow-order', 'tx', 'tx-chain', 'vote'])

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const key = typeof body.key === 'string' ? body.key : ''
  const resolved = await resolveEmbedKey(key)
  const sessionId = typeof body.sessionId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.sessionId) ? body.sessionId : null
  const outcome = typeof body.outcome === 'string' && OUTCOMES.has(body.outcome) ? body.outcome : null
  const origin = sightingOrigin(body.page, req.headers.get('referer'))

  if (!resolved || !sessionId || !outcome || !origin) {
    return NextResponse.json({ ok: false }, { status: 202 })
  }

  const artifact = typeof body.artifact === 'string' && ARTIFACTS.has(body.artifact) ? body.artifact : undefined
  try {
    await prisma.embedTurn.create({
      data: {
        embedKeyId: resolved.id,
        ownerAddress: resolved.ownerAddress,
        origin,
        sessionId,
        prompt: str(body.prompt, 280) ?? '',
        outcome,
        artifact,
        chain: str(body.chain, 40),
        detail: str(body.detail, 220),
        txUrl: str(body.txUrl, 300),
      },
    })
  } catch {
    // telemetry never breaks a host page
    return NextResponse.json({ ok: false }, { status: 202 })
  }
  return NextResponse.json({ ok: true })
}
