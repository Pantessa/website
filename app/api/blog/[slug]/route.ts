import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAdminAddress } from '@/lib/blog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

// Read one post. Published posts are public; drafts are admin-only (404 to
// everyone else — a draft's existence is not disclosed).
export async function GET(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const post = await prisma.blogPost.findUnique({ where: { slug } })
  if (!post) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (!post.published) {
    const admin = await getAdminAddress(req)
    if (!admin) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  return NextResponse.json(post)
}

// Update a post. Admin only. Publishing sets publishedAt exactly once so the
// original publication date (and the SEO datePublished) survives later edits.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const admin = await getAdminAddress(req)
  if (!admin) return NextResponse.json({ error: 'Not an admin.' }, { status: 403 })

  const post = await prisma.blogPost.findUnique({ where: { slug } })
  if (!post) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim().slice(0, 140)
  if (typeof body.description === 'string') {
    if (body.description.length > 160) {
      return NextResponse.json({ error: 'description must be ≤160 characters.' }, { status: 400 })
    }
    data.description = body.description.trim()
  }
  if (typeof body.content === 'string') data.content = body.content
  if (typeof body.coverImageUrl === 'string' || body.coverImageUrl === null) data.coverImageUrl = body.coverImageUrl
  if (typeof body.coverImageAlt === 'string') data.coverImageAlt = body.coverImageAlt.slice(0, 200)
  if (Array.isArray(body.tags)) data.tags = body.tags.filter((t: unknown): t is string => typeof t === 'string').slice(0, 8)
  if (typeof body.published === 'boolean') {
    data.published = body.published
    if (body.published && !post.publishedAt) data.publishedAt = new Date()
  }

  const updated = await prisma.blogPost.update({ where: { slug }, data })
  return NextResponse.json(updated)
}

// Delete a post. Admin only.
export async function DELETE(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const admin = await getAdminAddress(req)
  if (!admin) return NextResponse.json({ error: 'Not an admin.' }, { status: 403 })
  const post = await prisma.blogPost.findUnique({ where: { slug } })
  if (!post) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  await prisma.blogPost.delete({ where: { slug } })
  return NextResponse.json({ ok: true })
}
