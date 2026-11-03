// components/desk/types.ts — the shapes the desk console reads (squad
// five-million, CONSOLE lane, 2026-11-03). Plain data only: these mirror the
// JSON the tenant routes answer (app/api/tenants/**), never a server module,
// so every client file under components/desk can import them. The policy
// document itself is lib/tenant/spec's TenantPolicyDoc (a type-only import —
// spec pulls in node:crypto, which must never reach the browser bundle).

import type { TenantPolicyDoc } from '@/lib/tenant/spec'

export type { TenantPolicyDoc }

/** lib/tenant/entitlements entitlementsJson: an unlimited cap is null. */
export interface EntitlementsJson {
  tenants: number | null
  keysPerTenant: number | null
  mainnet: boolean
  blotterExport: boolean
  approvals: boolean
  hooks: boolean
  statement: boolean
}

/** lib/tenant/store tenantView (admins = owner ∪ tenant.admins, lowercased). */
export interface TenantJson {
  id: string
  slug: string
  name: string
  ownerAddress: string
  admins: string[]
  plan: string
  sandbox: boolean
  status: string
  signingLane: string
  signers: string[]
  feeBps: number | null
  feeMode: string | null
  createdAt: string
  updatedAt: string
}

/** GET /api/tenants */
export interface TenantListJson {
  tenants: TenantJson[]
  plan: string
  entitlements: EntitlementsJson
  owned: number
  canCreate: boolean
}

/** lib/tenant/store deskKeyView — never a hash, never a secret. */
export interface KeyJson {
  id: string
  deskId: string
  label: string
  prefix: string
  paused: boolean
  revoked: boolean
  revokedAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

export interface PolicyVersionJson {
  version: number
  state: 'proposed' | 'active' | 'superseded' | 'rejected' | string
  proposedBy: string
  approvedBy: string | null
  note: string | null
  createdAt: string
  activatedAt: string | null
  /** Present on GET …/policy (the documents ride there, not on GET …/:id). */
  document?: TenantPolicyDoc
}

/** GET /api/tenants/:id */
export interface TenantDetailJson {
  tenant: TenantJson
  entitlements: EntitlementsJson
  policy: { version: number; document: TenantPolicyDoc } | null
  versions: PolicyVersionJson[]
  keys: KeyJson[]
  you: { address: string; owner: boolean }
}

/** lib/tenant/blotter rowJson */
export interface BlotterRowJson {
  seq: number
  createdAt: string
  kind: string
  intentId: string | null
  jobId: string | null
  deskId: string | null
  keyId: string | null
  venue: string | null
  chainId: number | null
  valueUsd: number | null
  feeUsd: number | null
  feeBps: number | null
  txHash: string | null
  verification: string | null
  prevHash: string
  hash: string
  payload: Record<string, unknown> | null
}

/** GET /api/tenants/:id/blotter */
export interface BlotterPageJson {
  tenant: { id: string; slug: string; name: string }
  head: { seq: number; hash: string } | null
  rows: BlotterRowJson[]
  next: number | null
}

/** GET /api/tenants/:id/blotter/verify */
export interface VerifyJson {
  ok: boolean
  rows: number
  brokenAt?: number
  reason?: string
  head?: { seq: number; hash: string } | null
}

/** GET /api/tenants/:id/statement — the parts the console prints. */
export interface StatementJson {
  plan: string
  preview: boolean
  entitlement?: string
  note?: string
  statement: {
    ym: string
    period: { from: string; to: string }
    closed: boolean
    final: boolean
    existing: boolean
    seq: number | null
    hash: string | null
    notionalUsd: number
    basisNote: string
    amountDueUsd: number
    lines: { id: 'platform' | 'execution' | 'credit'; description: string; amountUsd: number }[]
    legs: { total: number; unpriced: number }
    platform: { applies: boolean; note: string }
    invoice: { id?: string; status?: string } | null
    invoiceNote: string
  }
}

/** Everything the console needs from lib/tenant/spec + lib/tenant/policy,
 *  computed on the SERVER (components/desk/vocab.server) and handed down as
 *  props, so the browser never imports a module that pulls in node:crypto. */
export interface DeskVocab {
  venues: string[]
  ops: string[]
  sides: string[]
  lanes: string[]
  /** venue → chain ids it runs on; null = off-chain (Hyperliquid). */
  venueChains: Record<string, number[] | null>
  /** chain id → name ("Base"), for every chain a venue names + the testnets. */
  chainNames: Record<string, string>
  /** chain id → the explorer's tx URL prefix. */
  explorers: Record<string, string>
  /** Chains a sandbox tenant may touch. */
  testnets: number[]
  kinds: string[]
  kindWords: Record<string, string>
  /** The README's demo policy (lib/tenant/policy SAMPLE_POLICY). */
  sample: TenantPolicyDoc
  /** Regex sources (spec TENANT_SLUG_RE / DESK_ID_RE). */
  slugRe: string
  deskIdRe: string
  /** The desk plans, cheapest first (lib/tenant/entitlements DESK_PLAN_ORDER). */
  planOrder: string[]
  deskKeyPrefix: string
}
