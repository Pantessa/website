// lib/tenant/spec.ts — THE CONTRACT for the five-million squad (2026-11-03).
//
// Coordinator-owned. Every lane imports from here and never edits it; a lane
// that needs the contract changed writes the ask in its lane file under
// `## Spec asks`. Plan: /Users/nate/pantessa/GTM-PLAN-5M-ARR-2026-11-03.md §8.
//
// A TENANT is one firm's governed desk: a versioned, default-deny policy that
// says which venues exist for it, scoped desk keys that can never widen that
// policy, a gate that BLOCKS (never warns) for a tenant signer, and a
// hash-chained blotter the firm can export. The retail product is untouched:
// a wallet with no desk key is gated exactly as it is on main today (#1018).

import { createHash } from 'node:crypto'

// ── Identity ────────────────────────────────────────────────────────────────

/** Scoped desk keys wear this prefix; `yf_` keys stay personal/org keys. */
export const DESK_KEY_PREFIX = 'dk_'
export const DESK_KEY_RE = /^dk_[A-Za-z0-9_-]{24,}$/
export const TENANT_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/
export const DESK_ID_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$|^[a-z0-9]$/

// ── The vocabulary the policy speaks (the builders' own) ────────────────────

/** A venue = a guarded builder family. Matches `build_path` families on main. */
export const TENANT_VENUES = [
  'uniswap-v3',
  'uniswap-v4',
  'cow',
  'lifi',
  'near-intents',
  'aave-v4',
  'lido',
  'hyperliquid',
  'morpho',
  'opensea',
  'transfer',
  'policy-pool',
] as const
export type TenantVenue = (typeof TENANT_VENUES)[number]

export const TENANT_OPS = [
  'swap',
  'limit',
  'bridge',
  'supply',
  'withdraw',
  'borrow',
  'repay',
  'stake',
  'unstake',
  'perp-open',
  'perp-close',
  'transfer',
  'nft-buy',
  'nft-sell',
] as const
export type TenantOp = (typeof TENANT_OPS)[number]

export const TENANT_SIDES = ['buy', 'sell', 'long', 'short'] as const
export type TenantSide = (typeof TENANT_SIDES)[number]

export const SIGNING_LANES = ['wallet', 'walletconnect', 'viem', 'safe'] as const
export type SigningLane = (typeof SIGNING_LANES)[number]

/** Which venues run on which chains (the gate refuses a chain the venue does
 *  not run on even when the rule omits `chains`). HL is off-chain (null). */
export const VENUE_CHAINS: Record<TenantVenue, readonly number[] | null> = {
  'uniswap-v3': [1, 8453, 42161, 10, 4663],
  'uniswap-v4': [4663, 8453, 84532],
  cow: [1, 8453, 42161],
  lifi: [4663],
  'near-intents': [1, 8453, 42161, 10, 4663],
  'aave-v4': [1, 8453, 42161],
  lido: [1],
  hyperliquid: null,
  morpho: [4663, 8453],
  opensea: [1, 8453],
  transfer: [1, 8453, 42161, 10, 4663, 84532],
  'policy-pool': [8453, 84532],
}

// ── The policy document (what a tenant's compliance writes; versioned) ──────

export interface TenantVenueRule {
  venue: TenantVenue
  /** Omitted = every chain in VENUE_CHAINS[venue]. */
  chains?: number[]
  /** Omitted = every op the venue has. */
  ops?: TenantOp[]
  /** Symbols (UPPER) or 0x addresses (lower). Omitted = any token. Every token
   *  the order touches must be listed when the list is present. */
  tokens?: string[]
  sides?: TenantSide[]
  maxOrderUsd?: number
  maxPriceImpactBps?: number
  maxLeverage?: number
}

export interface TenantDeskRule {
  /** DESK_ID_RE */
  id: string
  perOrderUsd?: number
  perDayUsd?: number
  /** An order over `overUsd` needs `approvers` DISTINCT admin approvals
   *  (TenantApproval rows) before a leg is offered. */
  approvals?: { overUsd: number; approvers: number }
  /** Trading hours in an IANA zone; 'HH:MM' 24h; days 0–6, Sunday = 0. */
  hours?: { tz: string; from: string; to: string; days: number[] }
}

