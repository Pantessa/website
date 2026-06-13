import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { listApprovals, setApproval } from '@/lib/approvals'
import { orgScopeKey, requireRole } from '@/lib/org'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// All directory agents with the signed-in wallet's approval state.
// `?org=<id>` reads the org's shared approvals instead (member+).
export async function GET(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const orgId = req.nextUrl.searchParams.get('org')
  if (orgId) {
    const gate = await requireRole(orgId, addr, 'member')
    if (!gate.ok) return NextResponse.json({ error: 'Not found.' }, { status: gate.status })
    return NextResponse.json(await listApprovals(orgScopeKey(orgId)))
  }
  return NextResponse.json(await listApprovals(addr))
}

// Toggle one agent. Body: { serverId, approved, orgId? }. Syncs the grant
// allowlist (and mints the default expense account on first use). Org
// toggles are admin+ — a toggle IS enforcement, so it's a policy write.
export async function PUT(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const serverId = typeof body.serverId === 'string' ? body.serverId : null
  const approved = typeof body.approved === 'boolean' ? body.approved : null
  if (!serverId || approved === null) {
    return NextResponse.json({ error: 'serverId and approved are required.' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' && body.orgId ? body.orgId : null
  if (orgId) {
    const gate = await requireRole(orgId, addr, 'admin')
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.status === 404 ? 'Not found.' : 'Requires the admin role.' },
        { status: gate.status },
      )
    }
  }

  const grant = await setApproval(
    orgId ? orgScopeKey(orgId) : addr,
    serverId,
    approved,
    orgId ?? undefined,
  )
  return NextResponse.json({
    ok: true,
    grant: { id: grant.id, label: grant.label, allowCount: grant.allow.length },
  })
}
