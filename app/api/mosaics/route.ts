import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { activeLinkCapFor, cleanAsk, composeMcps, mintSlug } from '@/lib/intent-links'
import { getEffectivePlan } from '@/lib/billing'
import { isAdminAddress } from '@/lib/admin'
import {
  MOSAIC_CHAIN_IDS,
  composeMosaicAsk,
  parseMosaicAsk,
  sanitizeMosaicSlices,
  type MosaicChainWord,
} from '@/lib/mosaic'
import { REAL_TRAFFIC_WHERE } from '@/lib/value-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * MOSAIC mint (POST) / public gallery (GET).
 *
 * A mosaic IS an intent link whose ask carries the tile grammar — this route
 * takes structured slices, composes the canonical SENTENCE with
 * mosaicAskString, and refuses unless that sentence survives its own
 * re-parse (the round-trip pin: percentages in, sentences out, and the only
 * thing ever stored is a string the chat gate already owns). No calldata, no
 * plan, no execution surface lives here — the /i runtime rebuilds everything
 * per-wallet through the guarded planner at open time.
 *
 * Auth via getAuthAddress: SIWE session (browser mint) OR Bearer yf_ key —
 * the yf_ path IS the agent door, so a headless agent can publish a shape
 * with one POST and no browser.
 */

export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in (or send a yf_ API key) to mint a mosaic.' }, { status: 401 })
  const creator = addr.toLowerCase()

  let body: { slices?: unknown; chain?: unknown; agent?: unknown; parentSlug?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  // Structured slices in — sanitizeMosaicSlices is the shared rulebook (the
  // agent desk's broker_tile runs the exact same one).
  const slices = sanitizeMosaicSlices(body.slices)
  if ('problem' in slices) {
    return NextResponse.json({ error: slices.problem }, { status: 400 })
  }

  let chainWord: MosaicChainWord | undefined
  if (body.chain != null) {
    const c = typeof body.chain === 'string' ? body.chain.toLowerCase() : ''
    if (!(c in MOSAIC_CHAIN_IDS)) {
      return NextResponse.json({ error: "chain must be 'base', 'ethereum', or 'arbitrum' (or omitted — the runtime picks the wallet's dominant chain)." }, { status: 400 })
    }
    chainWord = c as MosaicChainWord
  }

  // Fork lineage: parentSlug must name a LIVE mosaic. Lineage, not
  // inheritance — the fork body carries its own slices/chain; the one thing
  // copied is the parent's chain word, and only when the caller left the
  // chain out (a fork of "…on base" shouldn't silently lose its chain).
  let parentSlug: string | null = null
  if (body.parentSlug != null) {
    const p = typeof body.parentSlug === 'string' ? body.parentSlug.trim() : ''
    const parent = p ? await prisma.intentLink.findUnique({ where: { id: p } }) : null
    if (!parent || parent.revoked || parent.kind !== 'mosaic') {
      return NextResponse.json({ error: 'parentSlug must name a live mosaic link — the parent is missing, revoked, or not a mosaic.' }, { status: 400 })
    }
    parentSlug = parent.id
    if (!chainWord) {
      const parentParsed = parseMosaicAsk(parent.ask)
      if (parentParsed && !('problem' in parentParsed)) chainWord = parentParsed.chainWord
    }
  }

  // THE round-trip pin + equality belt, shared with every other mint door
  // (composeMosaicAsk composes, re-parses through the grammar's one
  // rulebook, and proves the sentence carries back exactly what was sent).
  const composed = composeMosaicAsk(slices, chainWord)
  if ('problem' in composed) {
    return NextResponse.json({ error: composed.problem }, { status: 400 })
  }
  const ask = cleanAsk(composed.ask)

  const agent = body.agent ? cleanAsk(String(body.agent)).slice(0, 40) : null

  // Capacity gate (soft): mosaics count against the same active-link cap as
  // every other intent link — one capacity axis, mirroring the links route.
  // Existing links are never touched; admin wallets mint uncapped.
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
        data: {
          id,
          ask,
          variants: [ask],
          mcps: composeMcps(ask).join(',') || null,
          creator,
          agent,
          kind: 'mosaic',
          parentSlug,
        },
      })
      return NextResponse.json({ slug: link.id, url: `/i/${link.id}`, ask: link.ask })
    } catch (e) {
      const unique = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
      if (!unique) throw e
    }
  }
  return NextResponse.json({ error: 'Could not mint a slug — try again.' }, { status: 500 })
}

/**
 * The public gallery: live mosaics, newest first, each with its parsed
 * shape, fork count, and REAL signed money. No auth — this is the same
 * exposure class as the /links board (the ask is public on the /i page
 * anyway; the creator wallet is never returned). ?slug=<x> narrows to one
 * row for the link page's own stats strip.
 */
export async function GET(req: NextRequest) {
  const slugParam = req.nextUrl.searchParams.get('slug')?.trim() || null

  const links = await prisma.intentLink.findMany({
    where: { kind: 'mosaic', revoked: false, ...(slugParam ? { id: slugParam } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 24,
  })
  if (links.length === 0) return NextResponse.json({ rows: [] })
  const slugs = links.map((l) => l.id)

  // Fork counts (lineage is social proof) + server-truth money in two
  // grouped reads. Public numbers exclude internal traffic — the standing
  // honesty rule (lib/value-origin): a drill's signed turn must never dress
  // a gallery row up as traction.
  const [forkRows, turnRows] = await Promise.all([
    prisma.intentLink.groupBy({
      by: ['parentSlug'],
      where: { parentSlug: { in: slugs } },
      _count: { _all: true },
    }),
    prisma.embedTurn.groupBy({
      by: ['intentLinkSlug'],
      where: { intentLinkSlug: { in: slugs }, outcome: 'signed', ...REAL_TRAFFIC_WHERE },
      _sum: { valueUsd: true },
      _count: { _all: true },
    }),
  ])
  const forksOf = new Map(forkRows.map((r) => [r.parentSlug, r._count._all]))
  const moneyOf = new Map(turnRows.map((r) => [r.intentLinkSlug, r]))

  const rows = []
  for (const l of links) {
    // Server-side parse so every consumer renders from ONE reading of the
    // sentence. A stored ask that stopped parsing (grammar drift) renders
    // nowhere rather than half — fail closed, and the harness pins the
    // mint→gallery round-trip so this branch stays dead.
    const parsed = parseMosaicAsk(l.ask)
    if (!parsed || 'problem' in parsed) continue
    const money = moneyOf.get(l.id)
    rows.push({
      slug: l.id,
      ask: l.ask,
      slices: parsed.slices,
      chainWord: parsed.chainWord ?? null,
      agent: l.agent,
      createdAt: l.createdAt,
      parentSlug: l.parentSlug,
      forks: forksOf.get(l.id) ?? 0,
      signedUsd: Math.round((money?._sum.valueUsd ?? 0) * 100) / 100,
      signedCount: money?._count._all ?? 0,
    })
  }

  return NextResponse.json({ rows })
}
