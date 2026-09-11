import { NextRequest, NextResponse } from 'next/server'
import { getPost } from '@/lib/chart-posts'

// GET /api/posts/<id> — one post with its comments. A by-id read is the one
// unfenced read (exactly like /i/<slug>): you need the id to reach it, and
// the public feed never lists an internal row.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const post = await getPost(id)
  if (!post) return NextResponse.json({ error: 'No such post.' }, { status: 404 })
  return NextResponse.json({ post }, { headers: { 'cache-control': 'no-store' } })
}
