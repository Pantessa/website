// GET /api/x/auth/start?next=<path>  →  302 to X's authorize page (PKCE, S256),
// with a short-lived signed flow cookie. "Verify with X" proves a handle; it
// is not an account sign-in and never asks for a wallet.
// Fake mode (XCALLS_FAKE=1, never production): `&as=<handle>` seats that
// handle here and 303s to next. Outside fake mode `as` does nothing.
// The logic lives in lib/called-it/x-auth (pinned); this file only wires it.
import { NextResponse } from 'next/server'
import { claimHandle, saveProfile } from '@/lib/called-it/store'
import { X_FLOW_COOKIE, flowCookieOptions, identityCookieName, identityCookieOptions, startXAuth } from '@/lib/called-it/x-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const r = await startXAuth({ origin: url.origin, next: url.searchParams.get('next'), as: url.searchParams.get('as') ?? undefined, deps: { claimHandle, saveProfile } })
  const res = new NextResponse(null, { status: r.kind === 'x' ? 302 : 303, headers: { location: r.location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
  if (r.kind === 'x') res.cookies.set(X_FLOW_COOKIE, r.flowToken, flowCookieOptions())
  if (r.kind === 'seated') {
    const name = identityCookieName(url.origin)
    res.cookies.set(name, r.identityToken, identityCookieOptions(name))
  }
  return res
}
