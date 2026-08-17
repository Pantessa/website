import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import prisma from '@/lib/db'
import { INTENT_SLUG_RE } from '@/lib/intent-links'
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
      select: { callbackUrl: true, agent: true },
    })
    const label = link.senderLabel ?? intent?.agent ?? link.agent
    if (!intent && !link.senderLabel) return null
    return { label: label ?? 'The agent that sent this', push: !!intent?.callbackUrl }
  } catch {
    return null
  }
}

/** The creator's white-label brand (creator_handles) — the splash wears it,
 *  powered by Pantessa. House links (creator=null) stay pure Pantessa. */
async function getBrand(creator: string | null) {
  if (!creator) return null
  try {
    const row = await prisma.creatorHandle.findUnique({ where: { creator } })
    if (!row || !(row.brandDomain || row.brandLogo || row.brandAccent || row.brandBg)) return null
    return { domain: row.brandDomain, name: row.brandName, logo: row.brandLogo, accent: row.brandAccent, bg: row.brandBg }
  } catch {
    return null
  }
}

export default async function IntentLinkPage({ params }: Params) {
  const { slug } = await params
  const link = await getLink(slug)
  if (!link) notFound()
  const brand = await getBrand(link.creator)
  const notify = await getNotify(link)
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
      restricted={link.allowWallets.length > 0}
      brand={brand}
      notify={notify}
    />
  )
}
