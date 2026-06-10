import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { publicClient } from '@/lib/auth'
import { getAuthAddress } from '@/lib/api-key'
import { grantTypedData, grantTypedDataJson } from '@/lib/grant-typed-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// The exact EIP-712 payload the owner wallet should sign for this grant —
// built from the STORED row, so what gets signed is what gets enforced.
// Auth: SIWE session cookie OR `Authorization: Bearer yf_…`. Owner only.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const grant = await prisma.spendGrant.findUnique({ where: { id } })
  if (!grant || grant.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  return NextResponse.json({ typedData: grantTypedDataJson(grant), signed: !!grant.signature })
}

// Attach the owner's EIP-712 signature over the grant terms. Verification uses
// the public client so EOAs and smart wallets (ERC-1271/6492) both work — the
// same trust path as SIWE sign-in. Owner only.
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const grant = await prisma.spendGrant.findUnique({ where: { id } })
  if (!grant || grant.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const signature = typeof body.signature === 'string' ? body.signature.trim() : ''
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) {
    return NextResponse.json({ error: 'signature (0x…) is required.' }, { status: 400 })
  }

  const valid = await publicClient
    .verifyTypedData({
      address: grant.ownerAddress as `0x${string}`,
      ...grantTypedData(grant),
      signature: signature as `0x${string}`,
    })
    .catch(() => false)
  if (!valid) {
    return NextResponse.json(
      { error: 'Signature does not recover the grant owner.' },
      { status: 400 },
    )
  }

  const updated = await prisma.spendGrant.update({ where: { id }, data: { signature } })
  return NextResponse.json({ ...updated, signed: true })
}
