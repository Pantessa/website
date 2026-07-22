import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Allowlist membership probe for restricted links (GET ?wallet=0x…). The
 * runtime asks THIS instead of shipping the list in page HTML — a partner's
 * wallet list never leaks. Unrestricted links answer true for any wallet.
 * Targeting, not a security boundary: the ask itself is public on the page.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!/^[a-z0-9-]{4,16}$/.test(slug)) return NextResponse.json({ error: 'Bad slug.' }, { status: 400 })
  const wallet = (req.nextUrl.searchParams.get('wallet') ?? '').trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return NextResponse.json({ error: 'Bad wallet.' }, { status: 400 })

  const link = await prisma.intentLink.findUnique({
    where: { id: slug },
    select: { revoked: true, expiresAt: true, allowWallets: true },
  })
  if (!link || link.revoked) return NextResponse.json({ error: 'Unknown link.' }, { status: 404 })
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return NextResponse.json({ allowed: false })

  const allowed = link.allowWallets.length === 0 || link.allowWallets.includes(wallet.toLowerCase())
  return NextResponse.json({ allowed })
}
