import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { activeLinkCapFor, cleanAsk, composeMcps, mintSlug, parseAllowWallets, parseExpiry, parseMaxSigns, sanitizeMcps, sanitizeVariants, validateRedirect } from '@/lib/intent-links'
import { FEE_BEARING_BUILD_PATHS, creatorEarningsUsd, netFeeBpsForTurn } from '@/lib/fees'
import { getEffectivePlan } from '@/lib/billing'
import { isAdminAddress } from '@/lib/admin'
import { isMosaicAsk } from '@/lib/mosaic'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Mint an intent link (POST) / list the creator's links + funnels (GET).
 *
 * POST body: { ask, agent?, redirectUrl? } — the creator is the SIWE wallet.
 * The ask is sanitized and stored as a SENTENCE; the MCP set is composed
 * server-side; redirectUrl is validated https at mint and stored with the
 * link (the runtime never reads a redirect from the query string). The
 * response is the shareable /i/<slug> URL.
 */
export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in to mint an intent link.' }, { status: 401 })
  const creator = addr.toLowerCase()

  let body: { ask?: string; agent?: string; redirectUrl?: string; mcps?: unknown; variants?: unknown; expiresAt?: unknown; maxSigns?: unknown; allowWallets?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const ask = cleanAsk(body.ask ?? '')
  if (ask.length < 8) return NextResponse.json({ error: 'The ask must be a plain sentence (at least 8 characters).' }, { status: 400 })

  let redirectUrl: string | null = null
  if (body.redirectUrl) {
    const v = validateRedirect(String(body.redirectUrl))
    if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })
    redirectUrl = v.url
  }

  const agent = body.agent ? cleanAsk(String(body.agent)).slice(0, 40) : null
  // Creator-chosen MCPs win (validated against the mintable set); otherwise
  // the composer decides from the ask's shape.
  const mcps = (sanitizeMcps(body.mcps) ?? composeMcps(ask)).join(',')
  // A/B alternate phrasings — each a full ask; the runtime shows one per
  // visit and the funnel segments by which one was shown.
  const variants = sanitizeVariants(body.variants, ask)

  // Partner-promo limits — validated at mint, enforced server-side at run.
  const expiry = parseExpiry(body.expiresAt)
  if (!expiry.ok) return NextResponse.json({ error: expiry.reason }, { status: 400 })
  const maxSigns = parseMaxSigns(body.maxSigns)
  if (!maxSigns.ok) return NextResponse.json({ error: maxSigns.reason }, { status: 400 })
  const allow = parseAllowWallets(body.allowWallets)
  if (!allow.ok) return NextResponse.json({ error: allow.reason }, { status: 400 })

  // Capacity gate (soft): active links per plan, mirroring standing-intent
  // tiers. Existing links are never touched — the cap gates NEW mints only.
  // Admin wallets mint uncapped (demo/marketing links, not plan-gated usage).
  const { plan } = await getEffectivePlan(creator)
  const cap = activeLinkCapFor(plan.id, isAdminAddress(creator))
  if (cap !== Infinity) {
    const active = await prisma.intentLink.count({ where: { creator, revoked: false } })
    if (active >= cap) {
      return NextResponse.json(
        { error: `Your plan carries ${cap} active intent links — upgrade on /pricing for more, or revoke one first. Links you've already shared keep working forever.`, upgrade: '/pricing' },
        { status: 402 },
      )
    }
  }

  // Slug collisions at 40 bits are lottery-rare; retry twice anyway.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = mintSlug()
    try {
      const link = await prisma.intentLink.create({
        // A tile-grammar ask minted through THIS door is still a mosaic —
        // stamp kind so the gallery/fork surfaces see it (the /api/mosaics
        // door is the structured way in, not the only one).
        data: { id, ask, variants, mcps, creator, agent, redirectUrl, expiresAt: expiry.date, maxSigns: maxSigns.max, allowWallets: allow.wallets, kind: isMosaicAsk(ask) ? 'mosaic' : null },
      })
      return NextResponse.json({
        slug: link.id,
        url: `/i/${link.id}`,
        ask: link.ask,
        variants: link.variants,
        mcps: link.mcps,
        redirectUrl: link.redirectUrl,
        expiresAt: link.expiresAt,
        maxSigns: link.maxSigns,
        allowCount: link.allowWallets.length,
      })
    } catch (e) {
      const unique = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
      if (!unique) throw e
    }
  }
  return NextResponse.json({ error: 'Could not mint a slug — try again.' }, { status: 500 })
}

