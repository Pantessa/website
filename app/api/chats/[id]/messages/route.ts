import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// Append a message to a chat. Owner only.
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const chat = await prisma.chat.findUnique({ where: { id } })
  if (!chat || chat.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const role = body.role
  if (role !== 'user' && role !== 'assistant') {
    return NextResponse.json({ error: "role must be 'user' or 'assistant'." }, { status: 400 })
  }
  if (typeof body.content !== 'string' || !body.content) {
    return NextResponse.json({ error: 'content is required.' }, { status: 400 })
  }

  const message = await prisma.message.create({
    data: {
      chatId: id,
      role,
      content: body.content,
      meta: body.meta === undefined ? undefined : (body.meta as object),
    },
  })
  // Touch the chat so it sorts to the top of the list.
  await prisma.chat.update({ where: { id }, data: { updatedAt: new Date() } })
  return NextResponse.json(message, { status: 201 })
}
