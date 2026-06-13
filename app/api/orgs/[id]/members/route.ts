import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { isWalletAddress, requireRole } from '@/lib/org'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const MAX_MEMBERS_PER_ORG = 100

// Add a member — this IS the invite: membership takes effect on the address's
// next SIWE sign-in, no email machinery. Admin+ adds members; only the owner
// may add someone directly as an admin; nobody is added as owner (transfer
// ownership via PATCH /members/[address] instead).
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const gate = await requireRole(id, addr, 'admin')
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 404 ? 'Not found.' : 'Requires the admin role.' },
      { status: gate.status },
    )
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  if (!isWalletAddress(body.address)) {
    return NextResponse.json({ error: 'address must be a 0x wallet address.' }, { status: 400 })
  }
  const address = body.address.toLowerCase()

  const role = body.role === undefined ? 'member' : body.role
  if (role !== 'member' && role !== 'admin') {
    return NextResponse.json({ error: "role must be 'member' or 'admin'." }, { status: 400 })
  }
  if (role === 'admin' && gate.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can add admins.' }, { status: 403 })
  }

  const count = await prisma.orgMember.count({ where: { orgId: id } })
  if (count >= MAX_MEMBERS_PER_ORG) {
    return NextResponse.json({ error: `Member limit reached (${MAX_MEMBERS_PER_ORG}).` }, { status: 400 })
  }

  const existing = await prisma.orgMember.findUnique({
    where: { orgId_address: { orgId: id, address } },
  })
  if (existing) return NextResponse.json({ error: 'Already a member.' }, { status: 409 })

  const member = await prisma.orgMember.create({
    data: { orgId: id, address, role, addedBy: addr },
    select: { address: true, role: true, addedBy: true, createdAt: true },
  })
  return NextResponse.json(member, { status: 201 })
}
