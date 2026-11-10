import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth'
import { clearIdentityCookie } from '@/lib/community/identity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Signing out signs out of EVERYTHING this browser holds: the wallet session
// and the Telegram / Discord identity (QA-SECURITY-2 T6 — the identity cookie
// used to survive a sign-out for 30 days, still joining and voting).
export async function POST() {
  await clearSessionCookie()
  await clearIdentityCookie()
  return NextResponse.json({ ok: true })
}
