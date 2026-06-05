import { NextResponse } from 'next/server'
import { issueNonce } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Issue a one-time SIWE nonce (stored in a short-lived httpOnly cookie).
export async function GET() {
  const nonce = await issueNonce()
  return NextResponse.json({ nonce })
}
