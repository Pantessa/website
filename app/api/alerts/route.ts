import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { isInternalRun } from '@/lib/internal-run'
import { createAlert, deleteAlert, listAlerts, setAlertStatus } from '@/lib/watchlists-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// /api/alerts — price alerts, owner-gated like /api/dca. UNLIMITED. An
// alert's `actionAsk` is a chip the rail shows when it fires — the server
// never sends it (the signature is the gate). `email` is optional and
// rides lib/email's mailer best-effort.

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const b = (await req.json()) as unknown
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  return NextResponse.json({ alerts: await listAlerts(addr) }, { headers: { 'cache-control': 'no-store' } })
}

/** POST { symbol, condition, value, basePrice?, actionAsk?, email? } → { alert } */
export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Malformed body.' }, { status: 400 })
  const r = await createAlert(addr, body, isInternalRun(req.headers, body))
  if ('problem' in r) return NextResponse.json({ error: r.problem }, { status: r.status })
  return NextResponse.json({ alert: r.alert }, { status: 201 })
}

/** PATCH { id, op: 'pause' | 'resume' | 'rearm' } → { alert } */
export async function PATCH(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = await readBody(req)
  if (!body || typeof body.id !== 'string') return NextResponse.json({ error: 'Name the alert id.' }, { status: 400 })
  const op = body.op
  if (op !== 'pause' && op !== 'resume' && op !== 'rearm') return NextResponse.json({ error: "op must be 'pause' | 'resume' | 'rearm'." }, { status: 400 })
  const r = await setAlertStatus(addr, body.id, op)
  if ('problem' in r) return NextResponse.json({ error: r.problem }, { status: r.status })
  return NextResponse.json({ alert: r.alert })
}

export async function DELETE(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ((await readBody(req))?.id as string | undefined)
  if (!id || typeof id !== 'string') return NextResponse.json({ error: 'Name the alert id.' }, { status: 400 })
  const ok = await deleteAlert(addr, id)
  if (!ok) return NextResponse.json({ error: 'No such alert on this wallet.' }, { status: 404 })
  return NextResponse.json({ ok: true, id })
}
