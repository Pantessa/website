import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { activateDelegation, createDelegation, revokeDelegation } from '@/lib/hl-guardian-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Delegation lifecycle. SIWE-session only (never Bearer): approving an agent
// on the user's Hyperliquid ACCOUNT is a human decision, made in a browser
// where the wallet that must sign is present.
//
// POST  { signatureChainId } → mint a fresh agent keypair, return { id,
//        agentAddress, typedData } for the wallet to sign. The typed data IS
//        the consent artifact — the signature approves exactly this agent.
// PATCH { id, signature }    → submit the user-signed approveAgent action to
//        the venue; on success the delegation is active.
// DELETE                     → stand the guardian down (local revoke; the
//        venue-side approval also dies at its valid_until).

export async function POST(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { signatureChainId?: number }
  const chainId = Number(body.signatureChainId)
  if (!Number.isInteger(chainId) || chainId <= 0) {
    return NextResponse.json({ error: 'signatureChainId (the connected wallet chain) is required.' }, { status: 400 })
  }
  try {
    const created = await createDelegation(addr, chainId)
    return NextResponse.json(created)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { id?: string; signature?: string }
  if (!body.id || !body.signature) {
    return NextResponse.json({ error: 'id and signature are required.' }, { status: 400 })
  }
  try {
    const result = await activateDelegation(body.id, addr, body.signature)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  await revokeDelegation(addr)
  return NextResponse.json({ ok: true })
}
