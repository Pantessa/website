import type { Metadata } from 'next'
import { Analytics } from '@/components/progress/Analytics'
import { ProgressFrame, ProgressHead } from '@/components/progress/ProgressFrame'
import { ANALYTICS_HREF, parseWindow, shareLine } from '@/lib/progress'
import { readAnalytics } from '@/lib/progress-read'

// /analytics — public (2026-10-15, see app/leaderboard/page.tsx): the whole
// system's progress in numbers — money and links by day, the strangers'
// funnel, venues, chains, the fee split. Aggregates only; cached two minutes
// per window. The ANALYTICS seat on the spine lights here.

const TITLE = 'Analytics — the whole system, in the open'
const DESCRIPTION =
  'Money moved through Pantessa by day, links minted and signed through, new wallets step by step, where the money went by venue and chain, and where the fees go. Public, receipt-verified, our own traffic excluded.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Pantessa', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const w = parseWindow((await searchParams).w)
  const data = await readAnalytics(w)
  return (
    <ProgressFrame surface="analytics">
      <ProgressHead
        eyebrow="Analytics"
        title="The system, in the open"
        sub="Every number here is public and comes from signed, receipt-verified transactions. Watch it move, and move it."
        base={ANALYTICS_HREF}
        window={w}
        shareText={shareLine(data.totals.movedUsd, w)}
      />
      <Analytics data={data} />
    </ProgressFrame>
  )
}
