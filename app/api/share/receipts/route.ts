import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import {
  SHARE_KINDS,
  dcaShareContent,
  guardianShareContent,
  spotGuardShareContent,
  jobShareContent,
  txShareContent,
  receiptTweetHref,
  shareReceiptUrl,
  viaIdOf,
  type ShareContent,
  type ShareKind,
} from '@/lib/share-receipts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Mint a receipt permalink (POST /api/share/receipts).
 *
 * Body: { kind: 'tx'|'job'|'dca'|'guardian', refId?, chatId?, messageId? }
 *   · tx       — chatId + messageId of a turn whose meta.signed log exists
 *   · job      — refId = job id (any terminal-done job the wallet owns)
 *   · dca      — refId = schedule id
 *   · guardian — refId = policy id
 *
 * The server re-derives EVERYTHING from the owned artifact — the client
 * never supplies headline/copy/numbers, so a share can't claim what didn't
 * happen. Idempotent per (wallet, kind, ref): re-sharing returns the same
 * permalink instead of littering new ones.
 */
export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in to share a receipt.' }, { status: 401 })
  const wallet = addr.toLowerCase()

  let body: { kind?: string; refId?: string; chatId?: string; messageId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const kind = body.kind
  if (!kind || !SHARE_KINDS.has(kind)) {
    return NextResponse.json({ error: "kind must be 'tx' | 'job' | 'dca' | 'guardian' | 'spot-guard'." }, { status: 400 })
  }

  let refId: string | null = null
  let content: ShareContent | null = null

  try {
    if (kind === 'tx') {
      const { chatId, messageId } = body
      if (!chatId || !messageId) return NextResponse.json({ error: 'tx shares need chatId + messageId.' }, { status: 400 })
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })
      if (!chat || chat.ownerAddress.toLowerCase() !== wallet) {
        return NextResponse.json({ error: 'Chat not found.' }, { status: 404 })
      }
      refId = messageId
      content = txShareContent(chat.messages, messageId)
      if (!content) return NextResponse.json({ error: 'That turn has no signed transactions yet.' }, { status: 400 })
    } else if (kind === 'job') {
      if (!body.refId) return NextResponse.json({ error: 'job shares need refId.' }, { status: 400 })
      const job = await prisma.job.findUnique({ where: { id: body.refId }, include: { steps: { orderBy: { seq: 'asc' } } } })
      if (!job || job.wallet.toLowerCase() !== wallet) return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
      if (job.status !== 'done') return NextResponse.json({ error: 'Only completed jobs can be shared.' }, { status: 400 })
      refId = job.id
      content = jobShareContent(job, job.steps.map((s) => ({ ...s, result: s.result as unknown })))
    } else if (kind === 'dca') {
      if (!body.refId) return NextResponse.json({ error: 'dca shares need refId.' }, { status: 400 })
      const s = await prisma.dcaSchedule.findUnique({ where: { id: body.refId } })
      if (!s || s.wallet.toLowerCase() !== wallet) return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 })
      refId = s.id
      content = dcaShareContent(s)
    } else if (kind === 'spot-guard') {
      if (!body.refId) return NextResponse.json({ error: 'spot-guard shares need refId.' }, { status: 400 })
      const p = await prisma.spotGuardPolicy.findUnique({
        where: { id: body.refId },
        include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      })
      if (!p || p.wallet.toLowerCase() !== wallet) return NextResponse.json({ error: 'Protection not found.' }, { status: 404 })
      refId = p.id
      content = spotGuardShareContent(p, p.runs[0] ?? null)
    } else {
      if (!body.refId) return NextResponse.json({ error: 'guardian shares need refId.' }, { status: 400 })
      const p = await prisma.hlGuardianPolicy.findUnique({
        where: { id: body.refId },
        include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      })
      if (!p || p.wallet.toLowerCase() !== wallet) return NextResponse.json({ error: 'Protection not found.' }, { status: 404 })
      refId = p.id
      content = guardianShareContent(p, p.runs[0] ?? null)
    }
  } catch {
    return NextResponse.json({ error: 'Could not read that artifact.' }, { status: 500 })
  }

  const via = viaIdOf(wallet)

  // Idempotent per (wallet, kind, ref) — the partial unique index in the DB
  // backs this up against races; re-share = same link, refreshed snapshot.
  const existing = await prisma.shareReceipt.findFirst({ where: { wallet, kind, refId, revoked: false } })
  const receipt = existing
    ? await prisma.shareReceipt.update({
        where: { id: existing.id },
        data: {
          headline: content.headline,
          ask: content.ask,
          standing: content.standing,
          valueUsd: content.valueUsd,
          facts: JSON.parse(JSON.stringify(content.facts)),
          txs: JSON.parse(JSON.stringify(content.txs)),
        },
      })
    : await prisma.shareReceipt.create({
        data: {
          kind: kind as ShareKind,
          wallet,
          via,
          refId,
          headline: content.headline,
          ask: content.ask,
          standing: content.standing,
          valueUsd: content.valueUsd,
          facts: JSON.parse(JSON.stringify(content.facts)),
          txs: JSON.parse(JSON.stringify(content.txs)),
        },
      })

  return NextResponse.json(
    {
      id: receipt.id,
      url: shareReceiptUrl(receipt.id, via),
      via,
      headline: receipt.headline,
      standing: receipt.standing,
      tweetHref: receiptTweetHref({ id: receipt.id, headline: receipt.headline, ask: receipt.ask, standing: receipt.standing, via }),
    },
    { status: existing ? 200 : 201 },
  )
}
