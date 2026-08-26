import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import prisma from '@/lib/db'
import { brandFromRow } from '@/lib/brand-denylist'
import { INTENT_SLUG_RE } from '@/lib/intent-links'
import { notifyEligible } from '@/lib/broker-webhook'
import { MANDATE_KIND_LABELS, type MandateKind } from '@/lib/roster-client'
import IntentRuntime from '@/components/IntentRuntime'

// /i/<slug> — an intent link's runtime. The link row carries the ASK (a
// sentence, sanitized at mint) + the composed MCP set + an optional
// mint-time redirect. "Connect & build" is the consent: once a wallet is
// connected the ask runs through the chat machinery immediately — scan,
// plan, guarded build — and the wallet signs or nothing happens.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

async function getLink(slug: string) {
  if (!INTENT_SLUG_RE.test(slug)) return null
  try {
    const l = await prisma.intentLink.findUnique({ where: { id: slug } })
    if (!l || l.revoked) return null
    // Expiry: a dead promo behaves exactly like a revoked link.
    if (l.expiresAt && l.expiresAt.getTime() <= Date.now()) return null
    // Sign cap: SERVER-TRUTH signs only (guardrail-priced embed_turns) —
    // client-reported funnel events can neither burn nor extend the cap.
    if (l.maxSigns !== null) {
      const signs = await prisma.embedTurn.count({ where: { intentLinkSlug: slug, outcome: 'signed' } })
      if (signs >= l.maxSigns) return null
    }
    return l
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const link = await getLink(slug)
  if (!link) return { title: 'Intent link · Pantessa', robots: { index: false, follow: false } }
  const title = `${link.ask} · Pantessa`
  const description =
    'One tap from ask to signed. Pantessa compiles this into guarded transactions — deterministic builders, fail-closed checks, receipts — and your wallet is the only thing that can sign.'
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, siteName: 'Pantessa', type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/** U2 — the closed loop, named on the receipt. When this link is DESK-BOUND
 *  (a broker intent minted it) or addressed (M5 senderLabel), the sender
 *  learns about the signature: via the M3 webhook when a callback is bound
 *  (push), else via broker_status server truth (feed). The runtime shows the
 *  honest variant after signing; only a label + mode cross the wire — never
 *  the callback URL. */
async function getNotify(link: { id: string; senderLabel: string | null; agent: string | null }) {
  try {
    const intent = await prisma.brokerIntent.findFirst({
      where: { linkSlug: link.id },
      select: { callbackUrl: true, agent: true, isInternal: true },
    })
    const label = link.senderLabel ?? intent?.agent ?? link.agent
    if (!intent && !link.senderLabel) return null
    // Stamped intents never notify (R2) — the push claim rides the same
    // rule as the webhook itself (lib/broker-webhook notifyEligible).
    return { label: label ?? 'The agent that sent this', push: notifyEligible(intent) }
  } catch {
    return null
  }
}

/** THE ROSTER (R2): a proposal from a HIRED agent wears its mandate on the
 *  runtime header — kind + the canonical (grammar-constrained) sentence +
 *  the cap the wallet consented to. DB-stored text only, never a query
 *  param (threat T2). */
async function getRosterBadge(rosterSlotId: string | null) {
  if (!rosterSlotId) return null
  try {
    const slot = await prisma.rosterSlot.findUnique({
      where: { id: rosterSlotId },
      select: { mandateText: true, mandateKind: true, capUsd: true },
    })
    if (!slot) return null
    return {
      label: MANDATE_KIND_LABELS[slot.mandateKind as MandateKind] ?? slot.mandateKind,
      mandate: slot.mandateText.slice(0, 120),
      capUsd: slot.capUsd,
    }
  } catch {
    return null
  }
}

/** The creator's white-label brand (creator_handles) — the splash wears it,
 *  powered by Pantessa. House links (creator=null) stay pure Pantessa. */
async function getBrand(creator: string | null): Promise<{ brand: ReturnType<typeof brandFromRow>; handle: string | null }> {
  if (!creator) return { brand: null, handle: null }
  try {
    const row = await prisma.creatorHandle.findUnique({ where: { creator } })
    // (rule 7: a denied third-party brand renders as house — lib/brand-denylist)
    // The claimed handle rides too: the eyebrow says WHOSE (From @handle),
    // mirroring the OG card, without any brand scan.
    return { brand: brandFromRow(row), handle: row?.handle ?? null }
  } catch {
    return { brand: null, handle: null }
  }
}

export default async function IntentLinkPage({ params }: Params) {
  const { slug } = await params
  const link = await getLink(slug)
  if (!link) notFound()
  const { brand, handle: creatorHandle } = await getBrand(link.creator)
  const notify = await getNotify(link)
  const roster = await getRosterBadge(link.rosterSlotId)
  // A/B: one phrasing per visit, picked server-side (index 0 = the base
  // ask). The chosen phrasing IS the ask for this visit — every runtime
  // gate (transfer shape included) applies to what's actually shown — and
  // the funnel events carry the index so the creator sees which phrasing
  // converts. Metadata above stays on the base ask (stable OG card).
  const phrasings = [link.ask, ...link.variants]
  const variant = Math.floor(Math.random() * phrasings.length)
  return (
    <IntentRuntime
      slug={link.id}
      ask={phrasings[variant]}
      variant={variant}
      mcps={link.mcps ?? ''}
      agent={link.agent ?? ''}
      redirectUrl={link.redirectUrl ?? ''}
      hasCreator={!!link.creator}
      creatorHandle={creatorHandle}
      restricted={link.allowWallets.length > 0}
      brand={brand}
      notify={notify}
      roster={roster}
    />
  )
}
