import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { isAdminAddress, OWNER_WALLETS } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OWNERS_LC = new Set<string>(OWNER_WALLETS)

/**
 * Company-wide adoption overview — the CEO view. Admin-gated (the two owner
 * wallets ∪ ADMIN_WALLETS). Everything is aggregate SQL over the existing
 * tables; there is no `users` table, so a "user" = a distinct owner_address
 * seen across chats / spend_grants / api_keys / agent_approvals / org_members,
 * and first-seen = MIN(created_at) for that address.
 *
 * `?excludeOwners=1` drops the owner/admin wallets from every wallet metric so
 * early self-testing noise can be filtered out of the real adoption picture.
 * Revenue stays company-wide (org spend included).
 */

// The "user universe": one row per (address, created_at) across every table
// that records an owner action. Reused as a CTE in several queries below.
const ADDRS = Prisma.sql`
  SELECT lower(owner_address) AS a, created_at FROM chats WHERE owner_address IS NOT NULL
  UNION ALL SELECT lower(owner_address), created_at FROM spend_grants WHERE owner_address NOT LIKE 'org:%'
  UNION ALL SELECT lower(owner_address), created_at FROM api_keys
  UNION ALL SELECT lower(owner_address), created_at FROM agent_approvals
  UNION ALL SELECT lower(address), created_at FROM org_members
`

