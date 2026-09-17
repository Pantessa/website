import { NextRequest, NextResponse } from 'next/server'
import { onrampOfferFor } from '@/lib/onramp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/onramp/offer → { enabled, currency, lanes }: what THIS visitor can
// buy by card (lib/onramp onrampOfferFor).
//
// A door that opens a Stripe checkout reads this first and offers only these
// lanes. Stripe mints a session for a lane its checkout can't price, and the
// customer meets "An unknown error occurred" there, after signing the consent.
// A euro buy of USDC did exactly that on 2026-09-17. The session route refuses
// the same lanes by name, so a door that skips this read still gets words.
//
// No wallet, no database, no RPC: the answer comes from the deployment's
// config and the edge's country header. It varies by visitor, so it's never
// cached.
export async function GET(req: NextRequest) {
  return NextResponse.json(onrampOfferFor(req.headers), { headers: { 'cache-control': 'private, no-store' } })
}
