// Stripe client — lazily constructed so the whole billing surface degrades
// gracefully until STRIPE_SECRET_KEY is set (routes answer 503 with a plain
// "not configured yet" instead of crashing at import time).

import Stripe from 'stripe'
import { SITE_URL } from './site-url'

let client: Stripe | null | undefined

export function getStripe(): Stripe | null {
  if (client !== undefined) return client
  const key = process.env.STRIPE_SECRET_KEY
  client = key ? new Stripe(key) : null
  return client
}

/** Absolute origin for Stripe redirect URLs — canonical first (fetch drops
 * auth on cross-origin redirects elsewhere; same discipline here). */
export function billingOrigin(reqOrigin?: string): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? reqOrigin ?? SITE_URL
}
