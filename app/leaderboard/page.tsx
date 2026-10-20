import type { Metadata } from 'next'
import { Leaderboard } from '@/components/progress/Leaderboard'
import { ProgressFrame, ProgressHead } from '@/components/progress/ProgressFrame'
import { LEADERBOARD_HREF, parseWindow, shareLine } from '@/lib/progress'
import { readLeaderboard } from '@/lib/progress-read'

// /leaderboard — public (2026-10-15, Nate: "a leaderboard, and analytics tab
// for the public pages … showing progress and encourage link sharing and
// money moved by users and the overall system"). The app spine is the
// navigation (LEADERS seat lit), looking needs no wallet (lib/app-entry
// isPublicAppPath via lib/progress isProgressPath), every action goes through
// the side column's doors. Reads are cached two minutes per window.

const TITLE = 'Leaderboard — money moved by links, creators and wallets'
const DESCRIPTION =
  'Who is moving money through Pantessa: the intent links that moved the most, the creators behind them, and the wallets that signed. Every dollar is a signed, receipt-verified transaction — our own test traffic is excluded by construction.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Pantessa', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const w = parseWindow((await searchParams).w)
  const data = await readLeaderboard(w)
  return (
    <ProgressFrame surface="leaderboard">
      <ProgressHead
        eyebrow="Leaderboard"
        title="Who moved the money"
        sub="The links that moved the most, the creators behind them, and the wallets that signed. Mint a link, share it, and your row shows up here."
        base={LEADERBOARD_HREF}
        window={w}
        shareText={shareLine(data.totals.movedUsd, w)}
      />
      <Leaderboard data={data} />
    </ProgressFrame>
  )
}
