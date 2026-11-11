// POST /api/x/auth/signout  (same-origin)  →  clears the X identity cookie.
import { NextResponse } from 'next/server'
import { CROSS_SITE_REFUSAL, sameOrigin } from '@/lib/community/origin'
import { X_IDENTITY_COOKIE } from '@/lib/called-it/x-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!sameOrigin(req.headers)) return NextResponse.json(CROSS_SITE_REFUSAL, { status: 403 })
  const res = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
  res.cookies.set(X_IDENTITY_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' })
  return res
}
