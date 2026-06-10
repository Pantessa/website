// ─────────────────────────────────────────────────────────────────────────
//  Agent approvals — the dashboard's per-agent on/off switches.
//
//  Semantics: agents default to APPROVED (the expense account starts
//  permissive so chat works out of the box); a toggle to off is an explicit
//  veto. Every change re-derives the owner's active SpendGrant allowlist from
//  the approved set — the grant's host allowlist is what the chat enforcement
//  actually checks, so a toggle here is real policy, not UI state.
//
//  Hosts of a service = its wired flat endpoint (callable services) plus every
//  host in its mcp_endpoints surface (what the smart planner may call).
// ─────────────────────────────────────────────────────────────────────────

import prisma from '@/lib/db'
import { hostOf } from '@/lib/spend-grant'

/** Default expense account minted on first toggle, when none exists. */
const DEFAULT_GRANT = {
  label: 'Agent expense account',
  perCallUsd: 0.05,
  perDayUsd: 5,
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
    approved: byServer.get(s.id) ?? true,
  }))
}

/** Upsert one approval, then re-sync the owner's grant allowlist. */
export async function setApproval(ownerAddress: string, serverId: string, approved: boolean) {
  await prisma.agentApproval.upsert({
    where: { ownerAddress_serverId: { ownerAddress, serverId } },
    update: { approved },
    create: { ownerAddress, serverId, approved },
  })
  return syncGrantAllowlist(ownerAddress)
}

/**
 * Re-derive the active grant's `allow` hosts from the approved agent set.
 * Creates the default expense account if the owner doesn't have one yet.
 */
export async function syncGrantAllowlist(ownerAddress: string) {
  const vetoed = await prisma.agentApproval.findMany({
    where: { ownerAddress, approved: false },
    select: { serverId: true },
  })
  const vetoedIds = vetoed.map((v) => v.serverId)

  // Hosts of every NON-vetoed service: wired endpoint + endpoint-surface hosts.
  const approvedServers = await prisma.mcpServer.findMany({
    where: { id: { notIn: vetoedIds } },
    select: { endpoint: true, endpoints: { select: { url: true } } },
  })
  const allow = [
    ...new Set(
      approvedServers.flatMap((s) => [
        ...(s.endpoint ? [hostOf(s.endpoint)] : []),
        ...s.endpoints.map((e) => hostOf(e.url)),
      ]),
    ),
  ].filter(Boolean)

  const existing = await prisma.spendGrant.findFirst({
    where: { ownerAddress, status: 'active', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })

  if (existing) {
    return prisma.spendGrant.update({ where: { id: existing.id }, data: { allow } })
  }
  return prisma.spendGrant.create({
    data: {
      ownerAddress,
      label: DEFAULT_GRANT.label,
      allow,
      perCallUsd: DEFAULT_GRANT.perCallUsd,
      perDayUsd: DEFAULT_GRANT.perDayUsd,
      expiresAt: new Date(Date.now() + DEFAULT_GRANT.expiresInDays * 24 * 60 * 60 * 1000),
    },
  })
}
