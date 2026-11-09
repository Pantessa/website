import { NextRequest, NextResponse } from 'next/server'
import { readComments } from '@/lib/chart-posts'
import { getActor } from '@/lib/community/identity'
import { getFeedPost } from '@/lib/community/store'

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
