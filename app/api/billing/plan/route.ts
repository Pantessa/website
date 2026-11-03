import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { getPlanUsage, recentCreditEntries } from '@/lib/billing'
import { ANSWER_PACK, DESK_PLANS, LISTED_PLANS, PLAN_BY_ID, TASTE, deskFeatureLines, planFamily } from '@/lib/plans'
import { entitlementsFor, entitlementsJson, isDeskPlanId } from '@/lib/tenant/entitlements'
import { byokEnabled, getInferenceKeyMeta, BYOK_SYNTH_MODELS } from '@/lib/byok'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The signed-in wallet's (or Bearer key owner's) plan + this month's YEET
// credit usage — the /dashboard/plan page and SDK pre-flights read this.
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const [usage, ledger, aiKey] = await Promise.all([getPlanUsage(addr), recentCreditEntries(addr), getInferenceKeyMeta(addr)])
  const plan = PLAN_BY_ID[usage.plan]
  return NextResponse.json({
    usage,
    ledger,
    // Only the plans on sale — a retired plan is honored, never offered.
    // `plans` is the answers grid (Free, Plus); `deskPlans` the desk's.
    plans: LISTED_PLANS,
    deskPlans: DESK_PLANS,
    pack: ANSWER_PACK,
    taste: TASTE,
    // What this wallet's plan lets a tenant do (lib/tenant/entitlements).
    // A cap of null = unlimited (JSON has no Infinity). An answers plan
    // (Free, Plus) is the free desk tier: one sandbox tenant.
    desk: {
      family: planFamily(plan),
      plan: isDeskPlanId(usage.plan) ? usage.plan : 'free',
      entitlements: entitlementsJson(entitlementsFor(usage.plan)),
      features: deskFeatureLines(isDeskPlanId(usage.plan) ? usage.plan : 'free'),
    },
    // Bring your own key: never the key, only what Settings shows.
    aiKey: { enabled: byokEnabled(), key: aiKey, models: BYOK_SYNTH_MODELS },
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
  })
}
