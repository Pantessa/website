// lib/onramp.ts — the fiat on-ramp door, planned around the user's INTENT.
//
// The only TRUE dead end in the funnel. A wallet holding nothing on any chain
// we can bridge from gets an honest refusal and NO artifact: "top up USDC or
// ETH on Base, Ethereum, or Arbitrum, tell me when it's there" is homework,
// not an action. Measured on the live /i/buy-aapl link (2026-08-27):
// 55 opened → 31 connected → 14 built. The 17 that connected and never got an
// artifact are this gap, and preflight:house can never see it because it runs
// with the funded burner.
//
// This module turns that refusal into ONE chip. Two properties carry it:
//
//   1. THE INTENT SURVIVES THE ROUND TRIP. A fund chip is a normal
//      ClarifyOption, so it still carries `resume` — the original ask,
//      restated. Coinbase takes the user off our page; when they come back the
//      resume fires and the ask they arrived with is still the ask. A funding
//      flow that loses the intent is just a link to an exchange.
//
//   2. FAIL CLOSED. Unconfigured → no chip at all, and every refusal reads
//      exactly as it does today. Same door discipline as the x402 paid tier:
//      a half-configured on-ramp must never render a button that 500s.
//
// Coinbase Onramp CANNOT deliver to Robinhood Chain (4663) — no on-ramp
// reaches a custom Orbit chain. It lands USDC on Base and the existing LiFi
// cascade carries it the rest of the way, so every plan here is denominated on
// a FUNDING_SCAN chain and the bridge stays the layer that crosses.

import type { ClarifyOption } from '@/lib/clarify'

/** Networks Coinbase Onramp can actually deliver to that our funding scan also
 *  reads. Deliberately NOT a superset of the onramp's catalog: a chain we
 *  can't scan is a chain we can't confirm arrival on. */
export type OnrampNetwork = 'base' | 'ethereum' | 'arbitrum'

/** USDC only. ETH would work, but a stable keeps the arithmetic in the chip
 *  label honest between the preset and what lands. */
export const ONRAMP_ASSET = 'USDC' as const

/** Coinbase's own floor for a card purchase. A preset under this is rejected
 *  at their door, which reads to the user as our bug. */
export const ONRAMP_MIN_USD = 5

/** Headroom over the plan. Card rails take a percentage, so a preset of
 *  EXACTLY the shortfall lands short and the user hits the same wall twice —
 *  the worst possible second impression. 10% + round up to the dollar. */
export const ONRAMP_HEADROOM = 0.1

/** Fail closed. The publishable project id is what the browser needs; the
 *  server also needs API-key material to mint the session token, but that is
 *  the route's business — this predicate gates whether a CHIP is offered at
 *  all, so it deliberately asks the narrower question. */
export function onrampEnabled(): boolean {
  return (
    process.env.ONRAMP_ENABLED === 'true' &&
    Boolean(process.env.CDP_API_KEY_ID) &&
    Boolean(process.env.CDP_API_KEY_SECRET)
  )
}

/** What to preset in the on-ramp for a plan that needs `needUsd`. Always at or
 *  above the plan and at or above Coinbase's floor. Pure — the harness pins
 *  the arithmetic, not a live quote. */
export function planFundUsd(needUsd: number): number {
  if (!Number.isFinite(needUsd) || needUsd <= 0) return ONRAMP_MIN_USD
  // Round to cents BEFORE the ceil: 100 * 1.1 is 110.00000000000001 in
  // binary floating point, which would preset $111 and read as a glitch.
  const withHeadroom = Number((needUsd * (1 + ONRAMP_HEADROOM)).toFixed(2))
  return Math.max(ONRAMP_MIN_USD, Math.ceil(withHeadroom))
}

/** Ceiling on any preset — mirrors clarify's MAX_FUND_USD clamp. */
export const ONRAMP_MAX_USD = 500

/** Clamp a preset the CLIENT sends back. Distinct from planFundUsd on
 *  purpose: the chip's amount ALREADY carries the headroom, so re-planning it
 *  server-side compounds — live drive 2026-08-27 rendered $14 and charged $16.
 *  The server's job here is bounds, not arithmetic. */
export function clampFundUsd(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return ONRAMP_MIN_USD
  return Math.min(ONRAMP_MAX_USD, Math.max(ONRAMP_MIN_USD, Math.ceil(n)))
}

export interface FundChipParams {
  /** Dollars the smallest plan needs, solver fees included. */
  needUsd: number
  /** What the money is FOR, as the refusal already says it ("buy $10 of
   *  AAPL"). This is the whole point — the chip names the intent. */
  actionLabel: string
  /** The ask, restated, fired when the user returns from Coinbase. Must
   *  round-trip the parse ladder like any other resume string. */
  resume: string
  /** Where the on-ramp should deliver. Base unless the caller knows better. */
  network?: OnrampNetwork
}

