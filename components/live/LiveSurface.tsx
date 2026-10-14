'use client'

// /live's body: which view the URL asks for. The tape and the battle views
// each own their subscriptions, so switching tabs closes one stream and
// opens the other.

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import type { TradabilityMap } from '@/lib/tradability'
import { isBattleView, parseLiveView } from '@/lib/battle'
import Battle from '@/components/live/Battle'
import LiveFeed from '@/components/live/LiveFeed'
import LiveTabs from '@/components/live/LiveTabs'
import PickReads from '@/components/live/PickReads'

function Surface({ tradable }: { tradable: TradabilityMap }) {
  const params = useSearchParams()
  const view = parseLiveView(params?.get('view'))
  const tabs = <LiveTabs view={view} />
  // The page's ONE watchlist + holdings subscriber for the pick (lib/use-market-pick)
  // sits beside the view, not inside it: a view switch remounts the view, not the reads.
  return (
    <>
      <PickReads />
      {isBattleView(view) ? <Battle key={view} view={view} tradable={tradable} tabs={tabs} /> : <LiveFeed tradable={tradable} tabs={tabs} />}
    </>
  )
}

export default function LiveSurface({ tradable }: { tradable: TradabilityMap }) {
  return (
    <Suspense fallback={<main className="mkt-frame__main live" />}>
      <Surface tradable={tradable} />
    </Suspense>
  )
}
