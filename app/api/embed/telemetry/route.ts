import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { resolveEmbedKey, sightingOrigin } from '@/lib/embed-key'
import { isBuildPath } from '@/lib/build-path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Per-turn embed telemetry — the client posts one compact beacon after each
// embedded chat turn (and again when something gets signed):
//   { key, sessionId, page?, prompt?, outcome, artifact?, chain?, detail?, txUrl?, valueUsd?, buildPath? }
// KEYED embeds only: telemetry is a feature of the embed key (it's what the
// owner dashboard renders); keyless mounts record nothing here — with ONE
// exception: FIRST-PARTY beacons ({ firstParty: true }, no key) from
// yeetful.com's own chat record value-bearing outcomes (tx-built / signed)
// under embedKeyId '' so the "money moved" metric counts the whole product.
// First-party rows carry NO prompt (chat asks stay private) and are only
// accepted when the reported origin matches this deployment's own host —
// a keyless third-party embed still records nothing. Public + self-reported
// by design (it runs on host sites) — inputs are clamped and allowlisted,
// and a bad beacon is dropped with a 202, never an error.

const OUTCOMES = new Set(['answered', 'clarify', 'tx-built', 'signed', 'refused', 'credit-gate', 'error'])
const FIRST_PARTY_OUTCOMES = new Set(['tx-built', 'signed'])
const ARTIFACTS = new Set(['cow-order', 'tx', 'tx-chain', 'vote'])

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined

/** Notional USD of the built/signed transaction — self-reported, so clamp to
 * a sane range and round to cents. Undefined on anything non-numeric. */
const usd = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(Math.min(v, 1e9) * 100) / 100 : undefined

/** True when the beacon's origin is THIS deployment (www/apex tolerant) —
 * the gate that keeps keyless third-party embeds out of the first-party lane. */
function isOwnOrigin(origin: string, req: NextRequest): boolean {
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0].trim().toLowerCase()
  if (!host) return false
  try {
    const beaconHost = new URL(origin).host.toLowerCase()
    const bare = (h: string) => h.replace(/^www\./, '')
    return bare(beaconHost) === bare(host)
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const key = typeof body.key === 'string' ? body.key : ''
  const resolved = await resolveEmbedKey(key)
  const sessionId = typeof body.sessionId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.sessionId) ? body.sessionId : null
  const outcome = typeof body.outcome === 'string' && OUTCOMES.has(body.outcome) ? body.outcome : null
  const origin = sightingOrigin(body.page, req.headers.get('referer'))

  // First-party lane: yeetful.com's own chat, keyless by nature. Only
  // value-bearing outcomes, only from our own origin, never a prompt.
  const firstParty =
    !resolved &&
    body.firstParty === true &&
    !!outcome &&
    FIRST_PARTY_OUTCOMES.has(outcome) &&
    !!origin &&
    isOwnOrigin(origin, req)

  if ((!resolved && !firstParty) || !sessionId || !outcome || !origin) {
    return NextResponse.json({ ok: false }, { status: 202 })
  }

  const artifact = typeof body.artifact === 'string' && ARTIFACTS.has(body.artifact) ? body.artifact : undefined
  try {
    await prisma.embedTurn.create({
      data: {
        embedKeyId: resolved?.id ?? '',
        ownerAddress: resolved?.ownerAddress ?? null,
        origin,
        sessionId,
        prompt: firstParty ? '' : (str(body.prompt, 280) ?? ''),
        outcome,
        artifact,
        chain: str(body.chain, 40),
        detail: firstParty ? undefined : str(body.detail, 220),
        txUrl: str(body.txUrl, 300),
        valueUsd: usd(body.valueUsd),
        // Which layer built the artifact — allowlisted (self-reported like
        // everything here); anything unrecognized is dropped, not stored.
        buildPath: isBuildPath(body.buildPath) ? body.buildPath : undefined,
      },
    })
  } catch {
    // telemetry never breaks a host page
    return NextResponse.json({ ok: false }, { status: 202 })
  }
  return NextResponse.json({ ok: true })
}
