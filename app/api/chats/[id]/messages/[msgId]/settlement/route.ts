import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { isTerminal, settlementOf } from '@/lib/xchain-settlement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; msgId: string }> }

// Record the VENUE's verdict on a cross-chain swap onto a message's
// meta.settlement — the durable half of lib/xchain-settlement, so the /p
// share page tells the same story the live card does (delivered, or
// refunded, never "settled" for either until the venue says SUCCESS).
//
// Owner only, terminal outcomes only, and the outcome is re-narrowed here
// through the same pure reader the UI uses — nothing else in meta is
// writable from this route. Like the signing log next door, the record is
// evidence the owner's own browser reports: it decorates their own share
// page and moves no money.

export async function POST(req: NextRequest, { params }: Params) {
  const { id, msgId } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const chat = await prisma.chat.findUnique({ where: { id } })
  if (!chat || chat.ownerAddress !== addr) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const message = await prisma.message.findUnique({ where: { id: msgId } })
  if (!message || message.chatId !== id) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const outcome = settlementOf({ settlement: body.outcome })
  if (!outcome) return NextResponse.json({ error: 'outcome must be a settlement record.' }, { status: 400 })
  if (!isTerminal(outcome.status)) {
    return NextResponse.json({ error: 'Only a terminal outcome is recorded.' }, { status: 400 })
  }

  const meta = (message.meta && typeof message.meta === 'object' ? message.meta : {}) as Record<string, unknown>
  const updated = await prisma.message.update({
    where: { id: msgId },
    data: { meta: JSON.parse(JSON.stringify({ ...meta, settlement: outcome })) as object },
  })
  return NextResponse.json({ ok: true, settlement: (updated.meta as { settlement?: unknown }).settlement ?? null })
}
