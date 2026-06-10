import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { hostOf } from '@/lib/spend-grant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// List the signed-in wallet's spend grants (newest first), with today's spend.
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const grants = await prisma.spendGrant.findMany({
    where: { ownerAddress: addr },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { ledger: true } } },
  })
  return NextResponse.json(grants)
}

const MAX_PER_CALL = 100 // sanity ceilings so a typo can't authorize a fortune
const MAX_PER_DAY = 10_000

// Create a spend grant owned by the signed-in wallet (SIWE-session gated).
export async function POST(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  // Allowlist: accept hostnames or full URLs; normalize to bare lowercased hosts.
  const rawAllow: unknown[] = Array.isArray(body.allow) ? body.allow : []
  const allow: string[] = [
    ...new Set(
      rawAllow
        .filter((x): x is string => typeof x === 'string' && !!x.trim())
        .map((x) => (x.includes('://') ? hostOf(x) : x.trim().toLowerCase()))
        .filter(Boolean),
    ),
  ]
  if (allow.length === 0) {
    return NextResponse.json({ error: 'allow must list at least one host.' }, { status: 400 })
  }

  const perCallUsd = Number(body.perCallUsd)
  const perDayUsd = Number(body.perDayUsd)
  if (!(perCallUsd > 0) || perCallUsd > MAX_PER_CALL) {
    return NextResponse.json({ error: `perCallUsd must be 0–${MAX_PER_CALL}.` }, { status: 400 })
  }
  if (!(perDayUsd > 0) || perDayUsd > MAX_PER_DAY) {
    return NextResponse.json({ error: `perDayUsd must be 0–${MAX_PER_DAY}.` }, { status: 400 })
  }

  const totalUsd =
    body.totalUsd === undefined || body.totalUsd === null ? null : Number(body.totalUsd)
  if (totalUsd !== null && !(totalUsd > 0)) {
    return NextResponse.json({ error: 'totalUsd, if set, must be > 0.' }, { status: 400 })
  }

  // Default expiry: 30 days out. Accept an explicit ISO date or ms timestamp.
  let expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  if (body.expiresAt) {
    const parsed = new Date(body.expiresAt as string | number)
    if (!isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) expiresAt = parsed
  }

  const label =
    typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 80)
      : 'Agent expense account'

  const grant = await prisma.spendGrant.create({
    data: { ownerAddress: addr, label, allow, perCallUsd, perDayUsd, totalUsd, expiresAt },
  })
  return NextResponse.json(grant, { status: 201 })
}
