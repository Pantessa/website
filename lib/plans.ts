// The business model (pricing v2, 2026-09-18).
//
//   THE TAKE RATE IS THE BUSINESS. 0.20% organic / 0.50% shared-link, taken
//   inside the trade (lib/fees.ts). Everything that costs us nothing to serve
//   is free at every tier, forever: charts, watchlists, alerts, technicals,
//   every native ask, standing intents. A plan prices ONE thing — house-model
//   answers, the only surface with a marginal cost — and never gates looking
//   or trading. The day a tier meters a watchlist we are TradingView with
//   worse charts.
//
// Answers come from four places, drawn in this order (lib/billing.ts):
//   1. the TASTE   — free, daily, keyed to IP + wallet (a wallet is free to
//                    mint, so it is never the only key)
//   2. the PLAN    — Plus's monthly allowance
//   3. the BANK    — answers EARNED by trading (1 per 2¢ of fee on a verified
//                    receipt) or BOUGHT in a pack; they never expire
//   ∞  BYOK        — the user's own API key: unlimited, their cost, not ours
//
// Growth ($99) and Scale ($499) are RETIRED from sale — zero subscribers
// ever, priced for an embed-host story the chart-first pivot left behind.
// Their ids stay valid so a subscription row carrying one (and the Stripe
// webhook) can never strand; nothing offers them. White-label, orgs and SLA
// are hand-sold ("Team").
//
// Pure config: /pricing, the dashboard and the billing APIs all read this.

export type PlanId = 'free' | 'plus' | 'growth' | 'scale'

export interface Plan {
  id: PlanId
  name: string
  /** One-line who-it's-for. */
  tagline: string
  /** USD per month. 0 = the free tier (no Stripe object behind it). */
  priceUsd: number
  /** USD per year when billed yearly (paid, on-sale plans only). */
  yearlyUsd?: number
  /** House answers granted per calendar month (UTC) — the PLAN pool. The free
   *  tier has none: its answers are the daily taste plus whatever it earns. */
  credits: number
  /** Pre-2026-07-21 allowance — subscriptions from before the right-sizing
   *  keep it forever (never strand a subscriber). */
  legacyCredits?: number
  /** Feature bullets, most important first. */
  highlights: string[]
  /** Marked-up card emphasis on /pricing. */
  popular?: boolean
  /** Retired from sale: never listed, never checkout-able, still honored for
   *  a subscription row that carries it. */
  legacy?: boolean
  /** Live Stripe Product id. Checkout attaches the (code-authored) price to
   *  it; env `STRIPE_PRODUCT_<ID>` wins so test and live ids can differ. A
   *  plan with no product id still checks out — Stripe creates the product
   *  inline from the plan's name (tidy it up in the dashboard later). */
  stripeProductId?: string
}

export function stripeProductFor(plan: Plan): string | undefined {
  return process.env[`STRIPE_PRODUCT_${plan.id.toUpperCase()}`] ?? plan.stripeProductId
}

/** Allowances were right-sized 2026-07-21; paid subscriptions from before the
 *  cutoff keep their original allowance forever. */
export const ALLOWANCE_CUTOFF = Date.parse('2026-07-21T00:00:00Z')

export function planCreditsFor(plan: Plan, subscribedAt?: Date | null): number {
  if (plan.legacyCredits !== undefined && subscribedAt && subscribedAt.getTime() < ALLOWANCE_CUTOFF) {
    return plan.legacyCredits
  }
  return plan.credits
}

