import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { getSessionAddress } from '@/lib/auth'
import { requireRole, type OrgRole } from '@/lib/org'
import { spendPermissionSummary } from '@/lib/spend-permission'

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

/** Is the CDP server-wallet flow provisioned? Creating a Spend Permission needs
 *  the wallet secret (POST/sign auth) on top of the API key — see lib/cdp.ts
 *  (slice 2). The API key id/secret alone are NOT enough. */
function isCdpConfigured(): boolean {
  return Boolean(
    process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET && process.env.CDP_WALLET_SECRET,
  )
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
// (a Bearer key never provisions its own on-chain cap).
//
// Slice 1: the live create (CdpClient.createSpendPermission on a funded Smart
// Account) is owner-gated — it needs CDP_WALLET_SECRET + a funded CDP Smart
// Account + the paymaster. Until those are set this returns 503 with the exact
// missing steps, so the dashboard control is wired and honest. Slice 2 fills in
// lib/cdp.ts and writes spendPermissionId/Network back onto the grant.
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

  // Slice 2 wires the live create here (lib/cdp.ts):
  //   createSpendPermission(grantToSpendPermission(grant, { account, spender }))
  //   → persist spendPermissionId + spendPermissionNetwork on the grant.
  return NextResponse.json(
    { error: 'Live Spend Permission create lands in the next slice.' },
    { status: 501 },
  )
}
