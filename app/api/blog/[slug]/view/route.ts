import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

// View beacon: the post page fires this once per browser page load. Raw SQL on
// purpose — prisma.update would bump updated_at (@updatedAt), and updated_at is
// the post's SEO dateModified; a page view must not look like an edit. Drafts
// and unknown slugs are both 404 (a draft's existence is not disclosed).
export async function POST(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  try {
    const rows = await prisma.$queryRaw<{ views: number }[]>`
      UPDATE blog_posts SET views = views + 1
      WHERE slug = ${slug} AND published = true
      RETURNING views`
    if (rows.length === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ views: rows[0].views })
  } catch {
    return NextResponse.json({ error: 'Unavailable.' }, { status: 503 })
  }
}
