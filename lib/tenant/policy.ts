// lib/tenant/policy.ts — STUB (TENANT lane replaces this file). The pure
// evaluator: a tenant order against the active policy document. The stub
// refuses everything with NO_POLICY so nothing can slip through before the
// real gate lands.
import type { TenantContext, TenantOrder, TenantPolicyDoc, TenantVerdict } from '@/lib/tenant/spec'

export function evaluateTenantPolicy(
  _doc: TenantPolicyDoc | null,
  _ctx: Pick<TenantContext, 'status' | 'sandbox'>,
  _order: TenantOrder,
): TenantVerdict {
  return { allowed: false, reason: 'NO_POLICY', detail: 'The tenant policy engine is not built yet.' }
}
