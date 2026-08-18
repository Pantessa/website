import { NextRequest, NextResponse } from 'next/server'
import { recoverTypedDataAddress } from 'viem'
import prisma from '@/lib/db'
import { approveAgentArtifacts } from '@/lib/hl-guardian'
import { activateDelegation, createDelegation, getActiveDelegation, guardianIsTestnet } from '@/lib/hl-guardian-store'
import { bumpAndCheckBrokerCall, clientIpFrom } from '@/lib/turn-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The connect-only "enable trading" door for Hyperliquid — the execution-
// surface twin of /api/guardian/delegation (which is SIWE-gated for the
// account surface). Rule 6: /i, /chat, /embed run on wallet CONNECT alone
// and the signature is the ownership proof. Here that proof is the
// approveAgent typed-data signature itself: PATCH re-derives the exact
// payload from the stored row and RECOVERS the signer — a signature from
// any other wallet activates nothing.
//
// GET   ?wallet=0x… → { active, expiresAt?, agentAddress? }  (public read by
//       address, like /api/inbox — the client picks its sign path with it)
// POST  { from, signatureChainId } → an active row → { active: true };
//       else mint a pending agent → { id, agentAddress, typedData }
// PATCH { id, from, signature } → recover-verify, then submit approveAgent
//       to the venue; on ok the delegation is active for BOTH chat execution
//       and the guardian sweep (one Pantessa agent per wallet).

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet') ?? ''
  if (!ADDR_RE.test(wallet)) return NextResponse.json({ error: 'wallet (0x…) is required.' }, { status: 400 })
  const row = await getActiveDelegation(wallet, guardianIsTestnet())
  return NextResponse.json(
    row ? { active: true, expiresAt: row.expiresAt.toISOString(), agentAddress: row.agentAddress } : { active: false },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { from?: string; signatureChainId?: number }
  const from = typeof body.from === 'string' ? body.from : ''
  const chainId = Number(body.signatureChainId)
  if (!ADDR_RE.test(from)) return NextResponse.json({ error: 'from (0x…) is required.' }, { status: 400 })
  if (!Number.isInteger(chainId) || chainId <= 0) {
    return NextResponse.json({ error: 'signatureChainId (the connected wallet chain) is required.' }, { status: 400 })
  }
  // Unauthenticated row mint → the same hourly per-IP fence the broker desk
  // wears. Loopback exempt (harness / local dev).
  if (await bumpAndCheckBrokerCall(clientIpFrom(req.headers))) {
    return NextResponse.json({ error: 'Too many requests from this network — try again within the hour.' }, { status: 429 })
  }
  const live = await getActiveDelegation(from, guardianIsTestnet())
  if (live) return NextResponse.json({ active: true, expiresAt: live.expiresAt.toISOString(), agentAddress: live.agentAddress })
  try {
    const created = await createDelegation(from, chainId)
    return NextResponse.json({ active: false, ...created })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { id?: string; from?: string; signature?: string }
  const from = typeof body.from === 'string' ? body.from : ''
  if (!body.id || !ADDR_RE.test(from) || typeof body.signature !== 'string') {
    return NextResponse.json({ error: 'id, from and signature are required.' }, { status: 400 })
  }
  const row = await prisma.hlGuardianDelegation.findUnique({ where: { id: body.id } })
  if (!row || row.wallet !== from.toLowerCase()) return NextResponse.json({ error: 'delegation not found' }, { status: 404 })
  if (row.status !== 'pending') return NextResponse.json({ error: `delegation is ${row.status}` }, { status: 409 })
  // The signature IS the ownership proof: it must recover to the wallet the
  // row was minted for, over EXACTLY the payload we offered.
  const { typedData } = approveAgentArtifacts({
    agentAddress: row.agentAddress,
    nonce: Number(row.nonce),
    validUntil: row.expiresAt.getTime(),
    signatureChainId: row.sigChainId,
    isTestnet: row.hlChain === 'Testnet',
  })
  let signer: string
  try {
    signer = await recoverTypedDataAddress({
      domain: typedData.domain as Parameters<typeof recoverTypedDataAddress>[0]['domain'],
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: { ...typedData.message, nonce: BigInt(Number(row.nonce)) },
      signature: body.signature as `0x${string}`,
    })
  } catch {
    return NextResponse.json({ error: 'Signature does not verify against this approval.' }, { status: 403 })
  }
  if (signer.toLowerCase() !== row.wallet) {
    return NextResponse.json({ error: 'Signature recovers to a different wallet than `from`.' }, { status: 403 })
  }
  try {
    const result = await activateDelegation(row.id, row.wallet, body.signature)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
    return NextResponse.json({ ok: true, active: true, expiresAt: row.expiresAt.toISOString(), agentAddress: row.agentAddress })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
