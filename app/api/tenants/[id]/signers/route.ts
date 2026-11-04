// POST /api/tenants/:id/signers — register a custody address as a signer,
// with ITS OWN proof of control (TENANT lane, QA B1).
//
// Body { address, signature, chainId?, nonce? } (the console sends no nonce: the
// live challenges for this tenant + address are tried). The signature must be over the
// exact challenge text GET …/signers/challenge minted for this tenant and this
// address (15 minutes, single-use): recovered by personal_sign for an EOA, or
// verified by EIP-1271 through a public client for `chainId` for a smart
// account (a Safe). Only then does the address join `tenant.signers` — the
// list a tenant-signer consent at broker_execute trusts. One `tenant_updated`
// row records the proof (`personal_sign` | `eip1271`) and burns the nonce
// FIRST; a burn that does not land refuses with a 503 (lib/tenant/signers).
// PATCH /api/tenants/:id can REMOVE signers; nothing else ADDS one.
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { publicClientFor } from '@/lib/chains'
import { tenantForAdmin, tenantView } from '@/lib/tenant/store'
import { registerSigner } from '@/lib/tenant/signers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const address = typeof body.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(body.address) ? body.address.toLowerCase() : null
  if (!address) return NextResponse.json({ error: 'address must be the 0x custody address to register.', field: 'address' }, { status: 400 })
  const signature = typeof body.signature === 'string' && /^0x[0-9a-fA-F]+$/.test(body.signature) && body.signature.length >= 132 && body.signature.length <= 20_000 ? (body.signature as `0x${string}`) : null
  if (!signature) return NextResponse.json({ error: 'signature must be a 0x hex signature over the challenge text.', field: 'signature' }, { status: 400 })
  const chainId = body.chainId === undefined || body.chainId === null ? null : typeof body.chainId === 'number' && Number.isInteger(body.chainId) && body.chainId > 0 ? body.chainId : NaN
  if (Number.isNaN(chainId)) return NextResponse.json({ error: 'chainId must be an integer chain id (the chain the smart account lives on).', field: 'chainId' }, { status: 400 })

  const client = chainId != null ? publicClientFor(chainId) : null
  if (chainId != null && !client) return NextResponse.json({ error: `chain ${chainId} is not one this desk reads.`, field: 'chainId' }, { status: 400 })
  // Verify the proof, BURN the nonce (fail closed), then add the signer — lib/tenant/signers.
  const r = await registerSigner({ tenant: gate.tenant, by: gate.addr, address, signature, chainId, nonce: body.nonce, client })
  if (!r.ok) return NextResponse.json({ error: r.error, reason: r.reason, ...(r.field ? { field: r.field } : {}) }, { status: r.status })
  const tenant = (await prisma.tenant.findUnique({ where: { id } })) ?? gate.tenant
  const proof = r.proof
  return NextResponse.json({ tenant: tenantView(tenant), registered: address, proof })
}
