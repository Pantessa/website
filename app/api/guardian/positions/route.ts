import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { fetchPositions } from '@/lib/hl-guardian-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Live Hyperliquid perp positions for the signed-in wallet — the policy
// form's picker. Public venue data, but still auth-gated so this endpoint
// can't be used to probe arbitrary wallets through our infrastructure.
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  try {
    const positions = await fetchPositions(addr)
    return NextResponse.json({ positions })
  } catch (e) {
    return NextResponse.json({ error: `Hyperliquid read failed: ${(e as Error).message}` }, { status: 502 })
  }
}
