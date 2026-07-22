import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Done-state signals for the dashboard "Get started" checklist — the
 * links-first flow (mint a link → share it → watch the funnel → first
 * conversion → claim), each read from what the wallet has actually done
 * rather than self-reported:
 *
 *  · minted    — owns ≥1 live (non-revoked) intent link
 *  · opened    — one of their links has been opened by anyone (the share
 *                landed — funnel stage 1)
 *  · connected — a visitor connected a wallet on one of their links (the
 *                funnel is moving)
 *  · converted — a signed, guardrail-priced turn attributed to one of
 *                their links (server truth: embed_turns, never client
 *                events)
 *  · claimed   — requested (or been paid) a creator earnings claim
 */
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const creator = addr.toLowerCase()

  const links = await prisma.intentLink.findMany({
    where: { creator, revoked: false },
    select: { id: true },
  })
  const slugs = links.map((l) => l.id)

  const [opened, connected, converted, claim] = await Promise.all([
    slugs.length
      ? prisma.intentLinkEvent.findFirst({ where: { slug: { in: slugs }, kind: 'open' }, select: { id: true } })
      : null,
    slugs.length
      ? prisma.intentLinkEvent.findFirst({ where: { slug: { in: slugs }, kind: 'connect' }, select: { id: true } })
      : null,
    slugs.length
      ? prisma.embedTurn.findFirst({
          where: { intentLinkSlug: { in: slugs }, outcome: 'signed', valueUsd: { gt: 0 } },
          select: { id: true },
        })
      : null,
    prisma.intentLinkClaim.findFirst({ where: { creator, status: { in: ['requested', 'paid'] } }, select: { id: true } }),
  ])

  return NextResponse.json({
    minted: slugs.length > 0,
    opened: !!opened,
    connected: !!connected,
    converted: !!converted,
    claimed: !!claim,
  })
}
