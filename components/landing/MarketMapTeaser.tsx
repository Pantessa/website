'use client'

// THE WHOLE INDEX — VIZ's MarketMap slot as a band, with the honest counts
// (computed from the same registry /markets lists, never typed), click →
// the symbol page, CTA → /markets.

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import SpineLink from '@/components/SpineLink'
import MarketMap from '@/components/markets/slots/MarketMap'
import { marketSections } from '@/lib/markets'
import { MAP_TEASER, TAPE_FOOTNOTE, UNLIMITED_LINE } from '@/lib/markets-copy'

export default function MarketMapTeaser() {
  const router = useRouter()
  const counts = useMemo(() => {
    const s = marketSections()
    const n = (id: string) => s.find((x) => x.id === id)?.rows.length ?? 0
    return { stocks: n('equities'), coins: n('crypto'), perps: n('perps') }
  }, [])
  return (
    <section className="lmap" id="index" data-map-teaser>
      <div className="lmap__head">
        <div>
          <span className="lmap__eyebrow mono">{MAP_TEASER.eyebrow}</span>
          <h2 className="lmap__h2">{MAP_TEASER.h2}</h2>
        </div>
        <div className="lmap__counts mono" data-index-counts>
          <span><b>{counts.stocks}</b>{' '}stocks · 24/7</span>
          <span><b>{counts.coins}</b>{' '}coins</span>
          <span><b>{counts.perps}</b>{' '}perps</span>
        </div>
      </div>
      <div className="lmap__map">
        <MarketMap section="all" onOpen={(symbol) => router.push(`/t/${encodeURIComponent(symbol)}`)} />
      </div>
      <div className="lmap__foot">
        <span className="mono">{UNLIMITED_LINE} · {TAPE_FOOTNOTE}</span>
        <SpineLink href="/markets" className="btn btn--sm">
          {MAP_TEASER.cta} <ArrowRight className="w-3 h-3" />
        </SpineLink>
      </div>
    </section>
  )
}
