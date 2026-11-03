// GET /api/tenants/:id/signers/challenge?address=0x… — the text a custody
// address signs to become one of the tenant's signers (TENANT lane, QA B1).
//
// A tenant admin asks; the ADDRESS signs (personal_sign for an EOA, EIP-1271
// for a smart account — a Safe's owners sign through it) and the admin posts
// the signature to POST /api/tenants/:id/signers. The challenge names this
// tenant and this address, lives 15 minutes, is single-use, and is ASCII only
// (a wallet is asked to sign it).
import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { mintSignerChallenge, tenantForAdmin } from '@/lib/tenant/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const address = (req.nextUrl.searchParams.get('address') ?? '').trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: 'address must be the 0x custody address to register.', field: 'address' }, { status: 400 })
  try {
    const c = mintSignerChallenge(gate.tenant, address.toLowerCase())
    return NextResponse.json({
      address: address.toLowerCase(),
      // `challenge` is the text to sign (the console reads it); `message` is the same text.
      challenge: c.message,
      ...c,
      sign: 'personal_sign (EIP-191) this exact message with the address itself — or, for a smart account (Safe), produce an EIP-1271 signature over it — then POST /api/tenants/' + id + '/signers { address, signature, chainId? } (nonce optional) (chainId = the chain the smart account lives on).',
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'could not mint a challenge' }, { status: 500 })
  }
}
