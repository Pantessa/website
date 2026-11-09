import { NextResponse } from 'next/server'
import { CROSS_SITE_REFUSAL, sameOrigin, sameOriginJson } from '@/lib/community/origin'
import { getSessionAddress } from '@/lib/auth'
import { getProviderIdentity, linkIdentityToWallet } from '@/lib/community/identity'
import { mergeSeats } from '@/lib/community/store'
import { providerKey } from '@/lib/community/spec'

// POST /api/me/identity/link — bind the provider identity (the pt_ident
// cookie, signed by Telegram / Discord) to the SIWE wallet. Both proofs must
// arrive in THIS request. The identity's room seats move to the wallet key.
// A link is never moved: an identity already linked to another wallet is 409.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // S7: our own page made this request (the identity cookie can be SameSite=None).
  if (!sameOrigin(req.headers)) return NextResponse.json(CROSS_SITE_REFUSAL, { status: 403 })
  const [wallet, identity] = await Promise.all([getSessionAddress().catch(() => null), getProviderIdentity().catch(() => null)])
  if (!wallet) return NextResponse.json({ error: 'Sign in with your wallet to link it.' }, { status: 401 })
  if (!identity) return NextResponse.json({ error: 'Open this from Telegram or Discord first, so they can prove who you are.' }, { status: 401 })
  const w = wallet.toLowerCase()
  const linked = await linkIdentityToWallet(identity, w)
  if (linked.toLowerCase() !== w) return NextResponse.json({ error: 'That account is already linked to another wallet.' }, { status: 409 })
  const moved = await mergeSeats(providerKey(identity.p, identity.id), w)
  return NextResponse.json({ wallet: w, linked: true, moved }, { headers: { 'cache-control': 'no-store' } })
}
