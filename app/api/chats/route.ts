import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// List the signed-in wallet's chats.
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const chats = await prisma.chat.findMany({
    where: { ownerAddress: addr },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, isPublic: true, publicSlug: true, createdAt: true, updatedAt: true },
  })
  return NextResponse.json(chats)
}

// Create a new chat owned by the signed-in wallet.
export async function POST(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const title =
    typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : 'New chat'
  const activeServerIds = Array.isArray(body.activeServerIds)
    ? body.activeServerIds.filter((x: unknown): x is string => typeof x === 'string')
    : []

  const chat = await prisma.chat.create({
    data: { ownerAddress: addr, title, activeServerIds },
  })
  return NextResponse.json(chat, { status: 201 })
}
