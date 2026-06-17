import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { getSessionAddress } from '@/lib/auth'
import { requireRole, type OrgRole } from '@/lib/org'
import { spendPermissionSummary } from '@/lib/spend-permission'
import { isCdpConfigured, createGrantSpendPermission } from '@/lib/cdp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** Personal grants: the owner via SIWE or Bearer. Org grants: SIWE members at
 *  `minRole` (a Bearer key never writes its org's policy). Mirrors the gate in
 *  app/api/grants/[id]/route.ts. */
async function canAccessGrant(
  grant: { ownerAddress: string; orgId: string | null },
  addr: string,
  minRole: OrgRole,
): Promise<boolean> {
  if (!grant.orgId) return grant.ownerAddress === addr
  const session = await getSessionAddress()
  if (!session) return false
  return (await requireRole(grant.orgId, session, minRole)).ok
}

// Read the on-chain backing status for a grant + the exact terms its per-day cap
// maps to. Returns `backed:false` with the would-be terms when no permission
// exists yet. Auth: SIWE session or Bearer (members on org grants).
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const grant = await prisma.spendGrant.findUnique({ where: { id } })
  if (!grant || !(await canAccessGrant(grant, addr, 'member'))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  return NextResponse.json({
    backed: !!grant.spendPermissionId,
    spendPermissionId: grant.spendPermissionId,
    network: grant.spendPermissionNetwork,
    // What the per-day cap maps to on-chain — the number that would move.
    terms: spendPermissionSummary(grant),
    cdpConfigured: isCdpConfigured(),
  })
}

// Back this grant on-chain with a Coinbase Spend Permission. SIWE admin only
// (a Bearer key never provisions its own on-chain cap). Creates the permission
// via CDP (lib/cdp.ts) mirroring the grant's per-day cap, then persists
// spendPermissionId + network on the grant. Returns 503 with the exact missing
// steps when CDP isn't provisioned. Defaults to Base Sepolia until a mainnet
// Smart Account is funded (CDP_SPEND_NETWORK=base).
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const grant = await prisma.spendGrant.findUnique({ where: { id } })
  if (!grant || !(await canAccessGrant(grant, addr, 'admin'))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  if (!isCdpConfigured()) {
    return NextResponse.json(
      {
        error: 'On-chain backing is not yet provisioned.',
        need: [
          'Generate a Wallet Secret in the CDP Portal and set CDP_WALLET_SECRET (the API key id/secret alone cannot sign).',
          'Create + fund a CDP Smart Account with USDC on Base (or use Base Sepolia + the faucet to test).',
          'Enable the CDP paymaster for gas.',
        ],
      },
      { status: 503 },
    )
  }

  // Already backed? Idempotent — return the existing permission.
  if (grant.spendPermissionId) {
    return NextResponse.json({
      backed: true,
      spendPermissionId: grant.spendPermissionId,
      network: grant.spendPermissionNetwork,
      alreadyBacked: true,
    })
  }

  try {
    const created = await createGrantSpendPermission({
      perDayUsd: grant.perDayUsd,
      createdAt: grant.createdAt,
      expiresAt: grant.expiresAt,
    })
    const updated = await prisma.spendGrant.update({
      where: { id },
      data: { spendPermissionId: created.id, spendPermissionNetwork: created.network },
      select: { spendPermissionId: true, spendPermissionNetwork: true },
    })
    return NextResponse.json({
      backed: true,
      spendPermissionId: updated.spendPermissionId,
      network: updated.spendPermissionNetwork,
      account: created.account,
      spender: created.spender,
      allowanceAtomic: created.allowanceAtomic,
    })
  } catch (e) {
    // Surface the CDP error so the dashboard shows something actionable
    // (e.g. unfunded account / paymaster not enabled) rather than a bare 500.
    return NextResponse.json(
      { error: 'CDP create failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
}
