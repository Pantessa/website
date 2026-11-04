// lib/tenant/store.ts — tenants, desk keys and policies on disk (TENANT lane).
//
// A request carrying `Authorization: Bearer dk_…` is a TENANT caller: the
// secret's sha256 finds one desk_keys row (never revoked), the row's tenant,
// and that tenant's ACTIVE policy — the TenantContext every gate reads. A
// `yf_` key or no key at all is RETAIL, exactly as main today; this file
// never touches that path.
//
// The one rule a tenant caller can never fall through: a `dk_` bearer that
// does not resolve (unknown, revoked) is REFUSED, never demoted to retail. A
// revoked key that quietly became an ungated retail caller would be the
// worst possible failure of a desk that sells "a tenant signer BLOCKS".

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { getEffectivePlan } from '@/lib/billing'
import { entitlementsFor } from '@/lib/tenant/entitlements'
import { DESK_KEY_PREFIX, DESK_KEY_RE, SIGNING_LANES, type SigningLane, type TenantContext, type TenantEntitlements, type TenantPolicyDoc } from '@/lib/tenant/spec'

/* ── keys ─────────────────────────────────────────────────────────────── */

/** How many characters of the secret are kept in the clear to recognize it
 *  ("dk_a1B2c3d4…") — spec: the first 11. */
export const DESK_KEY_PREFIX_LEN = 11

export function hashDeskKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/** A fresh desk key. The plaintext is returned to the minting admin ONCE. */
export function generateDeskKey(): { secret: string; hash: string; prefix: string } {
  const secret = DESK_KEY_PREFIX + randomBytes(32).toString('base64url')
  return { secret, hash: hashDeskKey(secret), prefix: secret.slice(0, DESK_KEY_PREFIX_LEN) }
}

type HeaderLike = Headers | Record<string, string | string[] | undefined> | null | undefined

