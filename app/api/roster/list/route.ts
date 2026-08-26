import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { mintSlug } from '@/lib/intent-links'
import {
  assertRosterOpen,
  bumpAndCheckRosterPost,
  clientIpFrom,
  consentExpired,
  mandateHash,
  mintRosterNonce,
  ROSTER_CONSENT_TTL_MS,
  ROSTER_RATE_WALL,
  rosterListConsentMessage,
  verifyRosterConsent,
} from '@/lib/roster-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// WAVE-2 discovery — LIST / UNLIST a slot on the public open-slots feed.
//
// Publishing a mandate is a state change on owner data, so listing is
// OWNER-SIGNED (two-step consent, consentAction='list' — the same nonce
// machinery as hire/fire; security threat model T-D2). What goes public is
// the mandate's kind, canonical sentence, and cap — NEVER the wallet: the
// feed's handle for the slot is a dedicated `listToken` (separate from the
// slot id so the public roster GET never becomes a reverse-resolver), and
// broker_open resolves it server-side at engagement time (T-D1).
//
// Listing targets PENDING slots only (a job listing is a pre-hire object).
// The consent signature also exempts the slot from the 24h draft purge —
// a listed slot is owner-PROVEN, not a squattable draft. Unlisting is the
// exit door: session-owner one-step, never walled by the kill switch, and
// it nulls the token (re-listing mints a fresh one).

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/

export async function POST(req: NextRequest) {
  let body: { slotId?: unknown; wallet?: unknown; signature?: unknown; unlist?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const unlisting = body.unlist === true
  try {
    assertRosterOpen(unlisting ? 'unlist' : 'list')
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }
  if (await bumpAndCheckRosterPost(clientIpFrom(req.headers))) {
    return NextResponse.json({ error: ROSTER_RATE_WALL }, { status: 429 })
  }

  const slotId = typeof body.slotId === 'string' ? body.slotId.trim() : ''
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : ''
  if (!slotId || !WALLET_RE.test(wallet)) return NextResponse.json({ error: 'slotId and wallet are required.' }, { status: 400 })
  const w = wallet.toLowerCase()

  const slot = await prisma.rosterSlot.findUnique({ where: { id: slotId } }).catch(() => null)
  if (!slot) return NextResponse.json({ error: 'No such roster slot.' }, { status: 404 })
  if (slot.walletAddress !== w) return NextResponse.json({ error: 'That slot belongs to a different wallet.' }, { status: 403 })

  // ── UNLIST — the exit door: session owner, one step, never walled ───────
  if (unlisting) {
    const session = await getAuthAddress(req).catch(() => null)
    if (session?.toLowerCase() !== w) {
      return NextResponse.json({ error: 'Sign in as the slot wallet to unlist.' }, { status: 401 })
    }
    const updated = await prisma.rosterSlot.update({
      where: { id: slot.id },
      data: { listed: false, listToken: null },
      select: { id: true, listed: true, status: true },
    })
    return NextResponse.json({ slot: updated })
  }

  if (slot.status !== 'pending') {
    return NextResponse.json(
      { error: `Only an open (pending) slot lists on the feed — this one is ${slot.status}. A hired slot is a filled job.` },
      { status: 409 },
    )
  }
  if (slot.listed && slot.listToken && body.signature == null) {
    return NextResponse.json({ error: 'This slot is already listed.' }, { status: 409 })
  }

  // ── Step 1: mint the list-consent text ──────────────────────────────────
  if (body.signature == null) {
    const nonce = mintRosterNonce()
    const expiresAt = new Date(Date.now() + ROSTER_CONSENT_TTL_MS)
    await prisma.rosterSlot.update({
      where: { id: slot.id },
      data: { consentNonce: nonce, consentAction: 'list', consentExpiresAt: expiresAt },
    })
    return NextResponse.json({
      consentText: rosterListConsentMessage({
        slotId: slot.id,
        wallet: w,
        mandateHash: mandateHash(slot.mandateText),
        capUsd: slot.capUsd,
        nonce,
        expiresAt,
      }),
      expiresAt: expiresAt.toISOString(),
    })
  }

  // ── Step 2: verify against the ROW, then publish ────────────────────────
  if (!slot.consentNonce || slot.consentAction !== 'list' || !slot.consentExpiresAt) {
    return NextResponse.json({ error: 'No list consent is pending for this slot — request the consent text first.' }, { status: 409 })
  }
  if (consentExpired(slot.consentExpiresAt)) {
    return NextResponse.json({ error: 'The list consent expired — request a fresh consent text and sign again.' }, { status: 409 })
  }
  const message = rosterListConsentMessage({
    slotId: slot.id,
    wallet: w,
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

  const listed = await prisma.rosterSlot.update({
    where: { id: slot.id },
    data: {
      listed: true,
      listToken: mintSlug(12),
      consentNonce: null,
      consentAction: null,
      consentExpiresAt: null,
    },
    select: { id: true, listed: true, listToken: true, mandateKind: true, mandateText: true, capUsd: true, status: true },
  })
  return NextResponse.json({ slot: listed })
}
