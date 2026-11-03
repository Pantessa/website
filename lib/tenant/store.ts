// lib/tenant/store.ts — STUB (TENANT lane replaces this file). Resolves a
// `dk_` desk key on a request into a TenantContext. The stub resolves nothing:
// every caller is retail until the real store lands.
import type { NextRequest } from 'next/server'
import type { TenantContext } from '@/lib/tenant/spec'

export async function resolveDeskKey(_req: NextRequest): Promise<TenantContext | null> {
  return null
}
