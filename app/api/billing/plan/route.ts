import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { getPlanUsage, recentCreditEntries } from '@/lib/billing'
import { PLANS } from '@/lib/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The signed-in wallet's (or Bearer key owner's) plan + this month's YEET
// credit usage — the /dashboard/plan page and SDK pre-flights read this.
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const [usage, ledger] = await Promise.all([getPlanUsage(addr), recentCreditEntries(addr)])
  return NextResponse.json({
    usage,
    ledger,
    plans: PLANS,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
  })
}