/** The creator's links, newest first, each with its funnel aggregates. */
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in to list your intent links.' }, { status: 401 })
  const creator = addr.toLowerCase()

  const links = await prisma.intentLink.findMany({
    where: { creator },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  if (links.length === 0) return NextResponse.json({ links: [] })

  // Grouped by variant too, so A/B links segment their funnel per phrasing;
  // the aggregate funnel sums across variants (legacy null-variant rows
  // included).
  const events = await prisma.intentLinkEvent.groupBy({
    by: ['slug', 'kind', 'variant'],
    where: { slug: { in: links.map((l) => l.id) } },
    _count: { _all: true },
    _sum: { valueUsd: true },
  })
  const funnelOf = (slug: string) => {
    // 'settled' is the fourth stop (a compiled job reached done — the /i
    // arc's settlement signal); valueUsd stays counted at 'signed' so the
    // money-moved number never double-counts a run.
    const f = { open: 0, connect: 0, built: 0, signed: 0, settled: 0, valueUsd: 0 }
    for (const e of events) {
      if (e.slug !== slug) continue
      if (e.kind === 'open') f.open += e._count._all
      else if (e.kind === 'connect') f.connect += e._count._all
      else if (e.kind === 'built') f.built += e._count._all
      else if (e.kind === 'signed') {
        f.signed += e._count._all
        f.valueUsd += e._sum.valueUsd ?? 0
      } else if (e.kind === 'settled') f.settled += e._count._all
    }
    return f
  }
  /** Per-phrasing funnels, only for links that carry variants. Index 0 is
   *  the base ask; events minted before the A/B era (variant null) stay in
   *  the aggregate but belong to no phrasing. */
  const variantFunnelsOf = (link: { id: string; ask: string; variants: string[] }) => {
    if (!link.variants.length) return undefined
    const phrasings = [link.ask, ...link.variants]
    return phrasings.map((askText, v) => {
      const f = { variant: v, ask: askText, open: 0, connect: 0, built: 0, signed: 0 }
      for (const e of events) {
        if (e.slug !== link.id || e.variant !== v) continue
        if (e.kind === 'open') f.open += e._count._all
        else if (e.kind === 'connect') f.connect += e._count._all
        else if (e.kind === 'built') f.built += e._count._all
        else if (e.kind === 'signed') f.signed += e._count._all
      }
      return f
    })
  }

  // Server-truth money: signed turns attributed to these links in
  // embed_turns (guardrail-priced). Earnings accrue ONLY on fee-bearing
  // build paths — the conversions-not-movements rule from lib/fees.
  // isInternal: false — drill/harness rows must never mint claimable money.
  // Flag-only on purpose (not the origin patterns): a creator's own localhost
  // test sign has always accrued in their scoped view; only stamped internal
  // runs are excluded. Must stay in lockstep with /api/intent-links/claims.
  const turns = await prisma.embedTurn.groupBy({
    by: ['intentLinkSlug', 'buildPath', 'feeBps'],
    where: { intentLinkSlug: { in: links.map((l) => l.id) }, outcome: 'signed', valueUsd: { gt: 0 }, isInternal: false },
    _sum: { valueUsd: true },
    _count: { _all: true },
  })
  const moneyOf = (slug: string) => {
    let signedUsd = 0
    let feeBearingUsd = 0
    let earnedUsd = 0
    let signsCount = 0
    for (const t of turns) {
      if (t.intentLinkSlug !== slug) continue
      const v = t._sum.valueUsd ?? 0
      signedUsd += v
      signsCount += t._count._all
      if (t.buildPath && FEE_BEARING_BUILD_PATHS.has(t.buildPath)) {
        feeBearingUsd += v
        // Per PATH, not one blended rate: NEAR Intents splits its app fee
        // with the protocol, so the same $1 earns half what a Uniswap $1 does.
        earnedUsd += creatorEarningsUsd(v, netFeeBpsForTurn(t.buildPath, t.feeBps))
      }
    }
    // feeBearingUsd rides along so the UI can tell "$0.00 because nothing
    // moved" apart from "$0.00 because every dollar took a fee-free route"
    // (bridges, transfers, stakes) — a bare zero reads as broken.
    return { signedUsd, signsCount, feeBearingUsd, earnedUsd }
  }

  const money = links.map((l) => moneyOf(l.id))

  // Lifetime referral (HANDOFF-yeetcall-gtm C2): fee-bearing signed turns by
  // wallets this creator FIRST-TOUCHED, on turns with NO direct link
  // attribution — direct intentLinkSlug attribution always wins per-turn
  // (never double-counted; a referred wallet signing some other creator's
  // link pays THAT creator, as it should — the sharer earned that click).
  const referred = await prisma.referredWallet.findMany({ where: { creator }, select: { wallet: true } })
  const referredTurns = referred.length
    ? await prisma.embedTurn.groupBy({
        by: ['buildPath', 'feeBps'],
        where: {
          walletAddress: { in: referred.map((r) => r.wallet) },
          intentLinkSlug: null,
          outcome: 'signed',
          valueUsd: { gt: 0 },
          isInternal: false,
        },
        _sum: { valueUsd: true },
        _count: { _all: true },
      })
    : []
  let referredEarnedUsd = 0
  let referredSignedUsd = 0
  let referredSigns = 0
  for (const t of referredTurns) {
    const v = t._sum.valueUsd ?? 0
    referredSignedUsd += v
    referredSigns += t._count._all
    if (t.buildPath && FEE_BEARING_BUILD_PATHS.has(t.buildPath)) {
      referredEarnedUsd += creatorEarningsUsd(v, netFeeBpsForTurn(t.buildPath, t.feeBps))
    }
  }

  // Per-week cadence (the 30-day out-earn instrument, HANDOFF-gtm-runway):
  // the KOL retention question is "did this week here beat this week's
  // ref-code payout?" — so earnings need a time axis, not just a lifetime
  // total. Raw SQL does ONLY the date_trunc bucketing; the money math stays
  // in lib/fees (one source, same per-path/per-tier rules as above). Zero
  // DDL — read-time from embed_turns.created_at, last ~5 ISO weeks.
  const weekSince = new Date(Date.now() - 35 * 86_400_000)
  type WeekRow = { wk: Date; build_path: string | null; fee_bps: number | null; v: number; n: bigint }
  const slugList = links.map((l) => l.id)
  const directWeekly: WeekRow[] = slugList.length
    ? await prisma.$queryRaw<WeekRow[]>`
        SELECT date_trunc('week', created_at) AS wk, build_path, fee_bps,
               coalesce(sum(value_usd), 0)::float AS v, count(*) AS n
        FROM embed_turns
        WHERE intent_link_slug IN (${Prisma.join(slugList)}) AND outcome = 'signed'
          AND value_usd > 0 AND NOT is_internal AND created_at >= ${weekSince}
        GROUP BY 1, 2, 3`
    : []
  const referredWeekly: WeekRow[] = referred.length
    ? await prisma.$queryRaw<WeekRow[]>`
        SELECT date_trunc('week', created_at) AS wk, build_path, fee_bps,
               coalesce(sum(value_usd), 0)::float AS v, count(*) AS n
        FROM embed_turns
        WHERE wallet_address IN (${Prisma.join(referred.map((r) => r.wallet))})
          AND intent_link_slug IS NULL AND outcome = 'signed'
          AND value_usd > 0 AND NOT is_internal AND created_at >= ${weekSince}
        GROUP BY 1, 2, 3`
    : []
  const weekMap = new Map<string, { weekStart: string; earnedUsd: number; signedUsd: number; signs: number }>()
  for (const r of [...directWeekly, ...referredWeekly]) {
    const key = r.wk.toISOString().slice(0, 10)
    const w = weekMap.get(key) ?? { weekStart: key, earnedUsd: 0, signedUsd: 0, signs: 0 }
    w.signedUsd += r.v
    w.signs += Number(r.n)
    if (r.build_path && FEE_BEARING_BUILD_PATHS.has(r.build_path)) {
      w.earnedUsd += creatorEarningsUsd(r.v, netFeeBpsForTurn(r.build_path, r.fee_bps))
    }
    weekMap.set(key, w)
  }
  const weekly = [...weekMap.values()].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))

  const totalEarnedUsd = money.reduce((s, m) => s + m.earnedUsd, 0) + referredEarnedUsd
  const totalSignedUsd = money.reduce((s, m) => s + m.signedUsd, 0)
  const totalFeeBearingUsd = money.reduce((s, m) => s + m.feeBearingUsd, 0)
  const claims = await prisma.intentLinkClaim.aggregate({
    where: { creator, status: { in: ['requested', 'paid'] } },
    _sum: { amountUsd: true },
  })
  const claimedUsd = claims._sum.amountUsd ?? 0

  return NextResponse.json({
    links: links.map((l) => ({
      slug: l.id,
      url: `/i/${l.id}`,
      ask: l.ask,
      variants: l.variants,
      agent: l.agent,
      redirectUrl: l.redirectUrl,
      revoked: l.revoked,
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      maxSigns: l.maxSigns,
      allowCount: l.allowWallets.length,
      funnel: funnelOf(l.id),
      funnelVariants: variantFunnelsOf(l),
      ...moneyOf(l.id),
    })),
    earnings: {
      totalEarnedUsd,
      totalSignedUsd,
      totalFeeBearingUsd,
      claimedUsd,
      claimableUsd: Math.max(0, totalEarnedUsd - claimedUsd),
      minClaimUsd: 10,
      // The lifetime rail: wallets first-touched by this creator's links +
      // what their later UNattributed fee-bearing turns have earned.
      referredWallets: referred.length,
      referredEarnedUsd,
      referredSignedUsd,
      referredSigns,
      // Newest week first; direct + rail merged per ISO week (UTC).
      weekly,
    },
  })
}
