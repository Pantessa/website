import { NextRequest, NextResponse } from 'next/server'
import { inboxFor } from '@/lib/inbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The connected wallet's inbox — the U1 rail feed. Public read by address
// (?wallet=0x…): the same exposure as the /inbox/<address> page itself, which
// is public by design (any /i ask is public by slug; signing is the gate).
// Connect-to-act (#553): seeing your inbox never requires SIWE.
export async function GET(req: NextRequest) {
  const wallet = (req.nextUrl.searchParams.get('wallet') ?? '').trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return NextResponse.json({ error: 'Bad wallet.' }, { status: 400 })
  const items = await inboxFor(wallet).catch(() => [])
  return NextResponse.json({
    items: items.map((i) => ({
      slug: i.slug,
      ask: i.ask,
      from: i.senderLabel ?? i.agent ?? null,
      createdAt: i.createdAt,
      // THE ROSTER (R2): the slot badge — the card says WHICH mandate is
      // proposing, not just who. Canonical DB-stored text only (T2).
      ...(i.roster ? { roster: { kind: i.roster.kind, label: i.roster.label, mandate: i.roster.mandate, capUsd: i.roster.capUsd } } : {}),
    })),
  })
}