export interface TenantPolicyDoc {
  version: 1
  /** Always 'deny' in v1 — an order no venue rule admits is refused. */
  default: 'deny'
  venues: TenantVenueRule[]
  desks: TenantDeskRule[]
  hooks?: { preTrade?: string; postTrade?: string }
  signing?: { lane: SigningLane; wallets: string[] }
}

// ── The order the gate judges (one leg, as the builder knows it) ────────────

export interface TenantOrder {
  venue: TenantVenue
  op: TenantOp
  /** null for an off-chain venue (Hyperliquid). */
  chainId: number | null
  /** Every token the order touches: symbols UPPER or addresses lower. */
  tokens: string[]
  side: TenantSide | null
  /** null = unpriceable → a tenant order is REFUSED (never warned through). */
  usd: number | null
  leverage?: number | null
  priceImpactBps?: number | null
  deskId: string
  /** ms epoch the order is judged at (hours rule); defaults to now. */
  at?: number
  /** The desk's blotter-derived spend so far today (UTC), USD. */
  spentTodayUsd?: number
}

export type TenantRefusal =
  | 'NO_POLICY'
  | 'TENANT_PAUSED'
  | 'KEY_PAUSED'
  | 'DESK_UNKNOWN'
  | 'VENUE_DENIED'
  | 'CHAIN_DENIED'
  | 'OP_DENIED'
  | 'TOKEN_DENIED'
  | 'SIDE_DENIED'
  | 'UNPRICED'
  | 'OVER_ORDER'
  | 'OVER_DAY'
  | 'OVER_LEVERAGE'
  | 'OVER_IMPACT'
  | 'OUTSIDE_HOURS'
  | 'SANDBOX_ONLY'
  // the desk's own door refusals (TENANT lane, 2026-11-03)
  | 'KEY_UNKNOWN'
  | 'KEY_REVOKED'
  | 'TENANT_MISMATCH'
  | 'NOT_ON_TENANT_DESK'
  | 'SIGNER_DENIED'
  | 'APPROVAL_PENDING'

export type TenantVerdict =
  | { allowed: true; rule: TenantVenueRule; desk: TenantDeskRule; needsApproval: false }
  | { allowed: true; rule: TenantVenueRule; desk: TenantDeskRule; needsApproval: true; approvers: number }
  | { allowed: false; reason: TenantRefusal; detail: string }

/** What a resolved desk key carries into a request. */
export interface TenantContext {
  tenantId: string
  tenantSlug: string
  deskId: string
  keyId: string
  plan: string
  sandbox: boolean
  status: 'active' | 'paused'
  policy: TenantPolicyDoc | null
  policyVersion: number | null
  signingLane: SigningLane
  signers: string[]
}

// ── Pricing (engine 2 and 3 of the plan; the statement and the pages read these) ──

export const DESK_PLATFORM_FEE_USD = 4000
/** Monthly tiers on receipt-verified notional, marginal: 10 bps to $10M,
 *  5 bps to $100M, 2 bps above. */
export const DESK_FEE_TIERS: ReadonlyArray<{ uptoUsd: number; bps: number }> = [
  { uptoUsd: 10_000_000, bps: 10 },
  { uptoUsd: 100_000_000, bps: 5 },
  { uptoUsd: Number.POSITIVE_INFINITY, bps: 2 },
]
export const DESIGN_PARTNER_FREE_DAYS = 90

/** Marginal tiered fee on a month's verified notional. Pure. */
export function tieredDeskFeeUsd(notionalUsd: number): number {
  let left = Math.max(0, notionalUsd)
  let prev = 0
  let fee = 0
  for (const t of DESK_FEE_TIERS) {
    const span = Math.min(left, t.uptoUsd - prev)
    if (span <= 0) break
    fee += (span * t.bps) / 10_000
    left -= span
    prev = t.uptoUsd
  }
  return Math.round(fee * 100) / 100
}

/** Plan ids the desk sells (lib/plans.ts owns the price/copy; PLANS lane). */
export const DESK_PLAN_IDS = ['free', 'agent', 'desk', 'enterprise'] as const
export type DeskPlanId = (typeof DESK_PLAN_IDS)[number]

export interface TenantEntitlements {
  /** How many tenants an owner may create. */
  tenants: number
  /** Desk keys per tenant. */
  keysPerTenant: number
  /** May a tenant leave the sandbox (mainnet chains)? */
  mainnet: boolean
  blotterExport: boolean
  /** Maker-checker on policy edits + approvals over a threshold. */
  approvals: boolean
  hooks: boolean
  statement: boolean
}

