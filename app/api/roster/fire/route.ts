import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import {
  assertRosterOpen,
  bumpAndCheckRosterPost,
  clientIpFrom,
  consentExpired,
  mintRosterNonce,
  ROSTER_CONSENT_TTL_MS,
  ROSTER_RATE_WALL,
  rosterFireConsentMessage,
  verifyRosterConsent,
} from '@/lib/roster-policy'
import { fireCascade } from '@/lib/roster-propose'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Firing must be EASIER than hiring — never wall the exit (security
// CONTRACTS v1 §2–3). assertRosterOpen('fire') is a no-op BY CONTRACT: with
// the roster dark, an existing hire can still be fired. Two doors:
//
//   • SIWE session matching the slot's wallet → fires directly, no popup.
//   • Consent signature (two-step like hire): {slotId, wallet} → consent
//     text; {slotId, wallet, signature} → verify → fired.
//
// fired is TERMINAL: states only move rightward; re-hiring is a new slot.
// A pending draft has no hire to undo — firing it just deletes the draft.

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/
const FIREABLE = ['hired', 'benched']

export async function POST(req: NextRequest) {
  assertRosterOpen('fire') // no-op by contract — kept so the contract is visible here
  if (await bumpAndCheckRosterPost(clientIpFrom(req.headers))) {
    return NextResponse.json({ error: ROSTER_RATE_WALL }, { status: 429 })
  }

  let body: { slotId?: unknown; wallet?: unknown; signature?: unknown }
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

  const fire = async () => {
    const fired = await prisma.rosterSlot.update({
      where: { id: slot.id },
      data: { status: 'fired', consentNonce: null, consentAction: null, consentExpiresAt: null },
      select: { id: true, status: true, agentKeyHash: true, mandateKind: true },
    })
    // T5 cascade (R2): a fired agent's pending cards vanish — every UNSIGNED
    // addressed link bound to the slot revokes (the /i runtime's revoked-link
    // refusal walls anyone mid-flow) and its broker intents close. Signed
    // history is never touched.
    await fireCascade(slot.id)
    return NextResponse.json({ slot: fired })
  }

  // A pending draft: deleting is the honest verb. Session owner OR anyone
  // holding... no — drafts are private; only the session owner or the
  // consent path may remove one. Connect-to-act drafts self-clean in 24h.
  const session = await getAuthAddress(req).catch(() => null)
  const sessionOwner = session?.toLowerCase() === w

  if (slot.status === 'pending') {
    if (!sessionOwner) {
      return NextResponse.json(
        { error: 'Drafts self-clean after 24h; sign in to remove one immediately.' },
        { status: 401 },
      )
    }
    await prisma.rosterSlot.delete({ where: { id: slot.id } }).catch(() => {})
    return NextResponse.json({ deleted: true })
  }
  if (!FIREABLE.includes(slot.status)) {
    // Fired is terminal for the STATE machine, but the row itself is the
    // owner's history — a signed-in owner may remove it (also how the
    // harness releases its throwaway rows).
    if (slot.status === 'fired' && sessionOwner) {
      await prisma.rosterSlot.delete({ where: { id: slot.id } }).catch(() => {})
      return NextResponse.json({ deleted: true })
    }
    return NextResponse.json({ error: `This slot is already ${slot.status}.` }, { status: 409 })
  }

  // Door 1 — SIWE session for this exact wallet.
  if (sessionOwner) return fire()

  // Door 2 — consent signature, two-step.
  if (body.signature == null) {
    const nonce = mintRosterNonce()
    const expiresAt = new Date(Date.now() + ROSTER_CONSENT_TTL_MS)
    await prisma.rosterSlot.update({
      where: { id: slot.id },
      data: { consentNonce: nonce, consentAction: 'fire', consentExpiresAt: expiresAt },
    })
    return NextResponse.json({
      consentText: rosterFireConsentMessage({ slotId: slot.id, wallet: w, nonce, expiresAt }),
      expiresAt: expiresAt.toISOString(),
    })
  }
  if (!slot.consentNonce || slot.consentAction !== 'fire' || !slot.consentExpiresAt) {
    return NextResponse.json({ error: 'No fire consent is pending for this slot — request the consent text first.' }, { status: 409 })
  }
  if (consentExpired(slot.consentExpiresAt)) {
    return NextResponse.json({ error: 'The fire consent expired — request a fresh consent text and sign again.' }, { status: 409 })
  }
  const message = rosterFireConsentMessage({ slotId: slot.id, wallet: w, nonce: slot.consentNonce, expiresAt: slot.consentExpiresAt })
  try {
    await verifyRosterConsent(message, w, body.signature)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 })
  }
  return fire()
}