function headerValue(h: HeaderLike, name: string): string | null {
  if (!h) return null
  if (typeof (h as Headers).get === 'function') return (h as Headers).get(name)
  const rec = h as Record<string, string | string[] | undefined>
  const v = rec[name] ?? rec[name.toLowerCase()] ?? rec[name.toUpperCase()]
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

/** What the Authorization header claims: nothing, some other credential
 *  (`yf_` and friends — retail), or a desk key. Pure. */
export function deskKeyPresented(headers: HeaderLike): { kind: 'none' } | { kind: 'other' } | { kind: 'desk'; secret: string } {
  const raw = (headerValue(headers, 'authorization') ?? '').trim()
  if (!raw) return { kind: 'none' }
  const m = /^Bearer\s+(\S+)$/i.exec(raw)
  if (!m) return { kind: 'other' }
  if (!m[1].startsWith(DESK_KEY_PREFIX)) return { kind: 'other' }
  return { kind: 'desk', secret: m[1] }
}

/** A resolved desk key: the spec's TenantContext plus WHICH pause (if any)
 *  refuses it, so the desk can say KEY_PAUSED vs TENANT_PAUSED by name. */
export type ResolvedTenant = TenantContext & { pausedBy: 'key' | 'tenant' | null; keyRevoked: boolean; tenantName: string; ownerAddress: string }

export type DeskCaller =
  | { kind: 'retail' }
  | { kind: 'tenant'; ctx: ResolvedTenant }
  | { kind: 'refused'; reason: 'KEY_UNKNOWN' | 'KEY_REVOKED'; detail: string; tenantId?: string; keyId?: string; deskId?: string }

/** The desk's caller, from the request headers the MCP transport hands every
 *  tool callback (or a NextRequest's). Touches the key's lastUsedAt. */
export async function resolveDeskCaller(headers: HeaderLike): Promise<DeskCaller> {
  const presented = deskKeyPresented(headers)
  if (presented.kind !== 'desk') return { kind: 'retail' }
  if (!DESK_KEY_RE.test(presented.secret)) {
    return { kind: 'refused', reason: 'KEY_UNKNOWN', detail: 'the Authorization header carries a dk_ desk key in a shape no desk mints — check it was copied whole.' }
  }
  const hash = hashDeskKey(presented.secret)
  const key = await prisma.deskKey.findUnique({ where: { hash }, include: { tenant: true } }).catch(() => null)
  if (!key || !timingSafeEqual(Buffer.from(hash), Buffer.from(key.hash))) {
    return { kind: 'refused', reason: 'KEY_UNKNOWN', detail: 'this desk key is not one any tenant minted. A tenant desk never falls back to the retail desk — ask a tenant admin for a key.' }
  }
  if (key.revokedAt) {
    return { kind: 'refused', reason: 'KEY_REVOKED', detail: `this desk key (${key.prefix}…) was revoked by a tenant admin and will never work again — ask for a new one.`, tenantId: key.tenantId, keyId: key.id, deskId: key.deskId }
  }
  recordKeyUse(key.id)
  const [active, plan] = await Promise.all([activePolicy(key.tenantId), effectiveTenantPlan(key.tenant)])
  return { kind: 'tenant', ctx: contextOf(key.tenant, key, active, false, plan) }
}

/**
 * QA F5 — the sandbox is DERIVED at resolve time: a tenant is in the sandbox
 * when its column says so OR its owner's EFFECTIVE plan now (lib/billing
 * getEffectivePlan) does not include mainnet. A downgrade puts it back in the
 * sandbox at the next call; the sticky columns are refreshed from the plan.
 */
async function effectiveTenantPlan(tenant: TenantRow): Promise<{ plan: string; mainnet: boolean }> {
  const plan = await ownerPlanId(tenant.ownerAddress)
  const mainnet = entitlementsFor(plan).mainnet === true
  const data: { plan?: string; sandbox?: boolean } = {}
  if (tenant.plan !== plan) data.plan = plan
  if (!mainnet && !tenant.sandbox) data.sandbox = true
  if (Object.keys(data).length) await prisma.tenant.update({ where: { id: tenant.id }, data }).catch(() => {})
  return { plan, mainnet }
}

/** Spec contract: `Authorization: Bearer dk_…` → TenantContext, or null for a
 *  retail caller AND for a key that does not resolve. Callers that must tell
 *  those two apart (every desk door) use resolveDeskCaller. */
export async function resolveDeskKey(req: Pick<NextRequest, 'headers'>): Promise<TenantContext | null> {
  const c = await resolveDeskCaller(req.headers)
  return c.kind === 'tenant' ? c.ctx : null
}

type TenantRow = NonNullable<Awaited<ReturnType<typeof prisma.tenant.findUnique>>>
type KeyRow = { id: string; deskId: string; paused: boolean }

function contextOf(
  tenant: TenantRow,
  key: KeyRow,
  active: { version: number; doc: TenantPolicyDoc } | null,
  keyRevoked: boolean,
  eff: { plan: string; mainnet: boolean },
): ResolvedTenant {
  const tenantPaused = tenant.status !== 'active'
  const pausedBy = key.paused || keyRevoked ? 'key' : tenantPaused ? 'tenant' : null
  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    ownerAddress: tenant.ownerAddress.toLowerCase(),
    deskId: key.deskId,
    keyId: key.id,
    plan: eff.plan,
    sandbox: tenant.sandbox || !eff.mainnet,
    status: pausedBy ? 'paused' : 'active',
    pausedBy,
    keyRevoked,
    policy: active?.doc ?? null,
    policyVersion: active?.version ?? null,
    signingLane: (SIGNING_LANES as readonly string[]).includes(tenant.signingLane) ? (tenant.signingLane as SigningLane) : 'wallet',
    signers: lowerList(tenant.signers),
  }
}

/** The context a JOB carries, read from the server's own record (the relays
 *  re-gate with it; a client claim never names the tenant). A revoked key or
 *  a vanished tenant reads as paused — a leg with no living key never moves. */
export async function tenantContextForJob(job: { tenantId: string | null; deskKeyId: string | null }): Promise<ResolvedTenant | null> {
  if (!job.tenantId) return null
  const tenant = await prisma.tenant.findUnique({ where: { id: job.tenantId } }).catch(() => null)
  const key = job.deskKeyId ? await prisma.deskKey.findUnique({ where: { id: job.deskKeyId } }).catch(() => null) : null
  const active = await activePolicy(job.tenantId)
  const eff = tenant ? await effectiveTenantPlan(tenant) : { plan: 'free', mainnet: false }
  if (!tenant) {
    return {
      tenantId: job.tenantId, tenantSlug: '?', tenantName: '?', ownerAddress: '', deskId: key?.deskId ?? '?', keyId: job.deskKeyId ?? '?', plan: 'free', sandbox: true,
      status: 'paused', pausedBy: 'tenant', keyRevoked: false, policy: null, policyVersion: null, signingLane: 'wallet', signers: [],
    }
  }
  // A key that is gone, revoked, or belongs to another tenant never moves a leg.
  const living = key && key.tenantId === tenant.id && !key.revokedAt ? key : null
  return contextOf(tenant, living ?? { id: job.deskKeyId ?? '?', deskId: key?.deskId ?? '?', paused: false }, active, !living, eff)
}

