// GET /api/x/auth/callback?code=&state=  (X sends the browser here)
// State checked in constant time against the flow cookie, the code exchanged
// once, users/me read once, the token revoked and dropped, the claim written,
// the identity cookie seated, 303 to next. Nothing of X's is kept.
// The logic lives in lib/called-it/x-auth completeXAuth (pinned).
import { NextResponse } from 'next/server'
import { claimHandle, saveProfile } from '@/lib/called-it/store'
import { X_FLOW_COOKIE, X_FLOW_COOKIE_PATH, X_IDENTITY_COOKIE, completeXAuth, identityCookieOptions } from '@/lib/called-it/x-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return undefined
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const r = await completeXAuth({ params: url.searchParams, flowToken: readCookie(req, X_FLOW_COOKIE), origin: url.origin, deps: { claimHandle, saveProfile } })
  // The code is in this request's URL: never let it ride a Referer onward.
  const res = new NextResponse(null, { status: 303, headers: { location: r.location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
  res.cookies.set(X_FLOW_COOKIE, '', { path: X_FLOW_COOKIE_PATH, maxAge: 0, httpOnly: true, sameSite: 'lax' })
  if (r.kind === 'seated') res.cookies.set(X_IDENTITY_COOKIE, r.identityToken, identityCookieOptions())
  return res
}
