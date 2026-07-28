import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { activeLinkCapFor, cleanAsk, composeMcps, mintSlug, parseAllowWallets, parseExpiry, parseMaxSigns, sanitizeMcps, sanitizeVariants, validateRedirect } from '@/lib/intent-links'
import { FEE_BEARING_BUILD_PATHS, creatorEarningsUsd, netFeeBpsFor } from '@/lib/fees'
import { getEffectivePlan } from '@/lib/billing'
import { isAdminAddress } from '@/lib/admin'

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
        data: { id, ask, variants, mcps, creator, agent, redirectUrl, expiresAt: expiry.date, maxSigns: maxSigns.max, allowWallets: allow.wallets },
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
    const f = { open: 0, connect: 0, built: 0, signed: 0, valueUsd: 0 }
    for (const e of events) {
      if (e.slug !== slug) continue
      if (e.kind === 'open') f.open += e._count._all
      else if (e.kind === 'connect') f.connect += e._count._all
      else if (e.kind === 'built') f.built += e._count._all
      else if (e.kind === 'signed') {
        f.signed += e._count._all
        f.valueUsd += e._sum.valueUsd ?? 0
      }
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
  const turns = await prisma.embedTurn.groupBy({
    by: ['intentLinkSlug', 'buildPath'],
    where: { intentLinkSlug: { in: links.map((l) => l.id) }, outcome: 'signed', valueUsd: { gt: 0 } },
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
        earnedUsd += creatorEarningsUsd(v, netFeeBpsFor(t.buildPath))
      }
    }
    // feeBearingUsd rides along so the UI can tell "$0.00 because nothing
    // moved" apart from "$0.00 because every dollar took a fee-free route"
    // (bridges, transfers, stakes) — a bare zero reads as broken.
    return { signedUsd, signsCount, feeBearingUsd, earnedUsd }
  }

  const money = links.map((l) => moneyOf(l.id))
  const totalEarnedUsd = money.reduce((s, m) => s + m.earnedUsd, 0)
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
    },
  })
}
