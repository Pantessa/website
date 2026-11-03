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
// THE DESK PLANS (squad five-million, 2026-11-03). Agent ($49) and Desk
// ($499) price the governed desk — tenants, scoped desk keys, the policy
// gate, the blotter — and INCLUDE Plus's monthly answer pool (their
// `credits` are read from the Plus entry, never retyped), so a Plus
// subscriber loses nothing by upgrading and a desk operator can still ask
// the chart. Enterprise carries the same pool, so "Everything in Desk"
// stays true on the page. What each one
// buys lives in lib/tenant/entitlements.ts (entitlementsFor); the lines a page
// prints are DESK_PLAN_FEATURES below, written from that table so a page can
// never promise a cap the gate does not hold. Enterprise is hand-sold: a
// valid id (a subscription row may carry it) that checkout never sells; its
// price is the platform fee + tiered bps in lib/tenant/spec. Stripe product
// ids for the desk plans come ONLY from env (STRIPE_PRODUCT_AGENT /
// STRIPE_PRODUCT_DESK): the new entity's Stripe account mints new ids.
//
// One wallet holds one plan (subscriptions.owner_address is unique), so
// checkout refuses a second paid plan instead of double-billing
// (app/api/billing/checkout); the desk plans carry Plus's pool, so moving up
// from Plus gives nothing away.
//
// Pure config: /pricing, the dashboard and the billing APIs all read this.
// Client components import it, so it imports nothing that needs Node.

import { DESK_PLAN_ORDER, entitlementsFor } from '@/lib/tenant/entitlements'
import type { DeskPlanId } from '@/lib/tenant/spec'

export type PlanId = 'free' | 'plus' | 'growth' | 'scale' | 'agent' | 'desk' | 'enterprise'

/** 'answers' = the house-model plans (Free, Plus, the retired two);
 *  'desk' = the governed-desk plans. */
export type PlanFamily = 'answers' | 'desk'

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
  /** Which product the plan prices. Omitted = 'answers'. */
  family?: PlanFamily
  /** Sold by hand (a contract, not Stripe Checkout): never checkout-able,
   *  honored for a subscription row that carries it. */
  handSold?: boolean
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

// ── The desk, line by line (DESK_PLAN_FEATURES) ─────────────────────────────
// Every line is written FROM entitlementsFor, so a page reading this table
// can only promise what the gate holds. `soon` marks a line the plan includes
// whose machinery is not built yet (hooks are wave 2): a page must say so.

export interface DeskFeatureLine {
  text: string
  /** Included in the plan, not shipped yet — render it as coming. */
  soon?: boolean
}
export interface DeskPlanTier {
  id: DeskPlanId
  name: string
  tagline: string
  /** Agent/Desk: the Plan (price, yearly, checkout). Free/Enterprise: none. */
  plan: Plan | null
  /** Everything the tier includes, in order. */
  features: DeskFeatureLine[]
  /** The tier below, by name ("Everything in Agent, plus"); null for the first. */
  inherits: string | null
  /** The lines this tier adds over the one below (a card prints these). */
  adds: DeskFeatureLine[]
}

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
/** "One tenant" · "Five tenants" · "50 desk keys" · "Unlimited tenants". */
export function countWords(n: number, one: string, many: string): string {
  if (!Number.isFinite(n)) return `Unlimited ${many}`
  const word = n >= 0 && n < SMALL.length && Number.isInteger(n) ? SMALL[n] : n.toLocaleString('en-US')
  const cap = word.charAt(0).toUpperCase() + word.slice(1)
  return `${cap} ${n === 1 ? one : many}`
}

/** The one line that says a desk plan carries Plus's answers. */
export function includedAnswersLine(credits: number): string {
  return `Plus’s answers included: ${credits.toLocaleString('en-US')} house answers a month`
}

/** The house answers a desk tier carries each month: Plus's pool on every
 *  paid desk tier, none in the sandbox (it keeps the free daily taste). */
export function deskTierAnswers(id: DeskPlanId): number {
  return id === 'free' ? 0 : PLUS_PLAN.credits
}

export function deskFeatureLines(id: DeskPlanId): DeskFeatureLine[] {
  const e = entitlementsFor(id)
  const lines: DeskFeatureLine[] = []
  lines.push({
    text: e.mainnet
      ? `${countWords(e.tenants, 'tenant', 'tenants')} on mainnet`
      : `${countWords(e.tenants, 'tenant', 'tenants')}, sandbox only: Base Sepolia and Hyperliquid testnet`,
  })
  lines.push({
    text: Number.isFinite(e.keysPerTenant) && e.tenants > 1
      ? `${countWords(e.keysPerTenant, 'desk key', 'desk keys')} per tenant`
      : countWords(e.keysPerTenant, 'desk key', 'desk keys'),
  })
  lines.push({ text: 'A default-deny policy: venues, chains, tokens, sizes and hours' })
  lines.push({ text: 'A hash-chained blotter of every intent, verdict and fill' })
  if (e.blotterExport) lines.push({ text: 'Export the blotter as CSV' })
  if (e.approvals) lines.push({ text: 'Maker-checker: a second admin approves policy changes and large orders' })
  if (e.statement) lines.push({ text: 'A monthly statement' })
  const answers = deskTierAnswers(id)
  if (answers > 0) lines.push({ text: includedAnswersLine(answers) })
  if (e.hooks) lines.push({ text: 'Pre- and post-trade hooks', soon: true })
  return lines
}

