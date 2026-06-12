import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { listApprovals, resetApproval, setAgentCaps, setApproval } from '@/lib/approvals'
import { getActiveGrant } from '@/lib/grant-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// All directory agents with the signed-in wallet's approval state + caps.
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  return NextResponse.json(await listApprovals(addr))
}

/** Parse a cap field: undefined = untouched, null = clear, number = set. */
function parseCap(v: unknown): number | null | undefined | 'invalid' {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return 'invalid'
}

// Update one agent: toggle approval and/or set per-agent spend caps.
// Body: { serverId, approved?, perCallUsd?, perDayUsd? } — caps null to
// clear (inherit the grant), numbers to set. Cap changes void the EIP-712
// signature (terms changed — re-sign), same as approval toggles.
export async function PUT(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const serverId = typeof body.serverId === 'string' ? body.serverId : null
  const approved = typeof body.approved === 'boolean' ? body.approved : undefined
  const perCallUsd = parseCap(body.perCallUsd)
  const perDayUsd = parseCap(body.perDayUsd)

  if (!serverId) {
    return NextResponse.json({ error: 'serverId is required.' }, { status: 400 })
  }
  if (perCallUsd === 'invalid' || perDayUsd === 'invalid') {
    return NextResponse.json({ error: 'Caps must be numbers or null.' }, { status: 400 })
  }
  const capsTouched = perCallUsd !== undefined || perDayUsd !== undefined
  if (approved === undefined && !capsTouched) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  // Cap validation: >= $0.001, and never above the grant's own cap — an
  // agent cap can only further restrict (rule A1).
  if (capsTouched) {
    const grant = await getActiveGrant(addr)
    for (const [label, v, grantCap] of [
      ['perCallUsd', perCallUsd, grant?.perCallUsd],
      ['perDayUsd', perDayUsd, grant?.perDayUsd],
    ] as const) {
      if (typeof v === 'number') {
        if (v < 0.001) {
          return NextResponse.json({ error: `${label} must be at least $0.001.` }, { status: 400 })
        }
        if (grantCap != null && v > grantCap) {
          return NextResponse.json(
            { error: `${label} ($${v}) exceeds the grant's cap ($${grantCap}) — raise the grant first.` },
            { status: 400 },
          )
        }
      }
    }
  }

  let grant = approved !== undefined ? await setApproval(addr, serverId, approved) : null
  if (capsTouched) {
    grant = await setAgentCaps(addr, serverId, {
      ...(perCallUsd !== undefined ? { perCallUsd } : {}),
      ...(perDayUsd !== undefined ? { perDayUsd } : {}),
    })
  }

  return NextResponse.json({
    ok: true,
    grant: grant
      ? { id: grant.id, label: grant.label, allowCount: grant.allow.length, signed: !!grant.signature }
      : null,
  })
}

// Reset one agent to defaults (drops the row: approval off, caps inherited).
export async function DELETE(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const serverId = typeof body.serverId === 'string' ? body.serverId : null
  if (!serverId) return NextResponse.json({ error: 'serverId is required.' }, { status: 400 })
  const grant = await resetApproval(addr, serverId)
  return NextResponse.json({ ok: true, grant: { id: grant.id, allowCount: grant.allow.length } })
}
