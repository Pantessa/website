import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { listApprovals, setApproval } from '@/lib/approvals'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// All directory agents with the signed-in wallet's approval state.
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  return NextResponse.json(await listApprovals(addr))
}

// Toggle one agent. Body: { serverId, approved }. Syncs the grant allowlist
// (and mints the default expense account on first use).
export async function PUT(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const serverId = typeof body.serverId === 'string' ? body.serverId : null
  const approved = typeof body.approved === 'boolean' ? body.approved : null
  if (!serverId || approved === null) {
    return NextResponse.json({ error: 'serverId and approved are required.' }, { status: 400 })
  }

  const grant = await setApproval(addr, serverId, approved)
  return NextResponse.json({
    ok: true,
    grant: { id: grant.id, label: grant.label, allowCount: grant.allow.length },
  })
}
