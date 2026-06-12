import { NextRequest, NextResponse } from 'next/server'
import { getBearerKey } from '@/lib/api-key'
import { agentSpentTodayUsd, getActiveGrant, spentTodayUsd, spentTotalUsd } from '@/lib/grant-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The connected agent's standing orders, fetched with its own key. Bearer-only
// by design — this is the SDK's pre-flight ("may I still pay, and how much?"),
// not a browser surface. The agent pays from its own wallet, so Yeetful can't
// hard-block at the rails; the SDK fetches this and refuses locally, the same
// trust model as the grant itself. Hard enforcement arrives with Coinbase
// Spend Permissions, where the on-chain allowance is the cap.
export async function GET(req: NextRequest) {
  const key = await getBearerKey(req)
  if (!key) return NextResponse.json({ error: 'Bearer yf_… key required.' }, { status: 401 })

  const spentTodayByAgent = await agentSpentTodayUsd(key.id)
  const grant = await getActiveGrant(key.ownerAddress)

  return NextResponse.json({
    agent: {
      keyId: key.id,
      label: key.label,
      perDayUsd: key.perDayUsd,
      spentTodayUsd: spentTodayByAgent,
      remainingTodayUsd:
        key.perDayUsd == null ? null : Math.max(0, key.perDayUsd - spentTodayByAgent),
      overBudget: key.perDayUsd != null && spentTodayByAgent >= key.perDayUsd,
    },
    grant: grant
      ? {
          id: grant.id,
          label: grant.label,
          allow: grant.allow,
          perCallUsd: grant.perCallUsd,
          perDayUsd: grant.perDayUsd,
          totalUsd: grant.totalUsd,
          spentTodayUsd: await spentTodayUsd(grant.id),
          spentTotalUsd: await spentTotalUsd(grant.id),
          expiresAt: grant.expiresAt,
          signed: !!grant.signature,
        }
      : null,
  })
}
