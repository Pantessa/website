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
            name: `Pantessa ${plan.name}`,
            description: `${plan.credits.toLocaleString()} YEET credits / month — ${plan.tagline}`,
          },
        }),
  }
  const params = (customerId?: string): Stripe.Checkout.SessionCreateParams => ({
    mode: 'subscription',
    ...(customerId ? { customer: customerId } : {}),
    client_reference_id: owner,
    line_items: [{ quantity: 1, price_data: priceData }],
    metadata: { ownerAddress: owner, plan: plan.id },
    subscription_data: { metadata: { ownerAddress: owner, plan: plan.id } },
    success_url: `${origin}/dashboard/plan?upgraded=1`,
    cancel_url: `${origin}/pricing`,
  })

  try {
    // Reuse the wallet's stored Stripe customer when one exists so upgrades
    // don't spawn duplicates. But a stored id can be stale — most commonly a
    // TEST-mode customer left over from before the switch to a live key, or a
    // customer deleted in the dashboard. Stripe rejects those with a
    // `resource_missing` on the customer param; when that happens, drop the id
    // and retry with a fresh customer instead of failing the checkout.
    let session
    try {
      session = await stripe.checkout.sessions.create(params(existing?.stripeCustomerId ?? undefined))
    } catch (err) {
      if (existing?.stripeCustomerId && isMissingCustomer(err)) {
        session = await stripe.checkout.sessions.create(params())
      } else {
        throw err
      }
    }
    return NextResponse.json({ url: session.url })
  } catch (err) {
    // Surface the Stripe reason (instead of a blind 500) so misconfig is
    // diagnosable from the client + logs.
    const msg = err instanceof Error ? err.message : 'checkout failed'
    console.error('[billing/checkout]', msg)
    return NextResponse.json({ error: `Checkout failed: ${msg}` }, { status: 500 })
  }
}

/** True when Stripe rejected a request because the referenced customer no
 * longer exists (wrong mode, or deleted) — param is `customer`. */
function isMissingCustomer(err: unknown): boolean {
  const e = err as { code?: string; param?: string; message?: string }
  return (
    e?.code === 'resource_missing' &&
    (e?.param === 'customer' || /no such customer/i.test(e?.message ?? ''))
  )
}
