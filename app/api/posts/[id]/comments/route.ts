import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { isInternalRun } from '@/lib/internal-run'
import { clientIpFrom } from '@/lib/turn-limits'
import { addComment, bumpAndCheckPostWrite, writeLimitReply } from '@/lib/chart-posts'

// POST /api/posts/<id>/comments { body } — SIWE-gated, plain text ≤1,000
// chars, per-wallet + per-IP hourly fences. Internal-run comments are
// stamped and never counted on a public card.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const author = await getSessionAddress().catch(() => null)
  if (!author) return NextResponse.json({ error: 'Sign in to comment — one free signature.' }, { status: 401 })
  const { id } = await ctx.params
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const tripped = await bumpAndCheckPostWrite(clientIpFrom(req.headers), author, 'comment')
  if (tripped) return NextResponse.json({ error: writeLimitReply(tripped, 'comment'), rateGate: tripped }, { status: 429 })
  const internal = isInternalRun(req.headers, body)
  const r = await addComment(id, author, (body as { body?: unknown } | null)?.body, internal)
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status })
  return NextResponse.json({ comment: r.comment, ...(internal ? { internal: true } : {}) }, { status: 201 })
}
