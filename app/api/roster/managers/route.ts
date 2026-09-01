import { NextResponse } from 'next/server'
import { rosterEnabled } from '@/lib/roster-policy'
import { listManagers } from '@/lib/roster-managers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// THE STOREFRONT list — hireable managers, house first. Fail-closed with
// the rest of the roster surface: flag off = dark (the feature does not
// exist yet; there is no read-only exception here because the storefront
// IS the advertisement).
export async function GET() {
  if (!rosterEnabled()) {
    return NextResponse.json({ error: 'The Pantessa roster is not open yet.' }, { status: 503 })
  }
  const managers = await listManagers().catch(() => [])
  return NextResponse.json({ managers })
}
