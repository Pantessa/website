// POST /api/tenants/:id/policy/:version/reject — a tenant admin turns a
// proposed version down (TENANT lane). The active policy stands untouched.
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { tenantForAdmin } from '@/lib/tenant/store'
import { blot } from '@/lib/tenant/gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; version: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id, version: raw } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const version = /^\d{1,6}$/.test(raw) ? Number(raw) : NaN
  if (!Number.isInteger(version)) return NextResponse.json({ error: 'version must be an integer.' }, { status: 400 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 280) || null : null

  const claimed = await prisma.tenantPolicy.updateMany({
    where: { tenantId: id, version, state: 'proposed' },
    data: { state: 'rejected', approvedBy: gate.addr, ...(note ? { note } : {}) },
  })
  if (claimed.count !== 1) {
    const row = await prisma.tenantPolicy.findUnique({ where: { tenantId_version: { tenantId: id, version } }, select: { state: true } })
    if (!row) return NextResponse.json({ error: `No policy version ${version}.` }, { status: 404 })
    return NextResponse.json({ error: `Version ${version} is ${row.state} — only a proposed version is rejected.`, state: row.state }, { status: 409 })
  }
  await blot({ tenantId: id }, 'policy_rejected', { version, rejectedBy: gate.addr, ...(note ? { note } : {}) })
  return NextResponse.json({ version, state: 'rejected', rejectedBy: gate.addr })
}
