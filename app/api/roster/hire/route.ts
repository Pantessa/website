import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { isInternalRun } from '@/lib/internal-run'
import { cleanAgentKeyHash } from '@/lib/roster'
import { resolveManagerId } from '@/lib/roster-managers'
import {
  assertRosterOpen,
  bumpAndCheckRosterPost,
  clientIpFrom,
  consentExpired,
  mandateHash,
  mintRosterNonce,
  ROSTER_CONSENT_TTL_MS,
  ROSTER_RATE_WALL,
  rosterHireConsentMessage,
  verifyRosterConsent,
} from '@/lib/roster-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Hiring is a SIGNATURE (security CONTRACTS v1 §1–2) — two-step, no SIWE:
//
//  1. { slotId, wallet, agentKeyHash }  → server mints the nonce + expiry,
//     binds the agent hash to the pending row, and returns the EXACT consent
//     text to personal_sign. The client never composes it.
//  2. { slotId, wallet, signature }     → server recomputes the text FROM
//     THE ROW (agent/mandate/cap can't be swapped after signing), recovers
//     the signer, refuses any wallet but the slot's own, and flips
//     pending → hired. The nonce is single-use and dies on success.

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/

export async function POST(req: NextRequest) {
  try {
    assertRosterOpen('hire')
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }
  if (await bumpAndCheckRosterPost(clientIpFrom(req.headers))) {
    return NextResponse.json({ error: ROSTER_RATE_WALL }, { status: 429 })
  }

  let body: { slotId?: unknown; wallet?: unknown; agentKeyHash?: unknown; managerId?: unknown; signature?: unknown; internalRun?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const slotId = typeof body.slotId === 'string' ? body.slotId.trim() : ''
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : ''
  if (!slotId || !WALLET_RE.test(wallet)) return NextResponse.json({ error: 'slotId and wallet are required.' }, { status: 400 })
  const w = wallet.toLowerCase()

  const slot = await prisma.rosterSlot.findUnique({ where: { id: slotId } }).catch(() => null)
  if (!slot) return NextResponse.json({ error: 'No such roster slot.' }, { status: 404 })
  if (slot.walletAddress !== w) return NextResponse.json({ error: 'That slot belongs to a different wallet.' }, { status: 403 })
  if (slot.status !== 'pending') {
    return NextResponse.json(
      { error: `This slot is ${slot.status} — hiring starts from a pending draft. Fired is terminal; post a new slot to re-hire.` },
      { status: 409 },
    )
  }

  // ── Step 1: mint the consent text ────────────────────────────────────────
  if (body.signature == null) {
    // THE STOREFRONT path (FIRST HIRE sprint): a SERVER-VALIDATED manager id
    // instead of a pasted hash. The id resolves only against the server's
    // own list (house env hash / owner-set founding rows) — a bare hash, or
    // anything not on the list, refuses BY NAME and never reaches consent.
    let agentKeyHash: string | null = null
    if (body.managerId != null) {
      const resolved = await resolveManagerId(body.managerId)
      if (!resolved) {
        return NextResponse.json(
          { error: 'managerId must be one of the storefront\'s own ids (see /api/roster/managers) — a raw hash is not a manager id, and unlisted ids refuse.' },
          { status: 400 },
        )
      }
      agentKeyHash = resolved.agentKeyHash
    } else {
      agentKeyHash = cleanAgentKeyHash(body.agentKeyHash)
    }
    if (!agentKeyHash) {
      return NextResponse.json(
        { error: "agentKeyHash must be the agent's public 16-hex track-record handle (see /agents) — never its raw key." },
        { status: 400 },
      )
    }
    const nonce = mintRosterNonce()
    const expiresAt = new Date(Date.now() + ROSTER_CONSENT_TTL_MS)
    await prisma.rosterSlot.update({
      where: { id: slot.id },
      data: { agentKeyHash, consentNonce: nonce, consentAction: 'hire', consentExpiresAt: expiresAt },
    })
    const consentText = rosterHireConsentMessage({
      slotId: slot.id,
      wallet: w,
      agentKeyHash,
      mandateHash: mandateHash(slot.mandateText),
      capUsd: slot.capUsd,
      nonce,
      expiresAt,
    })
    return NextResponse.json({ consentText, expiresAt: expiresAt.toISOString() })
  }

  // ── Step 2: verify the signature against the ROW ─────────────────────────
  if (!slot.consentNonce || slot.consentAction !== 'hire' || !slot.consentExpiresAt || !slot.agentKeyHash) {
    return NextResponse.json({ error: 'No hire consent is pending for this slot — request the consent text first.' }, { status: 409 })
  }
  if (consentExpired(slot.consentExpiresAt)) {
    return NextResponse.json({ error: 'The hire consent expired — request a fresh consent text and sign again.' }, { status: 409 })
  }
  const message = rosterHireConsentMessage({
    slotId: slot.id,
    wallet: w,
    agentKeyHash: slot.agentKeyHash,
    mandateHash: mandateHash(slot.mandateText),
    capUsd: slot.capUsd,
    nonce: slot.consentNonce,
    expiresAt: slot.consentExpiresAt,
  })
  try {
    await verifyRosterConsent(message, w, body.signature)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 })
  }

  const internalRun = isInternalRun(req.headers, body)
  const hired = await prisma.rosterSlot.update({
    where: { id: slot.id },
    data: {
      status: 'hired',
      // WAVE-2 discovery (T-D5): a filled slot leaves the public feed —
      // product truth and exposure hygiene in one write.
      listed: false,
      listToken: null,
      consentNonce: null,
      consentAction: null,
      consentExpiresAt: null,
      // The stamp is sticky-true: a draft minted internal stays internal.
      ...(internalRun ? { isInternal: true } : {}),
    },
    select: { id: true, status: true, agentKeyHash: true, mandateText: true, mandateKind: true, capUsd: true },
  })
  return NextResponse.json({ slot: hired, ...(internalRun ? { internal: true } : {}) })
}