// ── The free taste (per UTC day) ────────────────────────────────────────────
// Enough to ask "what is Morpho" and "is this safe" on the way to a first
// trade; not enough to be worth a script. Executable asks never touch it —
// the native ladder builds without the model.
const clampInt = (raw: string | undefined, dflt: number, lo: number, hi: number): number => {
  const n = Number(raw)
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt
}
export const TASTE = {
  /** A wallet with any on-chain history (or a verified trade with us). */
  wallet: clampInt(process.env.TASTE_WALLET_DAILY, 10, 1, 1000),
  /** A fresh, empty wallet — free to mint, so it gets what a guest gets. */
  freshWallet: clampInt(process.env.TASTE_FRESH_WALLET_DAILY, 5, 1, 1000),
  /** No wallet at all, keyed to the connection. */
  guest: clampInt(process.env.TASTE_GUEST_DAILY, 5, 1, 1000),
  /** Everything behind one connection, all wallets combined. Above the
   *  wallet tier because one NAT covers a household or an office. */
  ip: clampInt(process.env.TASTE_IP_DAILY, 20, 2, 10_000),
} as const

// ── Earned answers ──────────────────────────────────────────────────────────
/** One banked answer per this many cents of NET fee on a verified signed
 *  receipt. No floor on purpose: a $1 swap pays 0.2¢ and earns 0, so a sybil
 *  farming tiny trades earns nothing, and at ~1–3¢ of inference per answer
 *  the fee always covers what it buys. */
export const EARN_CENTS_PER_ANSWER = 2

/** Answers earned by a fee, in whole answers (floored). Pure. */
export function answersEarnedByFee(netFeeUsd: number): number {
  if (!Number.isFinite(netFeeUsd) || netFeeUsd <= 0) return 0
  // Work in hundredths of a cent so 0.2 → exactly 10, never 9.999…
  return Math.floor(Math.round(netFeeUsd * 10_000) / (EARN_CENTS_PER_ANSWER * 100))
}

// ── The pack ────────────────────────────────────────────────────────────────
/** One-time purchase of banked answers that never expire. */
export const ANSWER_PACK = { answers: 1000, priceUsd: 10 } as const

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Look, trade and automate — free forever',
    priceUsd: 0,
    credits: 0,
    highlights: [
      'Unlimited charts, watchlists, alerts and technicals',
      'Every trade, DCA, guardian and job — no caps',
      `${TASTE.wallet} house answers a day, free`,
      'Every trade you sign earns more answers',
      'Unlimited intent links after your first trade',
      'Bring your own API key: unlimited answers, free',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    tagline: 'For people who ask more than they trade',
    priceUsd: 9,
    yearlyUsd: 79,
    credits: 300,
    popular: true,
    highlights: [
      'Everything in Free',
      '300 house answers a month, on top of the daily free ones',
      'Market briefs and "explain this" without the hourly limit',
      'Earned and bought answers still stack, and never expire',
      'Early access to new agents',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'Retired — honored for existing subscribers',
    priceUsd: 99,
    credits: 8_000,
    legacyCredits: 25_000,
    legacy: true,
    stripeProductId: 'prod_UsTzqqSZp2V3Sj',
    highlights: [],
  },
  {
    id: 'scale',
    name: 'Scale',
    tagline: 'Retired — honored for existing subscribers',
    priceUsd: 499,
    credits: 40_000,
    legacyCredits: 150_000,
    legacy: true,
    stripeProductId: 'prod_UsU0jKG1QyPBh7',
    highlights: [],
  },
]

export const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.id, p]),
) as Record<PlanId, Plan>

export function isPlanId(v: unknown): v is PlanId {
  return v === 'free' || v === 'plus' || v === 'growth' || v === 'scale'
}

/** What /pricing and the dashboard list: the plans on sale. */
export const LISTED_PLANS = PLANS.filter((p) => !p.legacy)

/** Plans that can be checked out through Stripe today. */
export const PAID_PLANS = PLANS.filter((p) => p.priceUsd > 0 && !p.legacy)

export type BillingInterval = 'month' | 'year'
export function isBillingInterval(v: unknown): v is BillingInterval {
  return v === 'month' || v === 'year'
}
/** The charge for a plan on an interval, in whole USD. */
export function planChargeUsd(plan: Plan, interval: BillingInterval): number {
  return interval === 'year' && plan.yearlyUsd ? plan.yearlyUsd : plan.priceUsd
}
