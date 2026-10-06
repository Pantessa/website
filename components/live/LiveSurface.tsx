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

function Surface({ tradable }: { tradable: TradabilityMap }) {
  const params = useSearchParams()
  const view = parseLiveView(params?.get('view'))
  const tabs = <LiveTabs view={view} />
  if (isBattleView(view)) return <Battle key={view} view={view} tradable={tradable} tabs={tabs} />
  return <LiveFeed tradable={tradable} tabs={tabs} />
}

export default function LiveSurface({ tradable }: { tradable: TradabilityMap }) {
  return (
    <Suspense fallback={<main className="mkt-frame__main live" />}>
      <Surface tradable={tradable} />
    </Suspense>
  )
}