/** A desk plan's Plan.highlights: the same lines, `soon` ones marked. */
function deskHighlights(id: DeskPlanId): string[] {
  return deskFeatureLines(id).map((f) => (f.soon ? `${f.text} (coming)` : f.text))
}

/** Plus — the house-answers plan. A const of its own so the desk plans can
 *  carry its allowance by reference (PLUS_PLAN.credits), never by a retyped
 *  number. */
const PLUS_PLAN: Plan = {
  id: 'plus',
  name: 'Plus',
  tagline: 'For people who ask more than they trade',
  priceUsd: 9,
  yearlyUsd: 79,
  // 600, not 300: the first measured week (inference_calls, 2026-09-18) put
  // a house answer at $0.0003–0.0014, far under the $0.03 estimate the
  // fuses are sized on. The maxed-plan rule is held at 1.5¢ an answer — ten
  // times the measured cost — so a maxed month still never exceeds its price.
  credits: 600,
  popular: true,
  highlights: [
    'Everything in Free',
    '600 house answers a month, on top of the daily free ones',
    'Market briefs and "explain this" without the hourly limit',
    'Earned and bought answers still stack, and never expire',
    'Early access to new agents',
  ],
}

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
  PLUS_PLAN,
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
  // ── The desk (2026-11-03). No stripeProductId on purpose: env only. ──────
  {
    id: 'agent',
    name: 'Agent',
    tagline: 'For one agent trading a real wallet',
    priceUsd: 49,
    yearlyUsd: 490,
    // Plus's monthly pool, included (read from Plus, never retyped).
    credits: PLUS_PLAN.credits,
    family: 'desk',
    highlights: deskHighlights('agent'),
  },
  {
    id: 'desk',
    name: 'Desk',
    tagline: 'For a desk: several books and a second pair of eyes',
    priceUsd: 499,
    yearlyUsd: 4990,
    credits: PLUS_PLAN.credits,
    family: 'desk',
    highlights: deskHighlights('desk'),
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For a firm: your custody, your terms, one statement a month',
    priceUsd: 0,
    credits: PLUS_PLAN.credits,
    family: 'desk',
    handSold: true,
    highlights: deskHighlights('enterprise'),
  },
]

export const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.id, p]),
) as Record<PlanId, Plan>

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PLAN_BY_ID, v)
}

export const planFamily = (p: Plan): PlanFamily => p.family ?? 'answers'

/** What the answers grid on /pricing and the dashboard list: the house-answer
 *  plans on sale (Free, Plus). The desk plans have their own list. */
export const LISTED_PLANS = PLANS.filter((p) => !p.legacy && planFamily(p) === 'answers')

/** The desk plans a buyer can check out (Agent, Desk). Enterprise is listed
 *  by DESK_PLAN_FEATURES but sold by hand. */
export const DESK_PLANS = PLANS.filter((p) => planFamily(p) === 'desk' && !p.legacy && !p.handSold)

/** Plans that can be checked out through Stripe today (every family). */
export const PAID_PLANS = PLANS.filter((p) => p.priceUsd > 0 && !p.legacy && !p.handSold)

/** May checkout sell this plan id? */
export function isCheckoutPlan(v: unknown): v is PlanId {
  return isPlanId(v) && PAID_PLANS.some((p) => p.id === v)
}

export type BillingInterval = 'month' | 'year'
export function isBillingInterval(v: unknown): v is BillingInterval {
  return v === 'month' || v === 'year'
}
/** The charge for a plan on an interval, in whole USD. */
export function planChargeUsd(plan: Plan, interval: BillingInterval): number {
  return interval === 'year' && plan.yearlyUsd ? plan.yearlyUsd : plan.priceUsd
}

const DESK_TIER_COPY: Record<DeskPlanId, { name: string; tagline: string }> = {
  free: { name: 'Sandbox', tagline: 'Wire a policy before you pay' },
  agent: { name: PLAN_BY_ID.agent.name, tagline: PLAN_BY_ID.agent.tagline },
  desk: { name: PLAN_BY_ID.desk.name, tagline: PLAN_BY_ID.desk.tagline },
  enterprise: { name: PLAN_BY_ID.enterprise.name, tagline: PLAN_BY_ID.enterprise.tagline },
}

/** The four desk tiers, cheapest first, with what each buys and what it adds
 *  over the tier below (a line whose text changed — "Three desk keys" over
 *  "One desk key" — is an addition; an identical line is inherited). */
export const DESK_PLAN_FEATURES: readonly DeskPlanTier[] = DESK_PLAN_ORDER.map((id, i) => {
  const features = deskFeatureLines(id)
  const prev = i > 0 ? DESK_PLAN_ORDER[i - 1] : null
  const below = new Set(prev ? deskFeatureLines(prev).map((f) => f.text) : [])
  return {
    id,
    ...DESK_TIER_COPY[id],
    plan: id === 'agent' || id === 'desk' ? PLAN_BY_ID[id] : null,
    features,
    inherits: prev ? DESK_TIER_COPY[prev].name : null,
    adds: features.filter((f) => !below.has(f.text)),
  }
})

/** One line for a Stripe product created inline (no product id in env). */
export function deskPlanSummary(id: DeskPlanId): string {
  return (DESK_PLAN_FEATURES.find((t) => t.id === id)?.features ?? [])
    .filter((f) => !f.soon)
    .slice(0, 4)
    .map((f) => f.text)
    .join(' · ')
}
