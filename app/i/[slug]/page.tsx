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
    return l && !l.revoked ? l : null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const link = await getLink(slug)
  if (!link) return { title: 'Intent link · Yeetful', robots: { index: false, follow: false } }
  const title = `${link.ask} · Yeetful`
  const description =
    'One tap from ask to signed. Yeetful compiles this into guarded transactions — deterministic builders, fail-closed checks, receipts — and your wallet is the only thing that can sign.'
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, siteName: 'Yeetful', type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function IntentLinkPage({ params }: Params) {
  const { slug } = await params
  const link = await getLink(slug)
  if (!link) notFound()
  return (
    <IntentRuntime
      slug={link.id}
      ask={link.ask}
      mcps={link.mcps ?? ''}
      agent={link.agent ?? ''}
      redirectUrl={link.redirectUrl ?? ''}
      hasCreator={!!link.creator}
    />
  )
}
