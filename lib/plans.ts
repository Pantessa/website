// The business model — three Stripe-billed monthly plans metered in YEET
// credits (lib/billing.ts). One credit = one house-model answer; on-chain /
// x402 calls are NOT credits — they stay pay-per-call from the user's own
// wallet on every plan, so paid engines and data MCPs keep their receipts.
// Pure config: both the public /pricing page and the billing APIs read this,
// so the two can never drift.

export type PlanId = 'free' | 'growth' | 'scale'

export interface Plan {
  id: PlanId
  name: string
  /** One-line who-it's-for. */
  tagline: string
  /** USD per month. 0 = the free tier (no Stripe object behind it). */
  priceUsd: number
  /** YEET credits granted per calendar month (UTC). */
  credits: number
  /** Pre-2026-07-21 allowance — subscriptions from before the right-sizing
   * keep it forever (never strand a subscriber). Absent = credits applies
   * to everyone. */
  legacyCredits?: number
  /** Feature bullets, most important first. */
  highlights: string[]
  /** Marked-up card emphasis on /pricing. */
  popular?: boolean
  /** Live Stripe Product id this plan subscribes to. Checkout attaches the
   * (code-authored) price to this product so the Stripe dashboard shows one
   * product per plan instead of an ad-hoc product per session. Env override
   * (`STRIPE_PRODUCT_<ID>`) wins so test-mode ids can differ from live. */
  stripeProductId?: string
}

/** Resolve a plan's live Stripe product id, letting an env var override the
 * baked-in default (test vs live). */
export function stripeProductFor(plan: Plan): string | undefined {
  return process.env[`STRIPE_PRODUCT_${plan.id.toUpperCase()}`] ?? plan.stripeProductId
}

/** Allowances were right-sized 2026-07-21 (PRICING.md: a maxed allowance must
 * never exceed the plan's price in inference COGS). Paid subscriptions from
 * before the cutoff keep their original allowance forever. */
export const ALLOWANCE_CUTOFF = Date.parse('2026-07-21T00:00:00Z')

/** The monthly credit allowance for a subscriber — legacy for pre-cutoff
 * paid subscriptions, current for everyone else (free tier has no
 * subscription row and always reads current). */
export function planCreditsFor(plan: Plan, subscribedAt?: Date | null): number {
  if (plan.legacyCredits !== undefined && subscribedAt && subscribedAt.getTime() < ALLOWANCE_CUTOFF) {
    return plan.legacyCredits
  }
  return plan.credits
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Builder',
    tagline: 'For indie dapps and weekend forks',
    priceUsd: 0,
    // Right-sized 2026-07-21: ~40-80 real asks/month — plenty for the aha
    // (first swap, first DCA, first guardian), bounded house-inference COGS.
    credits: 250,
    highlights: [
      '3 active intent links — mint, share, earn',
      '3 standing intents — jobs, DCA, guardian',
      '250 chat credits / month',
      'Embed on 1 site',
      'Compose up to 3 MCPs per set',
      'Guardrails, receipts & signing included',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For DEXs and DAOs finding volume',
    priceUsd: 99,
    credits: 8_000,
    legacyCredits: 25_000,
    popular: true,
    stripeProductId: 'prod_UsTzqqSZp2V3Sj',
    highlights: [
      '25 active intent links',
      '25 standing intents — a working portfolio of automations',
      'Embed on 3 sites',
      'Full paid MCP directory in your sets',
      'Custom chat theme',
      'Email support',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    tagline: 'For major venues and mega apps',
    priceUsd: 499,
    credits: 40_000,
    legacyCredits: 150_000,
    stripeProductId: 'prod_UsU0jKG1QyPBh7',
    highlights: [
      'Unlimited intent links',
      'Unlimited standing intents',
      'Unlimited embed sites',
      'White-label chrome',
      'Orgs: team seats, daily caps, kill switch',
      'Priority support + SLA',
    ],
  },
]

export const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.id, p]),
) as Record<PlanId, Plan>

export function isPlanId(v: unknown): v is PlanId {
  return v === 'free' || v === 'growth' || v === 'scale'
}

/** Paid plans that can be checked out through Stripe. */
export const PAID_PLANS = PLANS.filter((p) => p.priceUsd > 0)
