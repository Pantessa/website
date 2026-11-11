// POST /api/x/auth/unclaim  (same-origin)  →  { ok, removed }   (review R12)
// The account withdraws its own verification: every handle its X user id
// claimed stops reading "Verified", and this browser's X identity is cleared
// (so the button never says "verified" over a record that does not).
// Needs the X identity cookie; nothing else can withdraw a claim.
import { NextResponse } from 'next/server'
import { CROSS_SITE_REFUSAL, sameOrigin } from '@/lib/community/origin'
import { X_IDENTITY_COOKIE_NAMES, getXIdentity } from '@/lib/called-it/x-auth'
import { unclaimAll } from '@/lib/called-it/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!sameOrigin(req.headers)) return NextResponse.json(CROSS_SITE_REFUSAL, { status: 403 })
  const id = await getXIdentity()
  if (!id) return NextResponse.json({ status: 'refused', reason: 'Verify with X first: only the account itself can withdraw its verification.', next: [{ label: 'Plot a handle', href: '/x' }] }, { status: 401, headers: { 'cache-control': 'no-store' } })
  let removed = 0
  try {
    removed = await unclaimAll(id.xUserId)
  } catch {
    return NextResponse.json({ status: 'refused', reason: 'The verification was not withdrawn. Try again.', next: [{ label: 'Plot a handle', href: '/x' }] }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
  const res = NextResponse.json({ ok: true, removed }, { headers: { 'cache-control': 'no-store' } })
  for (const name of X_IDENTITY_COOKIE_NAMES) res.cookies.set(name, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure: name.startsWith('__Host-') })
  return res
}
