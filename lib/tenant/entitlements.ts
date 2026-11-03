// lib/tenant/entitlements.ts — STUB (PLANS lane replaces this file). What a
// plan lets a tenant do. The stub is the free tier for everyone: one sandbox
// tenant, one key, nothing exported.
import type { TenantEntitlements } from '@/lib/tenant/spec'

export function entitlementsFor(_plan: string): TenantEntitlements {
  return { tenants: 1, keysPerTenant: 1, mainnet: false, blotterExport: false, approvals: false, hooks: false, statement: false }
}
