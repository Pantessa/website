import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import prisma from '@/lib/db'
import { jobsEnv } from '@/lib/jobs-runner'
import { armDcaSchedule } from '@/lib/dca-auto-exec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Arm a DCA schedule's autopilot with a signed SpendPermission.
 *
 * Auth follows connect-to-act: a SIWE session works, but the DECISIVE gate is
 * the permission signature itself — armDcaSchedule simulates
 * approveWithSignature on-chain, and only the wallet that owns the schedule
 * can produce a signature the chain accepts for `account == schedule.wallet`.
 * A spoofed wallet param without that signature dies at the simulation.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { wallet?: string; permission?: unknown; signature?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Malformed body.' }, { status: 400 })
  }
  const wallet = (await getAuthAddress(req)) ?? body.wallet
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Connect a wallet first.' }, { status: 401 })
  }
  const result = await armDcaSchedule(id, wallet, body.permission, body.signature ?? '')
  return NextResponse.json(result.body, { status: result.status })
}

/** Disarm — drop back to confirm-mode. We stop pulling immediately; the
 *  on-chain permission stays the user's to revoke from their wallet. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const s = await prisma.dcaSchedule.findUnique({ where: { id } })
  if (!s || s.wallet !== addr.toLowerCase() || s.originEnv !== jobsEnv()) {
    return NextResponse.json({ error: 'No such schedule on this wallet.' }, { status: 404 })
  }
  if (s.mode !== 'auto') return NextResponse.json({ disarmed: false, note: 'Already in confirm-mode.' })
  await prisma.dcaSchedule.update({ where: { id }, data: { mode: 'confirm', autoError: null } })
  return NextResponse.json({ disarmed: true })
}
