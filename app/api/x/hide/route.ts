// POST /api/x/hide { handle, hidden }  →  { ok, handle, hidden }   (review R12)
// An admin takes a handle's records down (or puts them back): its records then
// answer a named refusal everywhere and it never lists. Same-origin JSON; the
// house admin gate (lib/api-key getAuthAddress + lib/admin isAdminAddress, the
// one /api/admin/** routes use).
import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { isAdminAddress } from '@/lib/admin'
import { CROSS_SITE, readWriteBody } from '@/lib/called-it/scan'
import { normalizeHandle } from '@/lib/called-it/spec'
import { setHidden } from '@/lib/called-it/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })

export async function POST(req: NextRequest) {
  const body = await readWriteBody(req)
  if (body === 'cross-site') return json(CROSS_SITE, 403)
  const addr = await getAuthAddress(req).catch(() => null)
  if (!isAdminAddress(addr)) return json({ status: 'refused', reason: 'Only a Pantessa admin can take a record down.', next: [{ label: 'Plot a handle', href: '/x' }] }, addr ? 403 : 401)
  if (!body) return json({ status: 'refused', reason: 'Send the handle and hidden (true or false) as JSON.', next: [{ label: 'Plot a handle', href: '/x' }] }, 400)
  const handle = normalizeHandle(body.handle)
  if (!handle || typeof body.hidden !== 'boolean') return json({ status: 'refused', reason: 'Send an X handle and hidden as true or false.', next: [{ label: 'Plot a handle', href: '/x' }] }, 400)
  try {
    await setHidden(handle, body.hidden, 'admin')
  } catch {
    return json({ status: 'refused', reason: 'The change was not saved. Try again.', next: [{ label: 'Plot a handle', href: '/x' }] }, 503)
  }
  return json({ ok: true, handle, hidden: body.hidden }, 200)
}
