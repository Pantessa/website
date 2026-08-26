import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { bumpAndCheckRosterFeed, clientIpFrom, rosterEnabled, ROSTER_RATE_WALL } from '@/lib/roster-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// WAVE-2 discovery — GET /api/roster/feed: the public open-slots feed.
//
// The 50 newest OWNER-LISTED open mandate slots: kind, canonical sentence
// (grammar-constrained — threat T2), cap, and the slot's listToken. The
// WALLET NEVER RIDES THE FEED (threat T-D1) — an agent courts a listing by
// calling broker_open with slot_token, and the wallet is disclosed only at
// that engagement (kill-switched, rate-fenced, auditable). Stamped
// (is_internal) slots never list (T-D4). Take-50, no cursor — bulk
// enumeration is the attack, the 50 newest is the product (T-D3).

const HOW =
  'Court a listing: broker_open on /api/broker/mcp with slot_token. The employer wallet is disclosed only at engagement; only their signature ever moves anything.'

const WALLET_HEX_RE = /0x[0-9a-fA-F]{40}/

export async function GET(req: NextRequest) {
  // A dark roster advertises nothing (fail-closed) — existing hires remain
  // visible on their own roster pages; the growth surface goes quiet.
  if (!rosterEnabled()) return NextResponse.json({ slots: [], how: HOW })
  if (await bumpAndCheckRosterFeed(clientIpFrom(req.headers))) {
    return NextResponse.json({ error: ROSTER_RATE_WALL }, { status: 429 })
  }
  const rows = await prisma.rosterSlot
    .findMany({
      where: { listed: true, status: 'pending', isInternal: false, listToken: { not: null } },
      select: { listToken: true, mandateKind: true, mandateText: true, capUsd: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })
    .catch(() => [])
  const payload = {
    slots: rows.map((r) => ({
      slotToken: r.listToken,
      kind: r.mandateKind,
      mandate: r.mandateText,
      capUsd: r.capUsd,
      listedAt: r.updatedAt,
    })),
    how: HOW,
  }
  // Mechanical belt (T-D1, pinned): no wallet address may EVER ride the
  // feed. If one somehow lands in a mandate sentence, serve nothing rather
  // than a target list.
  if (WALLET_HEX_RE.test(JSON.stringify(payload.slots))) {
    return NextResponse.json({ slots: [], how: HOW })
  }
  return NextResponse.json(payload)
}
