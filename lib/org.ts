// Organizations — membership, the role matrix, and scope resolution. Every
// org route MUST resolve permissions here (F2): never trust a client orgId
// without a membership lookup, and org management is SIWE-only — a Bearer
// key can't manage the org it belongs to (same split as budgets: an agent
// can't raise its own allowance).
//
// Role matrix (owner > admin > member):
//   read org + members ............ member+
//   rename org ..................... admin+
//   add member (as 'member') ....... admin+   (owner may add as 'admin')
//   remove member .................. admin+   (admins can't remove admins;
//                                              the owner can't be removed;
//                                              anyone may remove themself = leave)
//   change roles / transfer owner .. owner only
//   delete org ..................... owner only
//   (item 2+) manage org keys ...... admin+
//   (item 4)  set org daily cap .... admin+

import prisma from '@/lib/db'

export type OrgRole = 'owner' | 'admin' | 'member'

const RANK: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1 }

export const ORG_ROLES: readonly OrgRole[] = ['owner', 'admin', 'member'] as const

export function isOrgRole(v: unknown): v is OrgRole {
  return typeof v === 'string' && (ORG_ROLES as readonly string[]).includes(v)
}

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return RANK[role] >= RANK[min]
}

export function isWalletAddress(v: unknown): v is string {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)
}

export interface Membership {
  orgId: string
  address: string
  role: OrgRole
}

/** The caller's membership row in an org, or null. Addresses are lowercased. */
export async function getMembership(orgId: string, address: string): Promise<Membership | null> {
  const row = await prisma.orgMember.findUnique({
    where: { orgId_address: { orgId, address: address.toLowerCase() } },
    select: { orgId: true, address: true, role: true },
  })
  return row ? { orgId: row.orgId, address: row.address, role: row.role as OrgRole } : null
}

export type RoleCheck =
  | { ok: true; role: OrgRole }
  /** 404 = not a member (org existence is not leaked, matching the grants
   *  convention); 403 = member, but the role is insufficient. */
  | { ok: false; status: 404 | 403 }

/** Membership + minimum-role gate for a route. */
export async function requireRole(orgId: string, address: string, min: OrgRole): Promise<RoleCheck> {
  const m = await getMembership(orgId, address)
  if (!m) return { ok: false, status: 404 }
  if (!roleAtLeast(m.role, min)) return { ok: false, status: 403 }
  return { ok: true, role: m.role }
}

/** A request's data scope: the caller's personal account, or an org they
 *  belong to. Later items thread this through keys/grants/approvals reads
 *  so `?org=<id>` flips the dashboard between scopes (F3: active-org is
 *  client state; membership is re-checked here on every call). */
export type Scope =
  | { kind: 'personal'; address: string }
  | { kind: 'org'; orgId: string; address: string; role: OrgRole }

/** Resolve the caller's scope. No orgId → personal. With orgId → the org,
 *  or null when the caller isn't a member (routes answer 404). */
export async function resolveScope(address: string, orgId?: string | null): Promise<Scope | null> {
  const addr = address.toLowerCase()
  if (!orgId) return { kind: 'personal', address: addr }
  const m = await getMembership(orgId, addr)
  return m ? { kind: 'org', orgId, address: addr, role: m.role } : null
}

/** The ownerAddress value org-scoped grant/approval rows carry: a sentinel,
 *  not a wallet. This keeps every existing (ownerAddress, …) unique and query
 *  working with ZERO constraint surgery — e.g. a member's personal approval
 *  of a server never collides with their org's approval of the same server.
 *  The real attribution lives in the row's orgId column; `org:` can never
 *  collide with a wallet (those are 0x-hex). */
export function orgScopeKey(orgId: string): string {
  return `org:${orgId}`
}

/** Derive a unique org slug from the name (blog-style, with a suffix on
 *  collision so creates never 409 on a popular name). */
export async function uniqueOrgSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'org'
  for (let i = 0; ; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 7)}`
    if (!(await prisma.organization.findUnique({ where: { slug }, select: { id: true } }))) return slug
  }
}
