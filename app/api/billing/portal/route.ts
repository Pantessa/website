import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import prisma from '@/lib/db'
import { getStripe, billingOrigin } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Stripe Billing Portal — upgrades, downgrades, card changes, cancellation
// all live there so we never re-implement subscription management UI.
export async function POST(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in with your wallet first.' }, { status: 401 })

  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json(
      { error: 'Billing isn’t live yet — STRIPE_SECRET_KEY is not configured on this deployment.' },
      { status: 503 },
    )
  }

  const row = await prisma.subscription.findUnique({ where: { ownerAddress: addr.toLowerCase() } }).catch(() => null)
  if (!row?.stripeCustomerId) {
    return NextResponse.json({ error: 'No billing account yet — upgrade to a paid plan first.' }, { status: 400 })
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${billingOrigin(req.nextUrl.origin)}/dashboard/plan`,
  })
  return NextResponse.json({ url: session.url })
}
