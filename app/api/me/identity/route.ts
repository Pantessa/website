import { NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { getActor } from '@/lib/community/identity'
import { communitiesOf } from '@/lib/community/store'

// GET /api/me/identity — who the server says you are in the community layer:
// the SIWE wallet, the provider identity (Telegram / Discord, name +
// username only, never the id), the member key, and the rooms you sit in.
// A stranger gets all nulls and [].
//
// QA-SECURITY-2 T7: the FULL wallet (and its member key) is returned only to
// a wallet session. A caller holding only the provider cookie, whose identity
// is linked to a wallet, reads the short form (0x1234…abcd) and no key.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const shortWallet = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`

export async function GET() {
  const [actor, session] = await Promise.all([getActor().catch(() => null), getSessionAddress().catch(() => null)])
  const communities = actor ? await communitiesOf(actor.key).catch(() => []) : []
  const fullWallet = !!session && !!actor?.wallet
  return NextResponse.json(
    {
      wallet: actor?.wallet ? (fullWallet ? actor.wallet : shortWallet(actor.wallet)) : null,
      provider: actor?.provider ? { p: actor.provider.p, name: actor.provider.name, username: actor.provider.username } : null,
      key: actor ? (actor.wallet && !fullWallet ? null : actor.key) : null,
      communities,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
