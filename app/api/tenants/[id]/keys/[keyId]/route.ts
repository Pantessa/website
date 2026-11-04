// /api/tenants/:id/keys/:keyId — pause, resume, revoke a desk key (TENANT lane).
//
// PATCH { paused: boolean } by a tenant admin: a paused key refuses every
// desk tool but broker_status / broker_close BY NAME (KEY_PAUSED), and every
// leg its jobs try to relay. DELETE revokes it — final; the key never
// resolves again and its jobs' legs never move.
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { deskKeyView, tenantForAdmin } from '@/lib/tenant/store'
import { blot, withdrawTenantOffers } from '@/lib/tenant/gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; keyId: string }> }

async function keyOf(id: string, keyId: string) {
  const key = await prisma.deskKey.findUnique({ where: { id: keyId } }).catch(() => null)
  return key && key.tenantId === id ? key : null
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, keyId } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const key = await keyOf(id, keyId)
  if (!key) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (typeof body.paused !== 'boolean') return NextResponse.json({ error: 'paused must be a boolean.', field: 'paused' }, { status: 400 })
  if (key.revokedAt) return NextResponse.json({ error: 'This key is revoked — a revoked key is final.' }, { status: 409 })
  if (key.paused === body.paused) return NextResponse.json(deskKeyView(key))
  const updated = await prisma.deskKey.update({ where: { id: keyId }, data: { paused: body.paused } })
  await blot({ tenantId: id, deskId: key.deskId, keyId }, body.paused ? 'key_paused' : 'key_resumed', { keyId, prefix: key.prefix, by: gate.addr })
  // QA F3: a pause withdraws what the key has out (jobs canceled, artifacts nulled, links revoked).
  if (body.paused) await withdrawTenantOffers({ tenantId: id, keyId, deskId: key.deskId }, 'KEY_PAUSED', `desk key ${key.prefix}… was paused by ${gate.addr}.`)
  return NextResponse.json(deskKeyView(updated))
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, keyId } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const key = await keyOf(id, keyId)
  if (!key) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (key.revokedAt) return NextResponse.json(deskKeyView(key))
  const updated = await prisma.deskKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } })
  await blot({ tenantId: id, deskId: key.deskId, keyId }, 'key_revoked', { keyId, prefix: key.prefix, by: gate.addr })
  await withdrawTenantOffers({ tenantId: id, keyId, deskId: key.deskId }, 'KEY_REVOKED', `desk key ${key.prefix}… was revoked by ${gate.addr}.`)
  return NextResponse.json(deskKeyView(updated))
}
