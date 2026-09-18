import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getAddress, isAddress } from 'viem'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { isAdminAddress, isTestWallet } from '@/lib/admin'
import { isCdpListingConfigured, listCdpEndUsers, type CdpEndUser } from '@/lib/cdp'
import { INTERNAL_ORIGIN_SQL, INTERNAL_TRAFFIC_WHERE, isCountedTurn } from '@/lib/value-origin'
import {
  FLOW_WINDOWS,
  LIVE_MS,
  backfillAsks,
  collapseClicks,
  dropEchoedSends,
  foldFlow,
  foldLeaves,
  itemFromRow,
  mergeItems,
  rageRuns,
  sourceOf,
  summarize,
  type FlowItem,
  type FlowSource,
} from '@/lib/user-flows'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/flows — one timeline per person, admin-gated.
 *
 * Two halves, merged (lib/user-flows.ts is the vocabulary and the judgement):
 *   · visitor_events — the first-party journey log: pages, clicks, time on
 *     page, errors, asks and what came back. Keyed by a daily visitor id, so
 *     it sees people BEFORE they have a wallet.
 *   · what we already keep per wallet — chats, turns, ask failures, link
 *     events, jobs, things they made, their Coinbase account. That half is
 *     why the screen is useful for history from before the log existed.
 *
 * A person is a wallet when one was ever connected during a visit, otherwise
 * a visitor id. Team traffic is tagged four ways (a test/admin wallet, a
 * browser an admin has signed in on, a network an admin was on that day, a
 * hand-placed mark) and hidden unless asked for.
 *
 *   ?days=1|3|7|30   window (default 3)
 *   ?team=1          include our own traffic
 *   ?silent=1        include visits with no human input (bots, instant backs)
 *   ?internal=1      include harness/preview rows (the API harness reads back its own)
 */

const MAX_EVENTS = 30_000
const MAX_FLOWS = 400
const MAX_ITEMS = 300
const TEAM_EMAIL = /@(pantessa\.com|yeetful\.com)$/i

async function soft<T>(label: string, q: Promise<T>, fallback: T): Promise<T> {
  try {
    return await q
  } catch (e) {
    console.warn(`[admin/flows] ${label} failed:`, e instanceof Error ? e.message.split('\n')[0] : e)
    return fallback
  }
}

// The same fence the Growth books use: our own origins (localhost, previews,
// fixture TLDs) are not people, stamped or not.
const REAL_ORIGIN = Prisma.raw(INTERNAL_ORIGIN_SQL)

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const usd = (n: number | null | undefined) => (n && n > 0 ? ` · $${n.toFixed(2)}` : '')

