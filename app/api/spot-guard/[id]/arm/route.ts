import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import prisma from '@/lib/db'
import { jobsEnv } from '@/lib/jobs-runner'
import { armSpotGuardPolicy } from '@/lib/spot-guard-exec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Arm a spot-guard policy with its signed SpendPermission. Connect-to-act:
 * a SIWE session works, but the DECISIVE gate is the signature itself —
 * armSpotGuardPolicy simulates approveWithSignature on-chain, and only the
 * wallet that owns the policy can produce a signature the chain accepts
 * for `account == policy.wallet`. A spoofed wallet param dies there.
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
  const result = await armSpotGuardPolicy(id, wallet, body.permission, body.signature ?? '')
  return NextResponse.json(result.body, { status: result.status })
}

/** Retire a protection — we stop watching immediately; the on-chain
 *  permission stays the user's to revoke from their wallet. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const p = await prisma.spotGuardPolicy.findUnique({ where: { id } })
  if (!p || p.wallet !== addr.toLowerCase() || p.originEnv !== jobsEnv()) {
    return NextResponse.json({ error: 'No such protection on this wallet.' }, { status: 404 })
  }
  if (p.status === 'done') return NextResponse.json({ retired: false, note: 'Already retired.' })
  await prisma.spotGuardPolicy.update({ where: { id }, data: { status: 'done', error: null } })
  return NextResponse.json({ retired: true })
}
