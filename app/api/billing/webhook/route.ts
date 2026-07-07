import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import prisma from '@/lib/db'
import { getStripe } from '@/lib/stripe'
import { isPlanId } from '@/lib/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Stripe webhook — the ONLY writer of paid subscription state. Point the
// Stripe dashboard (or `stripe listen --forward-to`) at /api/billing/webhook
// with STRIPE_WEBHOOK_SECRET set. Handled events:
//   checkout.session.completed          → activate the plan for the wallet
//   customer.subscription.updated       → status / renewal / plan changes
//   customer.subscription.deleted       → back to the free tier
// Unhandled events 200 so Stripe doesn't retry them forever.

function subPeriodEnd(sub: Stripe.Subscription): Date | null {
  const end = sub.items?.data?.[0]?.current_period_end
  return typeof end === 'number' ? new Date(end * 1000) : null
}

async function upsertFromSubscription(sub: Stripe.Subscription) {
  const owner = sub.metadata?.ownerAddress?.toLowerCase()
  const plan = sub.metadata?.plan
  if (!owner || !isPlanId(plan)) return
  const data = {
    plan: sub.status === 'canceled' ? 'free' : plan,
    status: sub.status,
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: subPeriodEnd(sub),
  }
  await prisma.subscription.upsert({
    where: { ownerAddress: owner },
    update: data,
    create: { ownerAddress: owner, ...data },
  })
}

export async function POST(req: NextRequest) {
  const stripe = getStripe()
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripe || !secret) {
    return NextResponse.json({ error: 'Stripe webhook not configured.' }, { status: 503 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing stripe-signature.' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const owner = (session.metadata?.ownerAddress ?? session.client_reference_id ?? '').toLowerCase()
        const plan = session.metadata?.plan
        if (owner && isPlanId(plan) && session.subscription) {
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id
          const customerId = typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null)
          await prisma.subscription.upsert({
            where: { ownerAddress: owner },
            update: { plan, status: 'active', stripeCustomerId: customerId, stripeSubscriptionId: subId },
            create: { ownerAddress: owner, plan, status: 'active', stripeCustomerId: customerId, stripeSubscriptionId: subId },
          })
        }
        break
      }
      case 'customer.subscription.updated':
        await upsertFromSubscription(event.data.object)
        break
      case 'customer.subscription.deleted': {
        const sub = event.data.object
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { plan: 'free', status: 'canceled', currentPeriodEnd: subPeriodEnd(sub) },
        })
        break
      }
    }
  } catch (err) {
    // A store error must 500 so Stripe retries the delivery.
    const msg = err instanceof Error ? err.message : 'webhook handling failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
