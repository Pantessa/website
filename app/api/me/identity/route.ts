import { NextResponse } from 'next/server'
import { getActor } from '@/lib/community/identity'
import { communitiesOf } from '@/lib/community/store'

// GET /api/me/identity — who the server says you are in the community layer:
// the SIWE wallet, the provider identity (Telegram / Discord, name +
// username only, never the id), the member key, and the rooms you sit in.
// A stranger gets all nulls and [].

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const actor = await getActor().catch(() => null)
  const communities = actor ? await communitiesOf(actor.key).catch(() => []) : []
  return NextResponse.json(
    {
      wallet: actor?.wallet ?? null,
      provider: actor?.provider ? { p: actor.provider.p, name: actor.provider.name, username: actor.provider.username } : null,
      key: actor?.key ?? null,
      communities,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
