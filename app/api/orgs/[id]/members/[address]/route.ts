import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { getMembership, isWalletAddress, requireRole } from '@/lib/org'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; address: string }> }

// Change a member's role. Owner only. Setting someone else to 'owner' is the
// ownership TRANSFER: they become owner and the caller steps down to admin in
// the same transaction (an org always has exactly one owner). The owner can't
// change their own role — transfer first.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, address: rawTarget } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const gate = await requireRole(id, addr, 'owner')
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 404 ? 'Not found.' : 'Only the owner can change roles.' },
      { status: gate.status },
    )
  }

  if (!isWalletAddress(rawTarget)) {
    return NextResponse.json({ error: 'Invalid member address.' }, { status: 400 })
  }
  const target = rawTarget.toLowerCase()
  if (target === addr) {
    return NextResponse.json({ error: 'Transfer ownership to someone else instead.' }, { status: 400 })
  }

  const membership = await getMembership(id, target)
  if (!membership) return NextResponse.json({ error: 'Not a member.' }, { status: 404 })

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const role = body.role
  if (role !== 'owner' && role !== 'admin' && role !== 'member') {
    return NextResponse.json({ error: "role must be 'owner', 'admin' or 'member'." }, { status: 400 })
  }

  if (role === 'owner') {
    // Ownership transfer: target up, caller down — atomically.
    await prisma.$transaction([
      prisma.orgMember.update({
        where: { orgId_address: { orgId: id, address: target } },
        data: { role: 'owner' },
      }),
      prisma.orgMember.update({
        where: { orgId_address: { orgId: id, address: addr } },
        data: { role: 'admin' },
      }),
    ])
    return NextResponse.json({ address: target, role: 'owner', transferred: true })
  }

  const updated = await prisma.orgMember.update({
    where: { orgId_address: { orgId: id, address: target } },
    data: { role },
    select: { address: true, role: true },
  })
  return NextResponse.json(updated)
}

// Remove a member. Self-removal = leaving (any role except owner — transfer
// first). Removing others: admin+ required; admins remove members only; the
// owner removes anyone; the owner can never be removed.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, address: rawTarget } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  if (!isWalletAddress(rawTarget)) {
    return NextResponse.json({ error: 'Invalid member address.' }, { status: 400 })
  }
  const target = rawTarget.toLowerCase()

  const caller = await getMembership(id, addr)
  if (!caller) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const membership = await getMembership(id, target)
  if (!membership) return NextResponse.json({ error: 'Not a member.' }, { status: 404 })

  if (membership.role === 'owner') {
    return NextResponse.json(
      { error: 'The owner cannot be removed — transfer ownership first.' },
      { status: 400 },
    )
  }

  if (target !== addr) {
    if (caller.role === 'member') {
      return NextResponse.json({ error: 'Requires the admin role.' }, { status: 403 })
    }
    if (caller.role === 'admin' && membership.role === 'admin') {
      return NextResponse.json({ error: 'Only the owner can remove an admin.' }, { status: 403 })
    }
  }

  await prisma.orgMember.delete({ where: { orgId_address: { orgId: id, address: target } } })
  return NextResponse.json({ ok: true })
}
