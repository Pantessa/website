import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { getShortlist, setShortlist, MAX_SHORTLIST } from '@/lib/shortlist'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The signed-in wallet's saved MCP shortlist (ordered McpServer ids; [] if none).
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  return NextResponse.json({ serviceIds: await getShortlist(addr) })
}

// Replace the wallet's shortlist. Body: { serviceIds: string[] } (0–3 ids).
// Empty clears it. Unknown ids are dropped; >3 valid ids is a 400.
export async function PUT(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  if (!Array.isArray(body.serviceIds)) {
    return NextResponse.json({ error: 'serviceIds must be an array.' }, { status: 400 })
  }
  const ids = body.serviceIds.filter((x: unknown): x is string => typeof x === 'string')

  try {
    const serviceIds = await setShortlist(addr, ids)
    return NextResponse.json({ serviceIds })
  } catch (err) {
    if (err instanceof Error && err.message === 'TOO_MANY') {
      return NextResponse.json(
        { error: `A shortlist can hold at most ${MAX_SHORTLIST} services.` },
        { status: 400 },
      )
    }
    throw err
  }
}
