import { SHARE_BAND } from '@/lib/markets-copy'

// The below-fold hand-off head: links + the embed are the distribution
// story ("share a trade / embed the chart"). Server, zero JS.
export default function ShareBand() {
  return (
    <div className="lsh" data-share-band>
      <span className="lsh__eyebrow mono">{SHARE_BAND.eyebrow}</span>
      <h2 className="lsh__h2">{SHARE_BAND.h2}</h2>
    </div>
  )
}