/** Fire-and-forget: a key's last use, for the admin's key list. */
export function recordKeyUse(keyId: string): void {
  prisma.deskKey.update({ where: { id: keyId }, data: { lastUsedAt: new Date() } }).catch(() => {})
}

/* ── policies ────────────────────────────────────────────────────────── */

/** The tenant's ACTIVE policy (the one row in state `active`; newest wins if
 *  a race ever left two). null = no policy → every order is NO_POLICY. */
export async function activePolicy(tenantId: string): Promise<{ version: number; doc: TenantPolicyDoc; id: string } | null> {
  const row = await prisma.tenantPolicy
    .findFirst({ where: { tenantId, state: 'active' }, orderBy: { version: 'desc' } })
    .catch(() => null)
  if (!row) return null
  return { id: row.id, version: row.version, doc: row.document as unknown as TenantPolicyDoc }
}

/* ── admins + plans ──────────────────────────────────────────────────── */

export function lowerList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()) : []
}

/** Admins = tenant.admins ∪ the owner. */
export function tenantAdmins(t: { ownerAddress: string; admins: unknown }): string[] {
  return [...new Set([t.ownerAddress.toLowerCase(), ...lowerList(t.admins)])]
}

export function isTenantAdmin(t: { ownerAddress: string; admins: unknown }, addr: string | null | undefined): boolean {
  return !!addr && tenantAdmins(t).includes(addr.toLowerCase())
}

/** What the OWNER's effective plan (lib/billing) lets the tenant do — never
 *  `tenant.plan` alone. Refreshes the column when the plan moved. */
export async function tenantEntitlements(t: { id?: string; ownerAddress: string; plan?: string }): Promise<{ plan: string; ent: TenantEntitlements }> {
  const plan = await ownerPlanId(t.ownerAddress)
  if (t.id && t.plan !== undefined && t.plan !== plan) {
    await prisma.tenant.update({ where: { id: t.id }, data: { plan } }).catch(() => {})
  }
  return { plan, ent: entitlementsFor(plan) }
}

export async function ownerPlanId(owner: string): Promise<string> {
  const eff = await getEffectivePlan(owner.toLowerCase()).catch(() => null)
  return eff?.plan?.id ?? 'free'
}

/** Distinct admin approvals recorded for one intent. */
export async function approvalCount(intentId: string): Promise<number> {
  return prisma.tenantApproval.count({ where: { intentId } }).catch(() => 0)
}

/* ── the tenant routes' door (SIWE owner/admin) ──────────────────────── */

export type AdminGate =
  | { ok: true; tenant: TenantRow; addr: string; isOwner: boolean }
  | { ok: false; status: number; error: string }

/** The signed-in wallet's view of one tenant: 401 signed out; 404 when the
 *  tenant does not exist OR the wallet is not one of its admins (the same
 *  answer, so a stranger learns nothing). A desk key never opens this door —
 *  only a SIWE session does. */
export async function tenantForAdmin(id: string, sessionAddress: string | null): Promise<AdminGate> {
  if (!sessionAddress) return { ok: false, status: 401, error: 'Not signed in.' }
  const tenant = typeof id === 'string' && id ? await prisma.tenant.findUnique({ where: { id } }).catch(() => null) : null
  if (!tenant || !isTenantAdmin(tenant, sessionAddress)) return { ok: false, status: 404, error: 'Not found.' }
  return { ok: true, tenant, addr: sessionAddress.toLowerCase(), isOwner: tenant.ownerAddress.toLowerCase() === sessionAddress.toLowerCase() }
}

/** The tenant as its admins read it (never a key hash, never a secret). */
export function tenantView(t: TenantRow) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    ownerAddress: t.ownerAddress,
    admins: tenantAdmins(t),
    plan: t.plan,
    sandbox: t.sandbox,
    status: t.status,
    signingLane: t.signingLane,
    signers: lowerList(t.signers),
    feeBps: t.feeBps,
    feeMode: t.feeMode,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
}

