import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getSessionAddress } from '@/lib/auth'
import prisma from '@/lib/db'
import { getStripe, billingOrigin } from '@/lib/stripe'
import { getEffectivePlan } from '@/lib/billing'
import { ANSWER_PACK, PAID_PLANS, PLAN_BY_ID, deskPlanSummary, isBillingInterval, isCheckoutPlan, planChargeUsd, planFamily, stripeProductFor } from '@/lib/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Start a Stripe Checkout session. For sale (pricing v2 + the desk plans,
// 2026-11-03):
//   { plan: 'plus', interval?: 'month' | 'year' }  → the Plus subscription
//   { plan: 'agent' | 'desk', interval? }          → a desk plan (lib/plans
//                                                    DESK_PLANS; what it buys
//                                                    is lib/tenant/entitlements)
//   { pack: true }                                  → one pack of banked answers
// Retired plans (growth | scale) and the hand-sold Enterprise are refused —
// nothing sells them here. ONE WALLET, ONE PLAN: subscriptions are keyed by
// owner, so a second paid subscription would bill twice while the row could
// only remember one of them. A wallet already on a paid plan is sent to
// Manage billing (or hello@) instead of a second checkout.
// SIWE session only (a
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
      // `detail` is for whoever reads the network tab; `error` is what the
      // pricing page prints under the button, so it names no env var.
      {
        error: 'Checkout is not open yet. The free plan works today: every chart, watchlist and trade. Write to hello@pantessa.com and we will set you up by hand.',
        detail: 'STRIPE_SECRET_KEY is not configured on this deployment.',
      },
      { status: 503 },
    )
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const owner = addr.toLowerCase()
  const origin = billingOrigin(req.nextUrl.origin)
  const existing = await prisma.subscription.findUnique({ where: { ownerAddress: owner } }).catch(() => null)

  let params: (customerId?: string) => Stripe.Checkout.SessionCreateParams
  if (body.pack === true) {
    // ONE-TIME: a pack of answers that never expire. The webhook grants them
    // on `checkout.session.completed`, idempotent on the session id.
    const packProduct = process.env.STRIPE_PRODUCT_PACK
    params = (customerId) => ({
      mode: 'payment',
      ...(customerId ? { customer: customerId } : {}),
      client_reference_id: owner,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: ANSWER_PACK.priceUsd * 100,
            ...(packProduct
              ? { product: packProduct }
              : { product_data: { name: `Pantessa — ${ANSWER_PACK.answers.toLocaleString('en-US')} answers`, description: 'House-model answers that never expire.' } }),
          },
        },
      ],
      metadata: { ownerAddress: owner, pack: String(ANSWER_PACK.answers) },
      success_url: `${origin}/dashboard/plan?pack=1`,
      cancel_url: `${origin}/pricing`,
    })
  } else {
    const planId = body.plan
    if (!isCheckoutPlan(planId)) {
      const onSale = PAID_PLANS.map((p) => p.id).join(', ')
      return NextResponse.json({ error: `plan must be a plan on sale (${onSale}), or pass { pack: true }.` }, { status: 400 })
    }
    const plan = PLAN_BY_ID[planId]
    const desk = planFamily(plan) === 'desk'
    const interval = isBillingInterval(body.interval) ? body.interval : 'month'
    // One wallet, one plan (see the header). getEffectivePlan is the same
    // read the gates use, so "already on a plan" means what it means there.
    const current = (await getEffectivePlan(owner)).plan
    if (current.id !== 'free') {
      const same = current.id === plan.id
      return NextResponse.json(
        {
          error: same
            ? `This wallet is already on ${plan.name}. Manage it from your plan page.`
            : `This wallet already pays for ${current.name}. One wallet holds one plan: cancel ${current.name} from Manage billing on your plan page first, or write to hello@pantessa.com and we will switch it by hand.`,
          current: current.id,
          manage: '/dashboard/plan',
        },
        { status: 409 },
      )
    }
    // Attach the code-authored price to the plan's live Stripe Product when
    // one exists; otherwise Stripe creates the product inline, so billing
    // works before the product is wired.
    const productId = stripeProductFor(plan)
    const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
      currency: 'usd',
      unit_amount: planChargeUsd(plan, interval) * 100,
      recurring: { interval },
      ...(productId
        ? { product: productId }
        : {
            product_data: {
              name: `Pantessa ${plan.name}`,
              // A desk plan prices the desk, not answers (credits 0).
              description: desk
                ? `The desk — ${deskPlanSummary(plan.id as 'agent' | 'desk')}`
                : `${plan.credits.toLocaleString('en-US')} house answers a month — ${plan.tagline}`,
            },
          }),
    }
    params = (customerId) => ({
      mode: 'subscription',
      ...(customerId ? { customer: customerId } : {}),
      client_reference_id: owner,
      line_items: [{ quantity: 1, price_data: priceData }],
      metadata: { ownerAddress: owner, plan: plan.id, family: planFamily(plan) },
      subscription_data: { metadata: { ownerAddress: owner, plan: plan.id, family: planFamily(plan) } },
      success_url: desk ? `${origin}/dashboard/plan?desk=${plan.id}` : `${origin}/dashboard/plan?upgraded=1`,
      cancel_url: `${origin}/pricing`,
    })
  }

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
    // The Stripe reason stays diagnosable (`detail` + the log line above)
    // without being the sentence a buyer reads under the button.
    return NextResponse.json(
      { error: 'Checkout did not open. You were not charged. Try again in a minute, or write to hello@pantessa.com.', detail: msg },
      { status: 500 },
    )
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
