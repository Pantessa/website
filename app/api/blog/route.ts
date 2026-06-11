import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAdminAddress, slugify, adminWallets } from '@/lib/blog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// List posts. Public callers see published only (newest first); an admin can
// include drafts with ?drafts=1.
export async function GET(req: NextRequest) {
  const wantDrafts = req.nextUrl.searchParams.get('drafts') === '1'
  const admin = wantDrafts ? await getAdminAddress(req) : null
  const posts = await prisma.blogPost.findMany({
    where: admin ? {} : { published: true },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      slug: true,
      title: true,
      description: true,
      coverImageUrl: true,
      coverImageAlt: true,
      tags: true,
      published: true,
      publishedAt: true,
      updatedAt: true,
    },
  })
  return NextResponse.json(posts)
}

// Create a post (draft by default). Admin only — SIWE session or Bearer key.
export async function POST(req: NextRequest) {
  if (adminWallets().size === 0) {
    return NextResponse.json(
      { error: 'Publishing is disabled: set ADMIN_WALLETS (comma-separated addresses).' },
      { status: 503 },
    )
  }
  const admin = await getAdminAddress(req)
  if (!admin) return NextResponse.json({ error: 'Not an admin.' }, { status: 403 })

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const content = typeof body.content === 'string' ? body.content : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!title || !content || !description) {
    return NextResponse.json(
      { error: 'title, description, and content are required.' },
      { status: 400 },
    )
  }
  if (description.length > 160) {
    // The description IS the meta description — hold the SEO line.
    return NextResponse.json({ error: 'description must be ≤160 characters.' }, { status: 400 })
  }

  const slug = slugify(typeof body.slug === 'string' && body.slug.trim() ? body.slug : title)
  if (!slug) return NextResponse.json({ error: 'title produces an empty slug.' }, { status: 400 })
  const exists = await prisma.blogPost.findUnique({ where: { slug } })
  if (exists) return NextResponse.json({ error: `slug "${slug}" already exists.` }, { status: 409 })

  const published = body.published === true
  const post = await prisma.blogPost.create({
    data: {
      slug,
      title: title.slice(0, 140),
      description,
      content,
      coverImageUrl: typeof body.coverImageUrl === 'string' ? body.coverImageUrl : null,
      coverImageAlt: typeof body.coverImageAlt === 'string' ? body.coverImageAlt.slice(0, 200) : null,
      tags: Array.isArray(body.tags) ? body.tags.filter((t: unknown): t is string => typeof t === 'string').slice(0, 8) : [],
      published,
      publishedAt: published ? new Date() : null,
      authorAddress: admin,
    },
  })
  return NextResponse.json(post, { status: 201 })
}