// ── The blotter (hash-chained; BLOTTER lane implements recordBlotter) ───────

export const BLOTTER_KINDS = [
  'intent', // an order reached the desk (ask, venue, usd)
  'policy_verdict', // the gate's answer (allowed / refused + reason)
  'build', // a leg was built (quotes considered, route chosen)
  'offered', // the unsigned leg was offered to the signer
  'signed', // the signer reported a signature / hash
  'settled', // the chain / venue proved it (verification state)
  'refused', // a relay refused a signed leg
  'approval', // an admin approved an over-threshold intent
  'policy_proposed',
  'policy_activated',
  'policy_rejected',
  'key_minted',
  'key_paused',
  'key_resumed',
  'key_revoked',
  'tenant_paused',
  'tenant_resumed',
  'tenant_updated', // admins / signers / signing lane / name changed (PATCH)
  'statement', // a monthly statement was cut
] as const
export type BlotterKind = (typeof BLOTTER_KINDS)[number]

export type BlotterVerification = 'verified' | 'attested' | 'unverified' | 'mismatch'

export interface BlotterEvent {
  tenantId: string
  kind: BlotterKind
  intentId?: string | null
  jobId?: string | null
  deskId?: string | null
  keyId?: string | null
  venue?: TenantVenue | string | null
  chainId?: number | null
  valueUsd?: number | null
  feeUsd?: number | null
  feeBps?: number | null
  txHash?: string | null
  verification?: BlotterVerification | null
  /** Free-form, kind-specific; canonicalised into the hash. */
  payload: Record<string, unknown>
}

export const BLOTTER_GENESIS = '0'.repeat(64)

/** Sorted keys, no whitespace, `undefined` dropped — the ONE encoding both
 *  the writer and any verifier hash. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeys(v))
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o).sort()) {
      if (o[k] !== undefined) out[k] = sortKeys(o[k])
    }
    return out
  }
  return v
}

/** sha256 hex over the previous hash, the sequence, the kind, the ISO time
 *  and the canonical payload — the chain a tenant (or auditor) can replay. */
export function blotterHash(input: { prevHash: string; seq: number; kind: string; createdAtIso: string; payload: unknown }): string {
  const h = createHash('sha256')
  h.update(`${input.prevHash}\n${input.seq}\n${input.kind}\n${input.createdAtIso}\n${canonicalJson(input.payload)}`)
  return h.digest('hex')
}

// ── Cross-lane function contracts (names fixed; each lane owns its file) ────
//
// TENANT  → lib/tenant/policy.ts   evaluateTenantPolicy(doc: TenantPolicyDoc | null, ctx: Pick<TenantContext,'status'|'sandbox'>, order: TenantOrder): TenantVerdict   (pure)
//            lib/tenant/store.ts    resolveDeskKey(req): Promise<TenantContext | null> · activePolicy(tenantId) · recordKeyUse(keyId)
//            lib/tenant/order.ts    orderOfPlan(plan, deskId): TenantOrder | null  (the desk's plan → the gate's order)
//            lib/tenant/gate.ts     tenantGate(ctx, order, ids): Promise<TenantVerdict>  (evaluate + recordBlotter 'policy_verdict')
//            app/api/tenants/**     CRUD, policy propose/approve, keys, approvals (SIWE owner/admins)
// BLOTTER → lib/tenant/blotter.ts   recordBlotter(e: BlotterEvent): Promise<void>  (never throws; per-tenant seq + hash chain)
//            lib/tenant/statement.ts monthlyStatement(tenantId, ym: 'YYYY-MM') · verifyChain(tenantId)
//            app/api/tenants/[id]/blotter · …/statement
// PLANS   → lib/plans.ts            PLAN_BY_ID.agent / .desk (on sale) · lib/tenant/entitlements.ts entitlementsFor(plan: string): TenantEntitlements
// DESKPAGE→ app/desk/** · lib/legal.ts · app/docs/desk
// PERPS   → lib/telegram.ts · app/api/telegram/** · the referral on every share surface
// CUSTODY → sdk: driveJob `order` legs + a Safe signer; website: scripts/safe-drill.ts
