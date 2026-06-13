import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getBearerKey } from '@/lib/api-key'
import { getSessionAddress } from '@/lib/auth'
import { hostOf } from '@/lib/spend-grant'
import { agentSpentTodayUsd, orgSpentTodayUsd, recordLedger } from '@/lib/grant-store'
import { requireRole } from '@/lib/org'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const MAX_AMOUNT_USD = 1_000 // a synced receipt is a record, not a payment — but cap nonsense

// Append a receipt to a grant's ledger. This is the hosted-ledger sync target
// for the `yeetful` SDK's onReceipt hook: agents enforcing a grant locally
// report each authorization decision here so the dashboard sees their spend.
// Auth: SIWE session cookie OR `Authorization: Bearer yf_…`. Owner only.
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  // Bearer receipts are attributed to the key — a key IS a connected agent,
  // and per-agent spend on the Agents tab comes from this attribution.
  const session = await getSessionAddress()
  const key = session ? null : await getBearerKey(req)
  const addr = session ?? key?.ownerAddress ?? null
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const grant = await prisma.spendGrant.findUnique({ where: { id } })
  if (!grant) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (grant.orgId) {
    // Org grant: synced by the org's own keys, or any member via SIWE.
    const allowed = key
      ? key.orgId === grant.orgId
      : session
        ? (await requireRole(grant.orgId, session, 'member')).ok
        : false
    if (!allowed) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  } else if (grant.ownerAddress !== addr || key?.orgId) {
    // Personal grant: owner only — and an ORG key never syncs to its minter's
    // personal account (it's the org's credential; attribution would lie).
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)

  // Host: accept a bare hostname or a full URL (the SDK reports the paid URL).
  const rawHost = typeof body.host === 'string' ? body.host.trim() : ''
  const host = rawHost.includes('://') ? hostOf(rawHost) : rawHost.toLowerCase()
  if (!host) return NextResponse.json({ error: 'host is required.' }, { status: 400 })

  const amountUsd = Number(body.amountUsd)
  if (!(amountUsd >= 0) || amountUsd > MAX_AMOUNT_USD) {
    return NextResponse.json({ error: `amountUsd must be 0–${MAX_AMOUNT_USD}.` }, { status: 400 })
  }

  const ok = body.ok !== false // default true — most synced receipts are settlements

  const entry = await recordLedger({
    grantId: grant.id,
    host,
    serviceName: typeof body.serviceName === 'string' ? body.serviceName.slice(0, 120) : undefined,
    amountUsd,
    ok,
    txHash: typeof body.txHash === 'string' ? body.txHash.slice(0, 120) : undefined,
    note: typeof body.note === 'string' ? body.note.slice(0, 200) : 'sdk-sync',
    apiKeyId: key?.id,
    orgId: grant.orgId ?? undefined,
  })

  // Tell the agent where it stands against its daily budget on every sync.
  // Advisory by design: the agent pays from its own wallet, so the SDK is the
  // enforcement point — overBudget is its signal to stop paying. Org keys get
  // BOTH levels: their own cap and the org's daily cap (over either = stop).
  if (key) {
    const spentTodayUsd = await agentSpentTodayUsd(key.id)
    let org = null
    if (key.orgId) {
      const [orgRow, orgSpent] = await Promise.all([
        prisma.organization.findUnique({ where: { id: key.orgId }, select: { perDayUsd: true } }),
        orgSpentTodayUsd(key.orgId),
      ])
      org = {
        id: key.orgId,
        perDayUsd: orgRow?.perDayUsd ?? null,
        spentTodayUsd: orgSpent,
        overBudget: orgRow?.perDayUsd != null && orgSpent >= orgRow.perDayUsd,
      }
    }
    return NextResponse.json(
      {
        ...entry,
        agent: {
          perDayUsd: key.perDayUsd,
          spentTodayUsd,
          overBudget: key.perDayUsd != null && spentTodayUsd >= key.perDayUsd,
        },
        org,
      },
      { status: 201 },
    )
  }
  return NextResponse.json(entry, { status: 201 })
}
