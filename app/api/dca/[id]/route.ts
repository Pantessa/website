import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import prisma from '@/lib/db'
import { jobsEnv } from '@/lib/jobs-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Direct schedule management for the rail's icon buttons (2026-07-28 —
 * the prefill detour made "cancel" look like it did nothing until the
 * composer was sent). Owner-gated, env-fenced, same transitions as the
 * chat manage grammar: pause ⇄ resume, cancel is terminal. Body: { op }.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  let body: { op?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Malformed body.' }, { status: 400 })
  }
  const op = body.op
  if (op !== 'pause' && op !== 'resume' && op !== 'cancel') {
    return NextResponse.json({ error: "op must be 'pause' | 'resume' | 'cancel'." }, { status: 400 })
  }
  const s = await prisma.dcaSchedule.findUnique({ where: { id } })
  if (!s || s.wallet !== addr.toLowerCase() || s.originEnv !== jobsEnv()) {
    return NextResponse.json({ error: 'No such schedule on this wallet.' }, { status: 404 })
  }
  if (s.status === 'canceled') return NextResponse.json({ error: 'Already canceled.' }, { status: 409 })
  if (op === 'pause' && s.status !== 'active') return NextResponse.json({ error: `Schedule is ${s.status} — nothing to pause.` }, { status: 409 })
  if (op === 'resume' && s.status !== 'paused') return NextResponse.json({ error: `Schedule is ${s.status} — nothing to resume.` }, { status: 409 })
  const status = op === 'cancel' ? 'canceled' : op === 'pause' ? 'paused' : 'active'
  await prisma.dcaSchedule.update({ where: { id }, data: { status } })
  return NextResponse.json({ id, status })
}
