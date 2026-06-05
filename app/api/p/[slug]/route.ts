import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

/**
 * Public, read-only view of a shared chat (no auth). Resolves by the
 * unguessable publicSlug and only if the owner has it toggled public.
 * The sharing UI ships later — this endpoint is ready for it.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const chat = await prisma.chat.findUnique({
    where: { publicSlug: slug },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!chat || !chat.isPublic) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  // Public payload — never expose the owner address.
  const { ownerAddress: _owner, ...pub } = chat
  return NextResponse.json({ ...pub, shared: true })
}
