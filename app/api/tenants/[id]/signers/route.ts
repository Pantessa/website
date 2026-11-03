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
// row records the proof (`personal_sign` | `eip1271`) and burns the nonce.
// PATCH /api/tenants/:id can REMOVE signers; nothing else ADDS one.
import { NextRequest, NextResponse } from 'next/server'
import { recoverMessageAddress } from 'viem'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { publicClientFor } from '@/lib/chains'
import { liveSignerNonces, lowerList, signerChallengeText, signerNonceOk, tenantForAdmin, tenantView } from '@/lib/tenant/store'
import { blot } from '@/lib/tenant/gate'

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

  // The challenge(s) this signature can be over: the one named by `nonce`, or
  // — the console's shape, { address, signature, chainId? } — every challenge
  // for this tenant + address that can still be live (at most three).
  let nonces: string[]
  if (body.nonce !== undefined && body.nonce !== null) {
    const nonceOk = signerNonceOk(gate.tenant, address, body.nonce)
    if (!nonceOk.ok) return NextResponse.json({ error: nonceOk.why, field: 'nonce', reason: 'SIGNER_DENIED' }, { status: 400 })
    nonces = [body.nonce as string]
  } else {
    nonces = liveSignerNonces(gate.tenant, address)
  }

  let proof: 'personal_sign' | 'eip1271' | null = null
  let nonce = ''
  const client = chainId != null ? publicClientFor(chainId) : null
  if (chainId != null && !client) return NextResponse.json({ error: `chain ${chainId} is not one this desk reads.`, field: 'chainId' }, { status: 400 })
  const hasCode = client ? await client.getCode({ address: address as `0x${string}` }).then((c) => !!c && c !== '0x').catch(() => false) : false
  for (const n of nonces) {
    const message = signerChallengeText(gate.tenant.slug, address, n)
    try {
      const recovered = await recoverMessageAddress({ message, signature })
      if (recovered.toLowerCase() === address) proof = 'personal_sign'
    } catch {
      /* not a plain EOA signature — try the account's own validator below */
    }
    if (!proof && client && hasCode) {
      try {
        if (await client.verifyMessage({ address: address as `0x${string}`, message, signature })) proof = 'eip1271'
      } catch {
        proof = null
      }
    }
    if (proof) {
      nonce = n
      break
    }
  }
  if (!proof) {
    return NextResponse.json(
      { error: `the signature does not prove control of ${address}: it must be that address's own personal_sign over a live challenge (GET …/signers/challenge, 15 minutes), or an EIP-1271 signature its contract accepts on chainId.`, reason: 'SIGNER_DENIED' },
      { status: 403 },
    )
  }
  const burned = await prisma.blotterRow.findFirst({ where: { tenantId: id, kind: 'tenant_updated', payload: { path: ['nonce'], equals: nonce } }, select: { id: true } })
  if (burned) return NextResponse.json({ error: 'this challenge was already used — GET a fresh one.', field: 'nonce', reason: 'SIGNER_DENIED' }, { status: 409 })

  const before = lowerList(gate.tenant.signers)
  const after = before.includes(address) ? before : [...before, address]
  const tenant = before.includes(address) ? gate.tenant : await prisma.tenant.update({ where: { id }, data: { signers: after } })
  await blot({ tenantId: id }, 'tenant_updated', { by: gate.addr, changes: { signers: { from: before, to: after } }, address, proof, nonce, ...(chainId != null ? { chainId } : {}) })
  return NextResponse.json({ tenant: tenantView(tenant), registered: address, proof })
}
