import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getSessionAddress } from '@/lib/auth'
import prisma from '@/lib/db'
import { getStripe, billingOrigin } from '@/lib/stripe'
import { PLAN_BY_ID, isPlanId, stripeProductFor } from '@/lib/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Start a Stripe Checkout session for a paid plan. SIWE session only (a
// Bearer key must not be able to start charging its owner's card). The price
// is authored inline from lib/plans.ts (`price_data`) — the single source, so
// /pricing and checkout can't drift — but attached to the plan's live Stripe
// Product (stripeProductFor) when one is set, so the dashboard shows one
// product per plan instead of an ad-hoc product per session. The webhook
// activates the plan.
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

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const planId = body.plan
  if (!isPlanId(planId) || PLAN_BY_ID[planId].priceUsd === 0) {
    return NextResponse.json({ error: 'plan must be a paid plan id (growth | scale).' }, { status: 400 })
  }
  const plan = PLAN_BY_ID[planId]
  const owner = addr.toLowerCase()

  // Reuse the wallet's Stripe customer when one exists so upgrades don't
  // spawn duplicate customers.
  const existing = await prisma.subscription.findUnique({ where: { ownerAddress: owner } }).catch(() => null)

  const origin = billingOrigin(req.nextUrl.origin)
  // Attach the code-authored price to the plan's live Stripe Product when one
  // exists; otherwise fall back to an ad-hoc product so billing still works
  // before the products are wired.
  const productId = stripeProductFor(plan)
  const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
    currency: 'usd',
    unit_amount: plan.priceUsd * 100,
    recurring: { interval: 'month' },
    ...(productId
      ? { product: productId }
      : {
          product_data: {
            name: `Yeetful ${plan.name}`,
            description: `${plan.credits.toLocaleString()} YEET credits / month — ${plan.tagline}`,
          },
        }),
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    ...(existing?.stripeCustomerId ? { customer: existing.stripeCustomerId } : {}),
    client_reference_id: owner,
    line_items: [{ quantity: 1, price_data: priceData }],
    metadata: { ownerAddress: owner, plan: plan.id },
    subscription_data: { metadata: { ownerAddress: owner, plan: plan.id } },
    success_url: `${origin}/dashboard/plan?upgraded=1`,
    cancel_url: `${origin}/pricing`,
  })

  return NextResponse.json({ url: session.url })
}
