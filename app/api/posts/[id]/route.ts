import { NextRequest, NextResponse } from 'next/server'
import { readComments } from '@/lib/chart-posts'
import { getActor } from '@/lib/community/identity'
import { deletePost, getFeedPost } from '@/lib/community/store'
import { getSessionAddress } from '@/lib/auth'
import { isInternalRun } from '@/lib/internal-run'
import { CROSS_SITE_REFUSAL, sameOrigin } from '@/lib/community/origin'

// GET /api/posts/<id> — one post with its comments, in the feed's shape
// (room, video, proof, score, myVote) plus `commentList`. A by-id read is the
// one unfenced read (exactly like /i/<slug>): you need the id to reach it,
// and the public feed never lists an internal row.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const actor = await getActor().catch(() => null)
  const post = await getFeedPost(id, actor?.key ?? null)
  if (!post) return NextResponse.json({ error: 'No such post.' }, { status: 404 })
  const commentList = await readComments(post.id, post.isInternal)
  return NextResponse.json({ post: { ...post, commentList } }, { headers: { 'cache-control': 'no-store' } })
}

// DELETE /api/posts/<id> (S10) — the post's author, or an owner / mod of the
// room it sits in, removes it with its votes and comments. Wallet session.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req.headers)) return NextResponse.json(CROSS_SITE_REFUSAL, { status: 403 })
  const wallet = await getSessionAddress().catch(() => null)
  if (!wallet) return NextResponse.json({ error: 'Sign in with your wallet to remove a post.' }, { status: 401 })
  const { id } = await ctx.params
  const r = await deletePost(id, wallet, { isInternal: isInternalRun(req.headers) })
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status })
  return NextResponse.json({ deleted: true })
}
