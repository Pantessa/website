// ─────────────────────────────────────────────────────────────────────────
//  Agent approvals — the dashboard's per-agent on/off switches.
//
//  Semantics (flipped 2026-07-17, Nate-directed): agents default to ON —
//  everything is enabled out of the gate and the $200 caps are the
//  protection; owners CURATE DOWN by toggling agents off. An un-curated
//  account carries the `['*']` wildcard allowlist (so newly listed MCPs are
//  payable without a re-sync); the first explicit OFF replaces it with a
//  concrete list: every server the owner has NOT disabled, plus the native
//  venue hosts (always allowed — the user signs those transactions), plus
//  any direct allows (extraAllow). The old opt-in model walled brand-new
//  users at their first ask — even the FREE house inference went
//  NOT_ALLOWED — which is exactly backwards for onboarding.
//
//  Until a grant exists, chat is UNENFORCED (and unledgered) — so the grant is
//  minted on the owner's first dashboard visit (see ensureGrant), not lazily
//  on first toggle. From that moment everything is ledgered.
//
//  Hosts of a service = its wired flat endpoint (callable services) plus every
//  host in its mcp_endpoints surface (what the smart planner may call).
// ─────────────────────────────────────────────────────────────────────────

import prisma from '@/lib/db'
import { hostOf } from '@/lib/spend-grant'
import { NATIVE_VENUE_HOSTS } from '@/lib/venue-hosts'

/** Default expense account minted on first dashboard visit / first toggle.
 *  Caps sized for real swaps, not x402 micro-payments — the $0.05/$5
 *  defaults blocked every first native swap behind a fix-it card. */
const DEFAULT_GRANT = {
  label: 'Agent expense account',
  perCallUsd: 200,
  perDayUsd: 200,
  expiresInDays: 30,
}

export interface ApprovalRow {
  serverId: string
  slug: string
  name: string
  category: string
  kind: string
  callable: boolean
  priceUsd: string | null
  iconSlug: string | null
  color: string | null
  approved: boolean
}

// Scoping: `ownerAddress` here is a SCOPE KEY — a wallet for personal rows,
// or lib/org.ts orgScopeKey(orgId) ("org:<id>") for an org's shared rows.
// `orgId` is passed alongside for org scope so created rows carry the real
// attribution column; the sentinel keeps every existing unique/query intact.

/** All directory agents joined with the owner's approval state (default: on). */
export async function listApprovals(ownerAddress: string): Promise<ApprovalRow[]> {
  const [servers, approvals] = await Promise.all([
    prisma.mcpServer.findMany({
      orderBy: [{ callable: 'desc' }, { category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        kind: true,
        callable: true,
        priceUsd: true,
        iconSlug: true,
        color: true,
      },
    }),
    prisma.agentApproval.findMany({ where: { ownerAddress } }),
  ])
  const byServer = new Map(approvals.map((a) => [a.serverId, a.approved]))
  return servers.map((s) => ({
    serverId: s.id,
    slug: s.slug,
    name: s.name,
    category: s.category,
    kind: s.kind,
    callable: s.callable,
    priceUsd: s.priceUsd,
    iconSlug: s.iconSlug,
    color: s.color,
    approved: byServer.get(s.id) ?? true, // default ON — owners curate DOWN
  }))
}

/** Upsert one approval, then re-sync the owner's grant allowlist. */
export async function setApproval(
  ownerAddress: string,
  serverId: string,
  approved: boolean,
  orgId?: string,
) {
  await prisma.agentApproval.upsert({
    where: { ownerAddress_serverId: { ownerAddress, serverId } },
    update: { approved },
    create: { ownerAddress, serverId, approved, orgId },
  })
  return syncGrantAllowlist(ownerAddress, orgId)
}

/**
 * Re-derive the active grant's `allow` hosts from the approval state
 * (default ON — owners curate down). Creates the expense account if none
 * exists. Un-curated (zero explicit OFFs) → the `['*']` wildcard, so newly
 * listed MCPs stay payable with no re-sync; curated → hosts of every server
 * NOT disabled, plus the native venue hosts (always — the user signs those
 * transactions themselves), plus direct allows (extraAllow).
 */
export async function syncGrantAllowlist(ownerAddress: string, orgId?: string) {
  const disapprovedRows = await prisma.agentApproval.findMany({
    where: { ownerAddress, approved: false },
    select: { serverId: true },
  })
  const disapprovedIds = disapprovedRows.map((a) => a.serverId)

  let derived: string[]
  if (disapprovedIds.length === 0) {
    derived = ['*']
  } else {
    const enabledServers = await prisma.mcpServer.findMany({
      where: { id: { notIn: disapprovedIds } },
      select: { endpoint: true, endpoints: { select: { url: true } } },
    })
    derived = [
      ...new Set([
        ...enabledServers.flatMap((s) => [
          ...(s.endpoint ? [hostOf(s.endpoint)] : []),
          ...s.endpoints.map((e) => hostOf(e.url)),
        ]),
        ...NATIVE_VENUE_HOSTS,
      ]),
    ].filter(Boolean)
  }

  const existing = await prisma.spendGrant.findFirst({
    where: { ownerAddress, status: 'active', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })

  if (existing) {
    // Direct allows (extraAllow — e.g. a host allowed from a blocked-build
    // fix-it) survive every re-derive: union them back in, or a toggle here
    // would silently un-allow what the owner explicitly allowed. The master
    // spendPolicyEnabled switch is NOT touched — it's the owner's call alone
    // (it used to auto-flip with the approval count, which meant one toggle
    // silently armed the whole policy).
    const allow = derived.includes('*') ? derived : [...new Set([...derived, ...existing.extraAllow])]
    // A different allowlist = different signed terms: void any EIP-712
    // signature unless the host set is actually unchanged.
    const sameAllow =
      existing.allow.length === allow.length &&
      [...existing.allow].sort().join() === [...allow].sort().join()
    return prisma.spendGrant.update({
      where: { id: existing.id },
      data: {
        allow,
        ...(existing.signature && !sameAllow ? { signature: null } : {}),
      },
    })
  }
  return prisma.spendGrant.create({
    data: {
      ownerAddress,
      orgId,
      label: orgId ? 'Org expense account' : DEFAULT_GRANT.label,
      allow: derived,
      // ON from the start: with everything allowed, "policy on" means the
      // $200 caps protect the account — turning it OFF is the opt-out.
      spendPolicyEnabled: true,
      perCallUsd: DEFAULT_GRANT.perCallUsd,
      perDayUsd: DEFAULT_GRANT.perDayUsd,
      expiresAt: new Date(Date.now() + DEFAULT_GRANT.expiresInDays * 24 * 60 * 60 * 1000),
    },
  })
}

/**
 * Mint the expense account on first dashboard visit so ledgering starts
 * immediately (no grant = no receipts = an empty dashboard, which is exactly
 * the "ran a query, saw nothing" trap). Returns the active grant either way.
 */
export async function ensureGrant(ownerAddress: string, orgId?: string) {
  const existing = await prisma.spendGrant.findFirst({
    where: { ownerAddress, status: 'active', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  return existing ?? syncGrantAllowlist(ownerAddress, orgId)
}
