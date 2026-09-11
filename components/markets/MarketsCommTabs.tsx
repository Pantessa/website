'use client'

// COMM's STANDALONE mount for the News + Community tabs under today's /t
// chart — so the lane's PR is provable on its own. SHELL owns the real tab
// strip (Overview · News · Community · Technicals · Trade) and the page
// frame; at integration QA swaps this for SHELL's strip and the two tab
// slots re-export NewsTab / CommunityTab. Until then this component:
//   · reads / mirrors `?tab=news|community` (the #705 replaceState idiom —
//     UI state catching the URL up, never a navigation)
//   · shows the headlines the reader put "on the chart" as a strip (today's
//     CandleChart has no marker prop; CHART's MarketChart draws them)

import { useCallback, useEffect, useState } from 'react'
import type { ChartPair } from '@/lib/charts'
import { useChartMarkers, clearChartMarkers } from '@/lib/chart-markers'
import NewsTab from '@/components/markets/news/NewsTab'
import CommunityTab from '@/components/markets/community/CommunityTab'
import './comm.css'

type Tab = 'news' | 'community'
const TABS: { key: Tab; label: string }[] = [
  { key: 'community', label: 'Community' },
  { key: 'news', label: 'News' },
]

function readTab(search: string): Tab {
  const t = new URLSearchParams(search).get('tab')
  return t === 'news' ? 'news' : 'community'
}

export default function MarketsCommTabs({ symbol, pair }: { symbol: string; pair: ChartPair }) {
  const [tab, setTab] = useState<Tab>('community')
  const markers = useChartMarkers(pair.symbol)

  useEffect(() => {
    setTab(readTab(window.location.search))
  }, [])

  const pick = useCallback((t: Tab) => {
    setTab(t)
    const params = new URLSearchParams(window.location.search)
    if (t === 'community') params.delete('tab')
    else params.set('tab', t)
    const q = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`)
  }, [])

  return (
    <section className="mkc" aria-label={`${pair.symbol} news and community`} data-markets-comm>
      <div className="mkc__tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'mkc__tab is-active' : 'mkc__tab'} onClick={() => pick(t.key)}>
            {t.label}
            {t.key === 'news' && markers.length > 0 && <small>{markers.length} on chart</small>}
          </button>
        ))}
      </div>

      {markers.length > 0 && (
        <div className="mkn__marks" aria-label="Headlines pinned to the chart">
          <div className="mkc__head">
            <span className="mkc__eyebrow">On the chart · {markers.length}</span>
            <button type="button" className="mkc__ghost" onClick={() => clearChartMarkers(pair.symbol)}>
              Clear
            </button>
          </div>
          {markers.map((m) => (
            <div key={m.id} className="mkn__markrow">
              <span className="mkn__markt">{new Date(m.t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              <span>{m.label}</span>
            </div>
          ))}
        </div>
      )}

      <div role="tabpanel" hidden={tab !== 'news'}>
        {tab === 'news' && <NewsTab symbol={symbol} pair={pair} />}
      </div>
      <div role="tabpanel" hidden={tab !== 'community'}>
        {tab === 'community' && <CommunityTab symbol={symbol} pair={pair} chartState={null} />}
      </div>
    </section>
  )
}