/** A desk key as its admins read it. */
export function deskKeyView(k: { id: string; deskId: string; label: string; prefix: string; paused: boolean; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }) {
  return { id: k.id, deskId: k.deskId, label: k.label, prefix: k.prefix, paused: k.paused, revoked: !!k.revokedAt, revokedAt: k.revokedAt, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt }
}

/** "the Desk plan" — a plan id in a sentence. */
export const planName = (id: string): string => `the ${id.charAt(0).toUpperCase()}${id.slice(1)} plan`

/* ── signer registration: proof of control (QA B1) ───────────────────────
 * A custody address enters `tenant.signers` only with the address's own
 * signature over a challenge bound to THIS tenant, THIS address and a
 * 15-minute window — personal_sign for an EOA, EIP-1271 for a smart account
 * (a Safe). The challenge is stateless (HMAC over tenant + address + expiry
 * with SESSION_SECRET) and single-use through the blotter: the nonce rides
 * the `tenant_updated` row that registers it, and a nonce already on a row
 * is refused. ASCII only — a wallet is asked to sign it (#830). */

export const SIGNER_CHALLENGE_TTL_MS = 15 * 60_000
/** Challenges are minted per 5-minute bucket and live until the end of the
 *  third bucket after (10–15 minutes) — deterministic, so a POST that carries
 *  only { address, signature } (the console's shape) can be matched against
 *  the few challenges that can still be live, no store needed. */
export const SIGNER_CHALLENGE_BUCKET_MS = 5 * 60_000

function challengeMac(tenantId: string, address: string, expiresAt: number): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set — signer challenges cannot be minted on this server.')
  return createHmac('sha256', secret).update(`tenant-signer:${tenantId}:${address.toLowerCase()}:${expiresAt}`).digest('hex').slice(0, 24)
}

/** The exact text the address signs. */
export function signerChallengeText(slug: string, address: string, nonce: string): string {
  return `Pantessa tenant ${slug}: register ${address.toLowerCase()} as a signer. Nonce ${nonce}.`
}

const expiryOfBucket = (b: number) => (b + 3) * SIGNER_CHALLENGE_BUCKET_MS
const nonceOf = (tenantId: string, address: string, expiresAt: number) => `${expiresAt}-${challengeMac(tenantId, address, expiresAt)}`

/** Mint a challenge: nonce = `<expiresAtMs>-<mac>`, expiring 10–15 minutes from now. */
export function mintSignerChallenge(t: { id: string; slug: string }, address: string, now = Date.now()): { message: string; nonce: string; expiresAt: string } {
  const expiresAt = expiryOfBucket(Math.floor(now / SIGNER_CHALLENGE_BUCKET_MS))
  const nonce = nonceOf(t.id, address, expiresAt)
  return { message: signerChallengeText(t.slug, address, nonce), nonce, expiresAt: new Date(expiresAt).toISOString() }
}

/** Every challenge nonce for (tenant, address) that can still be live now. */
export function liveSignerNonces(t: { id: string }, address: string, now = Date.now()): string[] {
  const b = Math.floor(now / SIGNER_CHALLENGE_BUCKET_MS)
  return [b, b - 1, b - 2].map(expiryOfBucket).filter((exp) => exp > now).map((exp) => nonceOf(t.id, address, exp))
}

/** Check a nonce is this tenant's, for this address, and inside its window. */
export function signerNonceOk(t: { id: string }, address: string, nonce: unknown, now = Date.now()): { ok: true } | { ok: false; why: string } {
  if (typeof nonce !== 'string' || !/^\d{13}-[0-9a-f]{24}$/.test(nonce)) return { ok: false, why: 'nonce is not one this desk minted — GET the challenge again.' }
  const [exp, mac] = nonce.split('-')
  const expiresAt = Number(exp)
  if (!(expiresAt > now)) return { ok: false, why: 'this challenge expired (15 minutes) — GET a fresh one.' }
  if (expiresAt - now > SIGNER_CHALLENGE_TTL_MS + 60_000) return { ok: false, why: 'this challenge is not one this desk minted.' }
  const want = challengeMac(t.id, address, expiresAt)
  if (want.length !== mac.length || !timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return { ok: false, why: 'this challenge was minted for another tenant or another address.' }
  return { ok: true }
}
