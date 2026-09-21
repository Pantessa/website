import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { getPlanUsage, recentCreditEntries } from '@/lib/billing'
import { ANSWER_PACK, LISTED_PLANS, TASTE } from '@/lib/plans'
import { byokEnabled, getInferenceKeyMeta, BYOK_SYNTH_MODELS } from '@/lib/byok'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The signed-in wallet's (or Bearer key owner's) plan + this month's YEET
// credit usage — the /dashboard/plan page and SDK pre-flights read this.
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const [usage, ledger, aiKey] = await Promise.all([getPlanUsage(addr), recentCreditEntries(addr), getInferenceKeyMeta(addr)])
  return NextResponse.json({
    usage,
    ledger,
    // Only the plans on sale — a retired plan is honored, never offered.
    plans: LISTED_PLANS,
    pack: ANSWER_PACK,
    taste: TASTE,
    // Bring your own key: never the key, only what Settings shows.
    aiKey: { enabled: byokEnabled(), key: aiKey, models: BYOK_SYNTH_MODELS },
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
  })
}