export async function GET(req: NextRequest) {
  const admin = await getAuthAddress(req)
  if (!admin) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!isAdminAddress(admin)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  const q = req.nextUrl.searchParams
  const daysRaw = Number(q.get('days'))
  const days = (FLOW_WINDOWS as readonly number[]).includes(daysRaw) ? daysRaw : 3
  const includeTeam = q.get('team') === '1'
  const includeSilent = q.get('silent') === '1'
  const includeInternal = q.get('internal') === '1'
  const now = Date.now()
  const since = new Date(now - days * 86_400_000)

  // ── half one: the journey log ───────────────────────────────────────────
  const [eventsDesc, marks] = await Promise.all([
    soft(
      'events',
      prisma.visitorEvent.findMany({
        where: { createdAt: { gte: since }, ...(includeInternal ? {} : { isInternal: false }) },
        orderBy: { createdAt: 'desc' },
        take: MAX_EVENTS,
      }),
      [],
    ),
    soft('marks', prisma.teamMark.findMany(), []),
  ])
  const events = eventsDesc.reverse()
  const marked = new Set(marks.map((m) => m.key.toLowerCase()))

  type Vid = { rows: typeof events; wallets: string[]; team: boolean; bot: boolean; nets: Set<string>; country: string | null; device: string | null }
  const vids = new Map<string, Vid>()
  const teamNets = new Set<string>()
  for (const e of events) {
    let v = vids.get(e.vid)
    if (!v) vids.set(e.vid, (v = { rows: [], wallets: [], team: false, bot: false, nets: new Set(), country: null, device: null }))
    v.rows.push(e)
    if (e.wallet && !v.wallets.includes(e.wallet)) v.wallets.push(e.wallet)
    if (e.isTeam) v.team = true
    if (e.isBot) v.bot = true
    if (e.net) v.nets.add(e.net)
    v.country ??= e.country
    v.device ??= e.device
    if (e.isTeam && e.net) teamNets.add(e.net)
  }

  // ── who to fetch the second half for ────────────────────────────────────
  const visitorWallets = new Set<string>()
  for (const v of vids.values()) for (const w of v.wallets) visitorWallets.add(w)
  const dbActive = await soft(
    'active wallets',
    prisma.$queryRaw<{ w: string }[]>`
      SELECT DISTINCT w FROM (
        SELECT lower(owner_address) AS w FROM chats WHERE NOT is_internal AND updated_at >= ${since}
        UNION ALL SELECT lower(coalesce(wallet_address, owner_address)) FROM embed_turns WHERE NOT ${REAL_ORIGIN} AND session_id NOT LIKE 'harness-%' AND created_at >= ${since}
        UNION ALL SELECT lower(wallet) FROM ask_failures WHERE NOT is_internal AND created_at >= ${since}
        UNION ALL SELECT lower(wallet) FROM intent_link_events WHERE NOT is_internal AND created_at >= ${since}
        UNION ALL SELECT lower(wallet) FROM jobs WHERE NOT is_internal AND created_at >= ${since}
        UNION ALL SELECT lower(owner) FROM watchlists WHERE NOT is_internal AND created_at >= ${since}
        UNION ALL SELECT lower(owner) FROM price_alerts WHERE NOT is_internal AND created_at >= ${since}
        UNION ALL SELECT lower(creator) FROM intent_links WHERE NOT is_internal AND created_at >= ${since}
      ) z WHERE w ~ '^0x[0-9a-f]{40}$' LIMIT 600
    `,
    [],
  )
  const cdpUsers: CdpEndUser[] = isCdpListingConfigured() ? await soft('cdp', listCdpEndUsers(), []) : []
  const accountOf = new Map<string, CdpEndUser>()
  for (const u of cdpUsers) for (const w of u.wallets) accountOf.set(w, u)
  const wallets = new Set<string>([...visitorWallets, ...dbActive.map((r) => r.w)])
  for (const u of cdpUsers) if (Date.parse(u.createdAt) >= since.getTime()) for (const w of u.wallets) wallets.add(w)
  const lower = [...wallets].filter((w) => isAddress(w)).slice(0, 600)
  // Tables hold a mix of lowercased and checksummed addresses.
  const both = [...new Set(lower.flatMap((w) => [w, getAddress(w)]))]

  // ── half two: what we already keep, per wallet ──────────────────────────
  const [chats, turns, failures, linkEvents, jobs, watchlists, alerts, minted, schedules] = lower.length
    ? await Promise.all([
        soft(
          'chats',
          prisma.chat.findMany({
            where: { ownerAddress: { in: both }, isInternal: false, updatedAt: { gte: since } },
            select: { ownerAddress: true, messages: { where: { createdAt: { gte: since } }, select: { role: true, content: true, meta: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 200 } },
            take: 400,
          }),
          [],
        ),
        soft(
          'turns',
          prisma.embedTurn.findMany({
            where: {
              createdAt: { gte: since },
              NOT: [INTERNAL_TRAFFIC_WHERE, { sessionId: { startsWith: 'harness-' } }],
              OR: [{ walletAddress: { in: both } }, { walletAddress: null, ownerAddress: { in: both } }],
            },
            select: { walletAddress: true, ownerAddress: true, outcome: true, artifact: true, chain: true, buildPath: true, valueUsd: true, prompt: true, intentLinkSlug: true, detail: true, verification: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
            take: 3000,
          }),
          [],
        ),
        soft(
          'failures',
          prisma.askFailure.findMany({ where: { wallet: { in: both }, isInternal: false, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, take: 2000 }),
          [],
        ),
        soft(
          'link events',
          prisma.intentLinkEvent.findMany({
            where: { wallet: { in: both }, isInternal: false, createdAt: { gte: since } },
            select: { slug: true, kind: true, wallet: true, valueUsd: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
            take: 3000,
          }),
          [],
        ),
        soft(
          'jobs',
          prisma.job.findMany({
            where: { wallet: { in: both }, isInternal: false, createdAt: { gte: since } },
            select: { wallet: true, title: true, status: true, failReason: true, valueUsd: true, createdAt: true, updatedAt: true },
            orderBy: { createdAt: 'asc' },
            take: 2000,
          }),
          [],
        ),
        soft('watchlists', prisma.watchlist.findMany({ where: { owner: { in: both }, isInternal: false, createdAt: { gte: since } }, select: { owner: true, name: true, createdAt: true }, take: 1000 }), []),
        soft(
          'alerts',
          prisma.priceAlert.findMany({ where: { owner: { in: both }, isInternal: false, createdAt: { gte: since } }, select: { owner: true, symbol: true, condition: true, value: true, createdAt: true }, take: 1000 }),
          [],
        ),
        soft('links', prisma.intentLink.findMany({ where: { creator: { in: both }, isInternal: false, createdAt: { gte: since } }, select: { creator: true, ask: true, id: true, createdAt: true }, take: 1000 }), []),
        soft(
          'schedules',
          prisma.dcaSchedule.findMany({ where: { wallet: { in: both }, isInternal: false, createdAt: { gte: since } }, select: { wallet: true, buyUsd: true, buyToken: true, cadence: true, createdAt: true }, take: 500 }),
          [],
        ),
      ])
    : [[], [], [], [], [], [], [], [], []]

  const dbItems = new Map<string, FlowItem[]>()
  const put = (wallet: string | null | undefined, item: FlowItem) => {
    if (!wallet) return
    const w = wallet.toLowerCase()
    const list = dbItems.get(w)
    if (list) list.push(item)
    else dbItems.set(w, [item])
  }

  for (const c of chats) {
    for (const m of c.messages) {
      const at = m.createdAt.getTime()
      const meta = (m.meta && typeof m.meta === 'object' && !Array.isArray(m.meta) ? m.meta : {}) as Record<string, unknown>
      if (m.role === 'user') {
        put(c.ownerAddress, { at, kind: 'ask', title: `Asked: ${clip(m.content.replace(/\s+/g, ' '), 240)}`, from: 'db', path: '/chat' })
        continue
      }
      const via = typeof meta.buildPath === 'string' ? ` (${meta.buildPath})` : ''
      if ('signed' in meta) put(c.ownerAddress, { at, kind: 'signed', title: `Signed${via}`, from: 'db', path: '/chat' })
      else if (meta.txRequest || meta.txChain || meta.orderRequest || meta.jobId || meta.guardianPolicyId || meta.dcaScheduleId || meta.voteProposal)
        put(c.ownerAddress, { at, kind: 'reply-built', title: `Got something to sign${via}`, from: 'db', path: '/chat' })
      else if (meta.clarify) put(c.ownerAddress, { at, kind: 'reply-offer', title: `Got choices to pick from${via}`, from: 'db', path: '/chat' })
      else put(c.ownerAddress, { at, kind: 'reply-answer', title: `Got an answer${via}`, detail: clip(m.content.replace(/\s+/g, ' '), 160), from: 'db', path: '/chat' })
    }
  }
  for (const t of turns) {
    const who = t.walletAddress ?? t.ownerAddress
    const at = t.createdAt.getTime()
    const where = t.intentLinkSlug ? `/i/${t.intentLinkSlug}` : null
    const what = [t.artifact, t.chain ? `chain ${t.chain}` : null, t.buildPath].filter(Boolean).join(' · ')
    // Money follows the receipt (lib/value-origin): a signature whose receipt
    // check came back refuted is shown, and is not called signed.
    if (t.outcome === 'signed' && !isCountedTurn(t)) put(who, { at, kind: 'event', title: `Reported a signature the receipt check did not back (${t.verification})`, detail: what || null, from: 'db', path: where })
    else if (t.outcome === 'signed') put(who, { at, kind: 'signed', title: `Signed${usd(t.valueUsd)}`, detail: what || null, from: 'db', path: where, n: { usd: t.valueUsd ?? 0 } })
    else if (t.outcome === 'tx-built') put(who, { at, kind: 'built', title: `A sign card rendered${usd(t.valueUsd)}`, detail: what || null, from: 'db', path: where })
    else if (t.outcome === 'refused') put(who, { at, kind: 'reply-wall', title: 'The turn was refused', detail: t.detail ? clip(t.detail, 160) : null, from: 'db', path: where })
  }
  for (const f of failures) {
    const at = f.createdAt.getTime()
    const funds = f.hadFunds === true ? `Had funds: ${f.fundsDetail ?? `$${(f.fundsUsd ?? 0).toFixed(2)}`}` : f.hadFunds === false ? 'Wallet was empty' : null
    const said = f.reply ? clip(f.reply.replace(/\s+/g, ' '), 220) : null
    const detail = [said, funds].filter(Boolean).join(' — ') || null
    const ask = clip(f.prompt.replace(/\s+/g, ' '), 240)
    if (f.kind === 'wallet-refused') put(f.wallet, { at, kind: 'refused', title: `Wallet refused: ${clip(f.prompt, 120)}`, detail: said, from: 'db', ask })
    else if (f.kind === 'withheld') put(f.wallet, { at, kind: 'withheld', title: `We withheld a step: ${clip(f.prompt, 120)}`, detail: said, from: 'db', ask })
    else put(f.wallet, { at, kind: 'reply-wall', title: `Wall (${f.kind}${f.buildPath ? ` · ${f.buildPath}` : ''}): ${clip(f.prompt, 120)}`, detail, from: 'db', n: { hadFunds: f.hadFunds }, ask })
  }
  for (const e of linkEvents) {
    const at = e.createdAt.getTime()
    const path = `/i/${e.slug}`
    if (e.kind === 'connect') put(e.wallet, { at, kind: 'connect', title: `Connected on the link ${path}`, from: 'db', path })
    else if (e.kind === 'built') put(e.wallet, { at, kind: 'built', title: `The link built its transaction${usd(e.valueUsd)}`, from: 'db', path })
    else if (e.kind === 'signed') put(e.wallet, { at, kind: 'signed', title: `Signed on the link${usd(e.valueUsd)}`, from: 'db', path, n: { usd: 0 } }) // the turn row carries the money
    else if (e.kind === 'settled') put(e.wallet, { at, kind: 'event', title: 'The link’s job settled', from: 'db', path })
    else if (e.kind === 'open') put(e.wallet, { at, kind: 'view', title: `Opened ${path}`, from: 'db', path })
  }
  for (const j of jobs) {
    put(j.wallet, { at: j.createdAt.getTime(), kind: 'job', title: `Job compiled: ${clip(j.title, 140)}`, from: 'db' })
    if (j.status === 'failed') put(j.wallet, { at: j.updatedAt.getTime(), kind: 'job-failed', title: `Job failed: ${clip(j.title, 100)}`, detail: j.failReason ? clip(j.failReason, 220) : null, from: 'db' })
    else if (j.status === 'done') put(j.wallet, { at: j.updatedAt.getTime(), kind: 'signed', title: `Job finished${usd(j.valueUsd)}: ${clip(j.title, 100)}`, from: 'db', n: { usd: 0 } })
  }
  for (const w of watchlists) put(w.owner, { at: w.createdAt.getTime(), kind: 'made', title: `Made a watchlist: ${clip(w.name, 60)}`, from: 'db' })
  for (const a of alerts) put(a.owner, { at: a.createdAt.getTime(), kind: 'made', title: `Set an alert: ${a.symbol} ${a.condition} ${a.value}`, from: 'db' })
  for (const l of minted) put(l.creator, { at: l.createdAt.getTime(), kind: 'made', title: `Minted a link: ${clip(l.ask, 120)}`, from: 'db', path: `/i/${l.id}` })
  for (const s of schedules) put(s.wallet, { at: s.createdAt.getTime(), kind: 'made', title: `Set a recurring buy: $${s.buyUsd} of ${s.buyToken} ${s.cadence}`, from: 'db' })
  for (const u of cdpUsers) {
    const at = Date.parse(u.createdAt)
    if (at >= since.getTime()) for (const w of u.wallets) put(w, { at, kind: 'account', title: `Created an account with ${u.method === 'email' ? 'email' : u.method}`, from: 'db' })
  }

  // ── people ──────────────────────────────────────────────────────────────
  type Person = { key: string; wallet: string | null; vids: string[] }
  const people = new Map<string, Person>()
  for (const [vid, v] of vids) {
    const wallet = v.wallets[0] ?? null
    const key = wallet ? `w:${wallet}` : `v:${vid}`
    const p = people.get(key)
    if (p) p.vids.push(vid)
    else people.set(key, { key, wallet, vids: [vid] })
  }
  for (const w of dbItems.keys()) if (!people.has(`w:${w}`)) people.set(`w:${w}`, { key: `w:${w}`, wallet: w, vids: [] })

  const flows = []
  let hiddenTeam = 0
  let hiddenSilent = 0
  for (const p of people.values()) {
    const vs = p.vids.map((id) => vids.get(id)!).filter(Boolean)
    const account = p.wallet ? (accountOf.get(p.wallet) ?? null) : null
    const allWallets = [...new Set([...(p.wallet ? [p.wallet] : []), ...vs.flatMap((v) => v.wallets)])]
    const team =
      allWallets.some((w) => isTestWallet(w) || isAdminAddress(w) || marked.has(w)) ||
      p.vids.some((id) => marked.has(`v:${id}`)) ||
      vs.some((v) => v.team || [...v.nets].some((n) => teamNets.has(n))) ||
      (!!account?.email && TEAM_EMAIL.test(account.email))
    const teamWhy = !team
      ? null
      : allWallets.some((w) => isTestWallet(w) || isAdminAddress(w))
        ? 'a team wallet'
        : allWallets.some((w) => marked.has(w)) || p.vids.some((id) => marked.has(`v:${id}`))
          ? 'marked by hand'
          : vs.some((v) => v.team)
            ? 'an admin’s browser'
            : account?.email && TEAM_EMAIL.test(account.email)
              ? 'a team email'
              : 'same network as an admin that day'
    if (team && !includeTeam) {
      hiddenTeam++
      continue
    }

    const visitorItems = vs.flatMap((v) => v.rows.map((r) => itemFromRow({ at: r.createdAt.getTime(), kind: r.kind, path: r.path, label: r.label, detail: (r.detail ?? null) as Record<string, unknown> | null, referrer: r.referrer })).filter((i): i is FlowItem => !!i))
    const stitched = allWallets.flatMap((w) => dbItems.get(w) ?? [])
    const items = foldLeaves(collapseClicks(dropEchoedSends(backfillAsks(mergeItems([...visitorItems, ...stitched])))))
    if (items.length === 0) continue
    const fold = foldFlow(items, { hasWallet: allWallets.length > 0 })
    const bot = vs.length > 0 && vs.every((v) => v.bot)
    if ((bot || !fold.human) && !includeSilent) {
      hiddenSilent++
      continue
    }

    const firstRow = vs.flatMap((v) => v.rows).find((r) => r.kind === 'view' && (r.referrer || r.utm)) ?? vs[0]?.rows.find((r) => r.kind === 'view') ?? null
    const src = vs.length
      ? sourceOf({ referrer: firstRow?.referrer, utm: firstRow?.utm, ua: vs[0].device, landing: fold.landing })
      : { source: (items.some((i) => i.path?.startsWith('/i/')) ? 'link' : 'direct') as FlowSource, label: items.some((i) => i.path?.startsWith('/i/')) ? 'Shared link' : 'No page record' }
    const firstAt = items[0].at
    const lastAt = items[items.length - 1].at
    flows.push({
      id: p.key,
      wallet: p.wallet,
      wallets: allWallets,
      vids: p.vids,
      email: account?.email ?? null,
      method: account?.method ?? null,
      team,
      teamWhy,
      bot,
      country: vs[0]?.country ?? null,
      device: vs[0]?.device ?? null,
      source: src.source,
      sourceLabel: src.label,
      firstAt,
      lastAt,
      live: now - lastAt <= LIVE_MS,
      /** the journey log saw this person's browser (false = history from tables only) */
      tracked: vs.length > 0,
      rage: rageRuns(items),
      ...fold,
      items: items.slice(-MAX_ITEMS),
      truncated: Math.max(0, items.length - MAX_ITEMS),
    })
  }
  flows.sort((a, b) => b.lastAt - a.lastAt)
  const shown = flows.slice(0, MAX_FLOWS)

  return NextResponse.json({
    windowDays: days,
    generatedAt: new Date(now).toISOString(),
    /** When the journey log's first row landed: nothing before it has pages. */
    trackingSince: (await soft('first', prisma.visitorEvent.findFirst({ where: { isInternal: false }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }), null))?.createdAt ?? null,
    hidden: { team: hiddenTeam, silent: hiddenSilent },
    eventsCapped: eventsDesc.length >= MAX_EVENTS,
    summary: summarize(shown),
    flows: shown,
  })
}