/** The fund chip, or null when the door is closed. Callers append it to their
 *  existing options and MUST keep their own refusal copy intact — the chip is
 *  an addition to an honest answer, never a replacement for one. */
export function fundChipFor(params: FundChipParams): ClarifyOption | null {
  if (!onrampEnabled()) return null
  const { needUsd, actionLabel, resume, network = 'base' } = params
  if (!resume.trim() || !actionLabel.trim()) return null
  const presetFiatUsd = planFundUsd(needUsd)
  return {
    label: `Add $${presetFiatUsd} with card or bank → ${actionLabel}`,
    resume,
    fund: { presetFiatUsd, asset: ONRAMP_ASSET, network },
  }
}

/** How long a consent signature stays good. Long enough to read the wallet
 *  prompt and think, short enough that a captured signature is worthless by
 *  the time it is replayed. */
export const ONRAMP_CONSENT_TTL_MS = 10 * 60_000

export interface OnrampConsentInput {
  address: string
  presetFiatUsd: number
  asset: string
  network: OnrampNetwork
  /** Client clock, echoed back with the signature. Bounds the replay window. */
  issuedAt: number
}

/**
 * The exact personal_sign text the wallet shows, and the exact text the server
 * re-derives to recover the signer. Line-keyed so a human can read every fact
 * it binds — CDP's integration review (case 500PC00000kDVUv, 2026-08-28)
 * called the unauthenticated route spoofable, and this is the answer: proof
 * that whoever asked for a session token controls the address it delivers to.
 *
 * personal_sign, not a transaction: the wallet being funded is empty by
 * definition, so it can pay no gas. It can still sign, which costs nothing and
 * is the only ownership proof available before there are funds — the same
 * consent-over-a-free-signature shape the HL delegated door uses.
 *
 * Deliberately NOT SIWE: signing in is how you KEEP a thread (#553), and this
 * wallet has not transacted yet. This proves address control for ONE funding
 * session and mints no session of its own.
 */
export function onrampConsentMessage(input: OnrampConsentInput): string {
  return [
    'Pantessa — fund this wallet',
    `Wallet: ${input.address.toLowerCase()}`,
    `Amount: $${input.presetFiatUsd} USD`,
    `Asset: ${input.asset} on ${input.network}`,
    `Issued: ${new Date(input.issuedAt).toISOString()}`,
    'Signing opens a Coinbase Onramp session that can only deliver funds TO this wallet. It moves nothing out and costs no gas.',
  ].join('\n')
}

/** The hosted Onramp URL. The session token is mandatory (Coinbase enforced
 *  this from 2025-07-31 — a bare URL is rejected), so this takes one rather
 *  than making it optional and failing at their door. */
export function onrampUrl(params: {
  sessionToken: string
  presetFiatUsd: number
  asset?: string
  network?: OnrampNetwork
}): string {
  const u = new URL('https://pay.coinbase.com/buy/select-asset')
  u.searchParams.set('sessionToken', params.sessionToken)
  u.searchParams.set('presetFiatAmount', String(params.presetFiatUsd))
  u.searchParams.set('fiatCurrency', 'USD')
  u.searchParams.set('defaultAsset', params.asset ?? ONRAMP_ASSET)
  u.searchParams.set('defaultNetwork', params.network ?? 'base')
  // BUY, not SEND. Coinbase's two experiences are selected by this parameter,
  // and WITHOUT it a signed-in Coinbase user lands in the transfer flow:
  // "Send USDC", sourced from their existing Coinbase balance. Observed live
  // 2026-09-03 — the funding chip opened a send screen whose only "add a
  // payment method" options were bank account and wire, because that is the
  // Coinbase ACCOUNT funding flow, not the on-ramp checkout. Card, Apple Pay
  // and Google Pay live on the BUY side, so a user with no Coinbase balance
  // hit a dead end one step after we handed them off.
  //
  // The path already says /buy/, which is exactly why this was easy to miss:
  // the path does not decide the experience, this does.
  u.searchParams.set('defaultExperience', 'buy')
  // defaultPaymentMethod is deliberately NOT set. Coinbase's own picker shows
  // what is actually available where the user is, and that varies: for this
  // project the buy options API returns CARD + FIAT_WALLET + ACH_BANK_ACCOUNT
  // + APPLE_PAY for US/USD, but only CARD + FIAT_WALLET for PT (no Apple Pay,
  // no ACH). Pinning APPLE_PAY would offer a method half our users cannot use.
  return u.toString()
}
