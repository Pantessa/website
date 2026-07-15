import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; msgId: string }> }

const HASH_RE = /^0x[0-9a-fA-F]{64}$/
const MAX_SIGNED = 40

interface SignedTx {
  hash: string
  chainId: number
  title?: string
  at?: string
}

// Record wallet-signed, chain-confirmed txs onto a message's meta.signed —
// the durable signing log the /p share page renders with explorer links.
// Owner only; append-only (nothing else in meta is writable from here). The
// hash is advancement evidence, not proof — same trust model as the job
// runner's complete route: a fabricated hash only produces a dead explorer
// link on the owner's own share page.
export async function POST(req: NextRequest, { params }: Params) {
  const { id, msgId } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const chat = await prisma.chat.findUnique({ where: { id } })
  if (!chat || chat.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  const message = await prisma.message.findUnique({ where: { id: msgId } })
  if (!message || message.chatId !== id) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const raw: unknown[] = Array.isArray(body.txs) ? body.txs : []
  const txs: SignedTx[] = raw
    .filter(
      (t): t is Record<string, unknown> =>
        !!t &&
        typeof t === 'object' &&
        typeof (t as SignedTx).hash === 'string' &&
        HASH_RE.test((t as SignedTx).hash) &&
        typeof (t as SignedTx).chainId === 'number' &&
        Number.isInteger((t as SignedTx).chainId),
    )
    .map((t) => ({
      hash: (t.hash as string).toLowerCase(),
      chainId: t.chainId as number,
      ...(typeof t.title === 'string' && t.title ? { title: t.title.slice(0, 120) } : {}),
      ...(typeof t.at === 'string' && !Number.isNaN(Date.parse(t.at)) ? { at: t.at } : {}),
    }))
  if (txs.length === 0) {
    return NextResponse.json({ error: 'txs must contain {hash, chainId} entries.' }, { status: 400 })
  }

  const meta = (message.meta && typeof message.meta === 'object' ? message.meta : {}) as Record<string, unknown>
  const prior = Array.isArray(meta.signed) ? (meta.signed as SignedTx[]) : []
  const merged = [...prior, ...txs.filter((t) => !prior.some((p) => p?.hash?.toLowerCase?.() === t.hash))].slice(
    0,
    MAX_SIGNED,
  )

  const updated = await prisma.message.update({
    where: { id: msgId },
    data: { meta: JSON.parse(JSON.stringify({ ...meta, signed: merged })) as object },
  })
  return NextResponse.json({ ok: true, signed: (updated.meta as { signed?: SignedTx[] }).signed ?? [] })
}
