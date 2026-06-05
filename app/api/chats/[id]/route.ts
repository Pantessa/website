import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// Read a chat + messages. Owner gets it; non-owners only if it's public.
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  const chat = await prisma.chat.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!chat) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const isOwner = !!addr && chat.ownerAddress === addr
  if (!isOwner && !chat.isPublic) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  // Hide the owner address from non-owners.
  const { ownerAddress, ...rest } = chat
  return NextResponse.json({ ...rest, ownerAddress: isOwner ? ownerAddress : undefined, isOwner })
}

// Update title / active agents / sharing. Owner only.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const chat = await prisma.chat.findUnique({ where: { id } })
  if (!chat || chat.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string') data.title = body.title.trim().slice(0, 120)
  if (Array.isArray(body.activeServerIds)) {
    data.activeServerIds = body.activeServerIds.filter((x: unknown): x is string => typeof x === 'string')
  }
  if (typeof body.isPublic === 'boolean') {
    data.isPublic = body.isPublic
    if (body.isPublic) {
      // Mint an unguessable share slug once; reuse it on re-share.
      data.publicSlug = chat.publicSlug ?? randomBytes(9).toString('base64url')
      data.publicAt = new Date()
    }
  }

  const updated = await prisma.chat.update({ where: { id }, data })
  return NextResponse.json(updated)
}

// Delete a chat. Owner only.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const chat = await prisma.chat.findUnique({ where: { id } })
  if (!chat || chat.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  await prisma.chat.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
