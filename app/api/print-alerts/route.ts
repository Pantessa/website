import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { isInternalRun } from '@/lib/internal-run'
import { createPrintAlert, deletePrintAlert, feedStatus, listPrintAlerts, setPrintAlertStatus } from '@/lib/print-alerts-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// /api/print-alerts — the /live trigger rules armed on the server
// (lib/print-alerts), owner-gated like /api/alerts. A rule's firing is a
// notification on the bell (the price alerts' own path) and mail when the
// rule named a verified address; the chip it carries is never sent for
// you. GET also returns where the cron left each venue's feed (the rail's
// status line: last pass, how far behind, any gap the venue refused to
// replay).

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
  const [alerts, feeds] = await Promise.all([listPrintAlerts(addr), feedStatus()])
  return NextResponse.json({ alerts, feeds }, { headers: { 'cache-control': 'no-store' } })
}

/** POST { rule, market?, venues?, bigPrintUsd?, email? } → { alert } */
export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Malformed body.' }, { status: 400 })
  const r = await createPrintAlert(addr, body, isInternalRun(req.headers, body))
  if ('problem' in r) return NextResponse.json({ error: r.problem }, { status: r.status })
  return NextResponse.json({ alert: r.alert }, { status: 201 })
}

/** PATCH { id, op: 'pause' | 'resume' } → { alert } */
export async function PATCH(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = await readBody(req)
  if (!body || typeof body.id !== 'string') return NextResponse.json({ error: 'Name the rule id.' }, { status: 400 })
  if (body.op !== 'pause' && body.op !== 'resume') return NextResponse.json({ error: "op must be 'pause' | 'resume'." }, { status: 400 })
  const r = await setPrintAlertStatus(addr, body.id, body.op)
  if ('problem' in r) return NextResponse.json({ error: r.problem }, { status: r.status })
  return NextResponse.json({ alert: r.alert })
}

export async function DELETE(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ((await readBody(req))?.id as string | undefined)
  if (!id || typeof id !== 'string') return NextResponse.json({ error: 'Name the rule id.' }, { status: 400 })
  const ok = await deletePrintAlert(addr, id)
  if (!ok) return NextResponse.json({ error: 'No such rule on this wallet.' }, { status: 404 })
  return NextResponse.json({ ok: true, id })
}