export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!isAdminAddress(addr)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  // Always a non-empty array so `<> ALL(...)` types cleanly. The '' sentinel
  // never matches a real address, so "exclude nothing" is the default.
  const excludeOwners = req.nextUrl.searchParams.get('excludeOwners') === '1'
  const excl = excludeOwners ? Array.from(OWNERS_LC) : ['']

  const [funnel, newDaily, activeDaily, revDaily, byService, roster, orgs, supply, activation, recentArrivals, cohorts] =
    await Promise.all([
    // Tiles + funnel counts. ::int casts keep COUNT out of bigint (JSON-unsafe).
    prisma.$queryRaw<FunnelRow[]>(Prisma.sql`
      WITH addrs AS (${ADDRS}),
      fs AS (SELECT a, min(created_at) AS first_seen FROM addrs WHERE a <> ALL(${excl}) GROUP BY a),
      act AS (
        SELECT a FROM (
          SELECT lower(owner_address) a FROM api_keys
          UNION SELECT lower(owner_address) FROM agent_approvals WHERE approved
        ) z WHERE a <> ALL(${excl})
      ),
      paid AS (
        SELECT lower(g.owner_address) a, count(*) FILTER (WHERE l.ok) AS ok_calls
        FROM spend_ledger l JOIN spend_grants g ON g.id = l.grant_id
        WHERE g.owner_address NOT LIKE 'org:%' AND lower(g.owner_address) <> ALL(${excl})
        GROUP BY 1
      )
      SELECT
        (SELECT count(*) FROM fs)::int AS signed_in,
        (SELECT count(*) FROM fs WHERE first_seen >= now() - interval '7 days')::int AS new_7d,
        (SELECT count(*) FROM fs WHERE first_seen >= now() - interval '14 days'
                                  AND first_seen <  now() - interval '7 days')::int AS new_prev_7d,
        (SELECT count(*) FROM act)::int AS activated,
        (SELECT count(*) FROM paid WHERE ok_calls >= 1)::int AS paid,
        (SELECT count(*) FROM paid WHERE ok_calls >= 2)::int AS repeat,
        (SELECT coalesce(sum(l.amount_usd) FILTER (WHERE l.ok), 0)::float
           FROM spend_ledger l) AS settled_usd,
        (SELECT count(*) FILTER (WHERE l.ok)::int FROM spend_ledger l) AS paid_calls,
        (SELECT count(*) FILTER (WHERE NOT l.ok)::int FROM spend_ledger l) AS declined_calls
    `),
    // New wallets per day (first-seen), last 60 days.
    prisma.$queryRaw<DayN[]>(Prisma.sql`
      WITH addrs AS (${ADDRS}),
      fs AS (SELECT a, min(created_at) AS first_seen FROM addrs WHERE a <> ALL(${excl}) GROUP BY a)
      SELECT date_trunc('day', first_seen) AS day, count(*)::int AS n
      FROM fs WHERE first_seen >= now() - interval '60 days'
      GROUP BY 1 ORDER BY 1
    `),
    // Active wallets per day (acted = created a chat or settled a call), 30 days.
    prisma.$queryRaw<DayN[]>(Prisma.sql`
      WITH acts AS (
        SELECT lower(owner_address) AS a, date_trunc('day', created_at) AS day FROM chats WHERE owner_address IS NOT NULL
        UNION ALL
        SELECT lower(g.owner_address), date_trunc('day', l.created_at)
          FROM spend_ledger l JOIN spend_grants g ON g.id = l.grant_id WHERE g.owner_address NOT LIKE 'org:%'
      )
      SELECT day, count(DISTINCT a)::int AS n FROM acts
      WHERE a <> ALL(${excl}) AND day >= now() - interval '30 days'
      GROUP BY 1 ORDER BY 1
    `),
    // Settled / declined per day (company-wide revenue), 30 days.
    prisma.$queryRaw<RevRow[]>(Prisma.sql`
      SELECT date_trunc('day', l.created_at) AS day,
             coalesce(sum(l.amount_usd) FILTER (WHERE l.ok), 0)::float AS settled,
             count(*) FILTER (WHERE l.ok)::int AS ok_calls,
             count(*) FILTER (WHERE NOT l.ok)::int AS declined,
             coalesce(sum(l.amount_usd) FILTER (WHERE NOT l.ok), 0)::float AS blocked
      FROM spend_ledger l
      WHERE l.created_at >= now() - interval '30 days'
      GROUP BY 1 ORDER BY 1
    `),
    // Settled by service (company-wide), top 12.
    prisma.$queryRaw<{ service: string; spent: number; calls: number }[]>(Prisma.sql`
      SELECT coalesce(l.service_name, l.host) AS service,
             coalesce(sum(l.amount_usd) FILTER (WHERE l.ok), 0)::float AS spent,
             count(*) FILTER (WHERE l.ok)::int AS calls
      FROM spend_ledger l
      GROUP BY 1 HAVING count(*) FILTER (WHERE l.ok) > 0
      ORDER BY 2 DESC LIMIT 12
    `),
    // Wallet roster — most-recently-active first, top 50.
    prisma.$queryRaw<RosterRow[]>(Prisma.sql`
      WITH addrs AS (${ADDRS}),
      fs AS (SELECT a, min(created_at) AS first_seen FROM addrs WHERE a <> ALL(${excl}) GROUP BY a),
      ch AS (SELECT lower(owner_address) a, count(*)::int chats, max(updated_at) last_chat
               FROM chats WHERE owner_address IS NOT NULL GROUP BY 1),
      ky AS (SELECT lower(owner_address) a, count(*)::int keys FROM api_keys GROUP BY 1),
      pd AS (SELECT lower(g.owner_address) a,
                    coalesce(sum(l.amount_usd) FILTER (WHERE l.ok), 0)::float settled,
                    count(*) FILTER (WHERE l.ok)::int ok_calls,
                    max(l.created_at) FILTER (WHERE l.ok) last_paid
               FROM spend_ledger l JOIN spend_grants g ON g.id = l.grant_id
               WHERE g.owner_address NOT LIKE 'org:%' GROUP BY 1),
      om AS (SELECT lower(address) a, count(*)::int orgs FROM org_members GROUP BY 1)
      SELECT fs.a AS address, fs.first_seen,
             coalesce(ch.chats, 0) AS chats, coalesce(ky.keys, 0) AS keys,
             coalesce(pd.settled, 0) AS settled, coalesce(pd.ok_calls, 0) AS ok_calls,
             coalesce(om.orgs, 0) AS orgs,
             greatest(coalesce(ch.last_chat, fs.first_seen), coalesce(pd.last_paid, fs.first_seen)) AS last_active
      FROM fs
      LEFT JOIN ch ON ch.a = fs.a LEFT JOIN ky ON ky.a = fs.a
      LEFT JOIN pd ON pd.a = fs.a LEFT JOIN om ON om.a = fs.a
      ORDER BY last_active DESC LIMIT 50
    `),
    prisma.$queryRaw<{ orgs: number; members: number; org_settled: number }[]>(Prisma.sql`
      SELECT (SELECT count(*)::int FROM organizations) AS orgs,
             (SELECT count(*)::int FROM org_members) AS members,
             (SELECT coalesce(sum(l.amount_usd) FILTER (WHERE l.ok), 0)::float
                FROM spend_ledger l WHERE l.org_id IS NOT NULL) AS org_settled
    `),
    prisma.$queryRaw<{ callable: number; servers: number }[]>(Prisma.sql`
      SELECT count(*) FILTER (WHERE callable)::int AS callable, count(*)::int AS servers FROM mcp_servers
    `),
    // Activation latency: hours from a wallet's first-seen to its first settled call.
    prisma.$queryRaw<ActivationRow[]>(Prisma.sql`
      WITH addrs AS (${ADDRS}),
      fs AS (SELECT a, min(created_at) AS first_seen FROM addrs WHERE a <> ALL(${excl}) GROUP BY a),
      firstpay AS (
        SELECT lower(g.owner_address) a, min(l.created_at) FILTER (WHERE l.ok) AS first_paid
        FROM spend_ledger l JOIN spend_grants g ON g.id = l.grant_id
        WHERE g.owner_address NOT LIKE 'org:%' GROUP BY 1
      ),
      lat AS (
        SELECT extract(epoch FROM (fp.first_paid - fs.first_seen)) / 3600.0 AS hours
        FROM fs JOIN firstpay fp ON fp.a = fs.a
        WHERE fp.first_paid IS NOT NULL AND fp.first_paid >= fs.first_seen
      )
      SELECT count(*)::int AS n,
             percentile_cont(0.5)  WITHIN GROUP (ORDER BY hours)::float AS p50,
             percentile_cont(0.25) WITHIN GROUP (ORDER BY hours)::float AS p25,
             percentile_cont(0.75) WITHIN GROUP (ORDER BY hours)::float AS p75
      FROM lat
    `),
    // Recent arrivals: wallets first-seen in the last 14 days, newest first.
    prisma.$queryRaw<ArrivalRow[]>(Prisma.sql`
      WITH addrs AS (${ADDRS}),
      fs AS (SELECT a, min(created_at) AS first_seen FROM addrs WHERE a <> ALL(${excl}) GROUP BY a),
      ch AS (SELECT lower(owner_address) a, count(*)::int chats FROM chats WHERE owner_address IS NOT NULL GROUP BY 1),
      ky AS (SELECT lower(owner_address) a, count(*)::int keys FROM api_keys GROUP BY 1),
      pd AS (SELECT lower(g.owner_address) a,
                    count(*) FILTER (WHERE l.ok)::int ok_calls,
                    coalesce(sum(l.amount_usd) FILTER (WHERE l.ok), 0)::float settled
               FROM spend_ledger l JOIN spend_grants g ON g.id = l.grant_id
               WHERE g.owner_address NOT LIKE 'org:%' GROUP BY 1)
      SELECT fs.a AS address, fs.first_seen,
             coalesce(ch.chats, 0) AS chats, coalesce(ky.keys, 0) AS keys,
             coalesce(pd.ok_calls, 0) AS ok_calls, coalesce(pd.settled, 0) AS settled
      FROM fs LEFT JOIN ch ON ch.a = fs.a LEFT JOIN ky ON ky.a = fs.a LEFT JOIN pd ON pd.a = fs.a
      WHERE fs.first_seen >= now() - interval '14 days'
      ORDER BY fs.first_seen DESC LIMIT 15
    `),
    // Weekly signup cohorts: size, how many returned (acted in a later week), how many paid.
    prisma.$queryRaw<CohortRow[]>(Prisma.sql`
      WITH addrs AS (${ADDRS}),
      fs AS (SELECT a, min(created_at) AS first_seen FROM addrs WHERE a <> ALL(${excl}) GROUP BY a),
      acts AS (
        SELECT lower(owner_address) a, created_at AS ts FROM chats WHERE owner_address IS NOT NULL
        UNION ALL
        SELECT lower(g.owner_address), l.created_at
          FROM spend_ledger l JOIN spend_grants g ON g.id = l.grant_id
          WHERE g.owner_address NOT LIKE 'org:%' AND l.ok
      ),
      paid AS (
        SELECT lower(g.owner_address) a, min(l.created_at) FILTER (WHERE l.ok) AS fp
        FROM spend_ledger l JOIN spend_grants g ON g.id = l.grant_id
        WHERE g.owner_address NOT LIKE 'org:%' GROUP BY 1
      ),
      ret AS (
        SELECT fs.a,
               bool_or(act.ts >= date_trunc('week', fs.first_seen) + interval '1 week') AS returned
        FROM fs LEFT JOIN acts act ON act.a = fs.a GROUP BY fs.a
      )
      SELECT date_trunc('week', fs.first_seen) AS week,
             count(*)::int AS size,
             count(*) FILTER (WHERE ret.returned)::int AS returned,
             count(*) FILTER (WHERE paid.fp IS NOT NULL)::int AS paid
      FROM fs LEFT JOIN ret ON ret.a = fs.a LEFT JOIN paid ON paid.a = fs.a
      WHERE fs.first_seen >= now() - interval '8 weeks'
      GROUP BY 1 ORDER BY 1
    `),
  ])

  const f = funnel[0]
  const paidCalls = f.paid_calls
  const declined = f.declined_calls
  const declineRate = paidCalls + declined > 0 ? declined / (paidCalls + declined) : null

  return NextResponse.json({
    excludeOwners,
    tiles: {
      signedIn: f.signed_in,
      new7d: f.new_7d,
      newPrev7d: f.new_prev_7d,
      activated: f.activated,
      paid: f.paid,
      settledUsd: f.settled_usd,
      paidCalls,
      declineRate,
    },
    // Honest funnel: pre-sign-in wallet connects leave no DB trace, so the top
    // of the funnel is "signed in", not "connected".
    funnel: [
      { key: 'signedIn', label: 'Signed in', value: f.signed_in },
      { key: 'activated', label: 'Activated (key or approval)', value: f.activated },
      { key: 'paid', label: 'Paid (≥1 call)', value: f.paid },
      { key: 'repeat', label: 'Repeat (≥2 calls)', value: f.repeat },
    ],
    newWalletsDaily: newDaily.map((r) => ({ day: r.day.toISOString(), n: r.n })),
    activeWalletsDaily: activeDaily.map((r) => ({ day: r.day.toISOString(), n: r.n })),
    revenueDaily: revDaily.map((r) => ({
      day: r.day.toISOString(),
      settled: r.settled,
      okCalls: r.ok_calls,
      declined: r.declined,
      blocked: r.blocked,
    })),
    byService,
    roster: roster.map((r) => ({
      address: r.address,
      firstSeen: r.first_seen.toISOString(),
      lastActive: r.last_active.toISOString(),
      chats: r.chats,
      keys: r.keys,
      settled: r.settled,
      okCalls: r.ok_calls,
      orgs: r.orgs,
    })),
    orgs: orgs[0],
    supply: supply[0],
    activation: {
      count: activation[0].n,
      medianHours: activation[0].p50,
      p25Hours: activation[0].p25,
      p75Hours: activation[0].p75,
    },
    recentArrivals: recentArrivals.map((r) => ({
      address: r.address,
      firstSeen: r.first_seen.toISOString(),
      chats: r.chats,
      keys: r.keys,
      okCalls: r.ok_calls,
      settled: r.settled,
    })),
    cohorts: cohorts.map((r) => ({
      week: r.week.toISOString(),
      size: r.size,
      returned: r.returned,
      paid: r.paid,
    })),
  })
}

interface FunnelRow {
  signed_in: number
  new_7d: number
  new_prev_7d: number
  activated: number
  paid: number
  repeat: number
  settled_usd: number
  paid_calls: number
  declined_calls: number
}
interface DayN {
  day: Date
  n: number
}
interface RevRow {
  day: Date
  settled: number
  ok_calls: number
  declined: number
  blocked: number
}
interface RosterRow {
  address: string
  first_seen: Date
  last_active: Date
  chats: number
  keys: number
  settled: number
  ok_calls: number
  orgs: number
}
interface ActivationRow {
  n: number
  p50: number | null
  p25: number | null
  p75: number | null
}
interface ArrivalRow {
  address: string
  first_seen: Date
  chats: number
  keys: number
  ok_calls: number
  settled: number
}
interface CohortRow {
  week: Date
  size: number
  returned: number
  paid: number
}
