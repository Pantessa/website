import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { uniqueOrgSlug } from '@/lib/org'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Org management is SIWE-only (F2): a Bearer key never sees or manages orgs —
// the same trust split as budgets (an agent can't raise its own allowance).

const MAX_ORGS_CREATED_PER_WALLET = 10

// List the orgs the signed-in wallet belongs to, with its role in each.
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const memberships = await prisma.orgMember.findMany({
    where: { address: addr },
    orderBy: { createdAt: 'asc' },
    select: {
      role: true,
      org: {
        select: {
          id: true,
          name: true,
          slug: true,
          perDayUsd: true,
          createdAt: true,
          _count: { select: { members: true } },
        },
      },
    },
  })
  return NextResponse.json(
    memberships.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      perDayUsd: m.org.perDayUsd,
      role: m.role,
      memberCount: m.org._count.members,
      createdAt: m.org.createdAt,
    })),
  )
}

// Create an org; the creator becomes its owner.
export async function POST(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const created = await prisma.organization.count({ where: { createdBy: addr } })
  if (created >= MAX_ORGS_CREATED_PER_WALLET) {
    return NextResponse.json(
      { error: `Organization limit reached (${MAX_ORGS_CREATED_PER_WALLET}).` },
      { status: 400 },
    )
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : ''
  if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 })

  const slug = await uniqueOrgSlug(name)
  const org = await prisma.organization.create({
    data: {
      name,
      slug,
      createdBy: addr,
      members: { create: { address: addr, role: 'owner' } },
    },
    select: { id: true, name: true, slug: true, perDayUsd: true, createdAt: true },
  })
  return NextResponse.json({ ...org, role: 'owner', memberCount: 1 }, { status: 201 })
}
