// lib/tenant/entitlements.ts — what a plan lets a tenant do (PLANS lane,
// squad five-million, 2026-11-03). Pure: no DB, no env, no clock.
//
// The OWNER's effective plan decides (lib/billing getEffectivePlan →
// `.plan.id`), never `tenant.plan` alone — that column is a cache the TENANT
// lane refreshes. Pass a plan id; anything this table does not name (Plus,
// the retired Growth/Scale, a typo, '') is the free tier: one sandbox tenant.
//
// Only TYPES come from lib/tenant/spec (it imports node:crypto for the
// blotter hash), so lib/plans.ts — which client components import — can read
// this file without dragging a Node built-in into the browser bundle.

import type { DeskPlanId, TenantEntitlements } from '@/lib/tenant/spec'

/** The desk plans, cheapest first. Same members as spec's DESK_PLAN_IDS
 *  (pinned in scripts/plans-pins.ts); spelled here so no runtime value is
 *  imported from spec. */
export const DESK_PLAN_ORDER = ['free', 'agent', 'desk', 'enterprise'] as const satisfies readonly DeskPlanId[]

const TABLE: Readonly<Record<DeskPlanId, Readonly<TenantEntitlements>>> = Object.freeze({
  // The sandbox: wire a policy before paying. Base Sepolia + HL testnet only.
  free: Object.freeze({ tenants: 1, keysPerTenant: 1, mainnet: false, blotterExport: false, approvals: false, hooks: false, statement: false }),
  // One agent, real money, a record you can take away.
  agent: Object.freeze({ tenants: 1, keysPerTenant: 3, mainnet: true, blotterExport: true, approvals: false, hooks: false, statement: false }),
  // A small desk: several books, a second pair of eyes, a monthly statement.
  desk: Object.freeze({ tenants: 5, keysPerTenant: 50, mainnet: true, blotterExport: true, approvals: true, hooks: true, statement: true }),
  // Hand-sold (engine 2): no caps.
  enterprise: Object.freeze({
    tenants: Number.POSITIVE_INFINITY,
    keysPerTenant: Number.POSITIVE_INFINITY,
    mainnet: true,
    blotterExport: true,
    approvals: true,
    hooks: true,
    statement: true,
  }),
})

export function isDeskPlanId(v: unknown): v is DeskPlanId {
  return typeof v === 'string' && (DESK_PLAN_ORDER as readonly string[]).includes(v)
}

/** What `plan` buys a tenant. Unknown plan → the free tier. Returns a fresh
 *  object, so a caller can never edit the table. */
export function entitlementsFor(plan: string): TenantEntitlements {
  const row = isDeskPlanId(plan) ? TABLE[plan] : TABLE.free
  return { ...row }
}

/** The on/off entitlements (everything but the two caps). */
export type EntitlementFlag = {
  [K in keyof TenantEntitlements]: TenantEntitlements[K] extends boolean ? K : never
}[keyof TenantEntitlements]
/** The counted entitlements. */
export type EntitlementCap = Exclude<keyof TenantEntitlements, EntitlementFlag>

export const ENTITLEMENT_FLAGS: readonly EntitlementFlag[] = ['mainnet', 'blotterExport', 'approvals', 'hooks', 'statement']
export const ENTITLEMENT_CAPS: readonly EntitlementCap[] = ['tenants', 'keysPerTenant']

/** Does `plan` switch `feature` on? */
export function planAllows(plan: string, feature: EntitlementFlag): boolean {
  return entitlementsFor(plan)[feature] === true
}

/** May an owner on `plan` add one more, holding `current` already? (A cap of
 *  3 admits the 1st, 2nd and 3rd; refuses the 4th.) */
export function capAllows(plan: string, cap: EntitlementCap, current: number): boolean {
  const n = Number.isFinite(current) && current > 0 ? Math.floor(current) : 0
  return n < entitlementsFor(plan)[cap]
}

/** The cheapest desk plan that switches `feature` on — for a refusal that
 *  names the way forward ("blotter export is on the Agent plan"). */
export function cheapestPlanAllowing(feature: EntitlementFlag): DeskPlanId {
  return DESK_PLAN_ORDER.find((p) => TABLE[p][feature]) ?? 'enterprise'
}

/** The cheapest desk plan whose `cap` admits `count` (e.g. a 4th key → 'desk'). */
export function cheapestPlanForCap(cap: EntitlementCap, count: number): DeskPlanId {
  return DESK_PLAN_ORDER.find((p) => count <= TABLE[p][cap]) ?? 'enterprise'
}

/** JSON-safe entitlements: Infinity does not survive JSON.stringify (it
 *  becomes null silently), so an unlimited cap is spelled `null` on purpose
 *  and documented as "unlimited". Every API that echoes entitlements uses it. */
export type EntitlementsJson = Omit<TenantEntitlements, EntitlementCap> & { [K in EntitlementCap]: number | null }
export function entitlementsJson(e: TenantEntitlements): EntitlementsJson {
  return {
    ...e,
    tenants: Number.isFinite(e.tenants) ? e.tenants : null,
    keysPerTenant: Number.isFinite(e.keysPerTenant) ? e.keysPerTenant : null,
  }
}
