// ─────────────────────────────────────────────────────────────────────────
//  Agent approvals — the dashboard's per-agent on/off switches.
//
//  Semantics: agents default to OFF — an expense account pays nothing until
//  its owner explicitly approves an agent. Every change re-derives the owner's
//  active SpendGrant allowlist from the explicitly-approved set — the grant's
//  host allowlist is what the chat enforcement actually checks, so a toggle
//  here is real policy, not UI state.
//
//  Until a grant exists, chat is UNENFORCED (and unledgered) — so the grant is
//  minted on the owner's first dashboard visit (see ensureGrant), not lazily
//  on first toggle. From that moment: nothing is payable until approved, and
//  everything is ledgered.
//
//  Hosts of a service = its wired flat endpoint (callable services) plus every
//  host in its mcp_endpoints surface (what the smart planner may call).
// ─────────────────────────────────────────────────────────────────────────

import prisma from '@/lib/db'
import { agentSpentTodayByService, getActiveGrant } from '@/lib/grant-store'
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
  /** Per-agent caps (null = inherit the grant's defaults). */
  perCallUsd: number | null
  perDayUsd: number | null
  /** This agent's settled spend for the UTC day (meters on the Agents tab). */
  spentTodayUsd: number
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
  // Per-service settled spend today, for the Agents tab meters.
  const grant = await getActiveGrant(ownerAddress)
  const spentByName = grant ? await agentSpentTodayByService(grant.id) : {}
  const byServer = new Map(approvals.map((a) => [a.serverId, a]))
  return servers.map((s) => {
    const a = byServer.get(s.id)
    return {
      serverId: s.id,
      slug: s.slug,
      name: s.name,
      category: s.category,
      kind: s.kind,
      callable: s.callable,
      priceUsd: s.priceUsd,
      iconSlug: s.iconSlug,
      color: s.color,
      approved: a?.approved ?? false, // default OFF — approval is explicit
      perCallUsd: a?.perCallUsd ?? null,
      perDayUsd: a?.perDayUsd ?? null,
      spentTodayUsd: spentByName[s.name] ?? 0,
    }
  })
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
 * Re-derive the active grant's `allow` hosts from the EXPLICITLY approved
 * agent set (default off). Creates the expense account if none exists.
 */
export async function syncGrantAllowlist(ownerAddress: string) {
  const approvedRows = await prisma.agentApproval.findMany({
    where: { ownerAddress, approved: true },
    select: { serverId: true },
  })
  const approvedIds = approvedRows.map((a) => a.serverId)

  // Hosts of explicitly approved services: wired endpoint + endpoint surface.
  const approvedServers = approvedIds.length
    ? await prisma.mcpServer.findMany({
        where: { id: { in: approvedIds } },
        select: { endpoint: true, endpoints: { select: { url: true } } },
      })
    : []
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
    // A different allowlist = different signed terms: void any EIP-712
    // signature unless the host set is actually unchanged.
    const sameAllow =
      existing.allow.length === allow.length &&
      [...existing.allow].sort().join() === [...allow].sort().join()
    return prisma.spendGrant.update({
      where: { id: existing.id },
      data: { allow, ...(existing.signature && !sameAllow ? { signature: null } : {}) },
    })
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

/**
 * Mint the expense account on first dashboard visit so ledgering starts
 * immediately (no grant = no receipts = an empty dashboard, which is exactly
 * the "ran a query, saw nothing" trap). Returns the active grant either way.
 */
export async function ensureGrant(ownerAddress: string) {
  const existing = await prisma.spendGrant.findFirst({
    where: { ownerAddress, status: 'active', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  return existing ?? syncGrantAllowlist(ownerAddress)
}

/**
 * Set (or clear, with nulls) one agent's spend caps. Caps are policy terms:
 * any change voids the grant's EIP-712 signature (rule A3 — same as
 * approval toggles), so the owner re-signs the terms they now enforce.
 */
export async function setAgentCaps(
  ownerAddress: string,
  serverId: string,
  caps: { perCallUsd?: number | null; perDayUsd?: number | null },
) {
  await prisma.agentApproval.upsert({
    where: { ownerAddress_serverId: { ownerAddress, serverId } },
    update: caps,
    create: { ownerAddress, serverId, approved: false, ...caps },
  })
  const grant = await ensureGrant(ownerAddress)
  if (grant.signature) {
    await prisma.spendGrant.update({ where: { id: grant.id }, data: { signature: null } })
  }
  return prisma.spendGrant.findUniqueOrThrow({ where: { id: grant.id } })
}

/** Reset one agent to defaults: drop the approval row entirely, resync. */
export async function resetApproval(ownerAddress: string, serverId: string) {
  await prisma.agentApproval.deleteMany({ where: { ownerAddress, serverId } })
  return syncGrantAllowlist(ownerAddress)
}
