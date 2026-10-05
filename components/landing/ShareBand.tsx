import { SHARE_BAND } from '@/lib/markets-copy'
import ShareActions from '@/components/ShareActions'
import { sitePost } from '@/lib/share-posts'

// The below-fold hand-off head: links + the embed are the distribution
// story ("share a trade / embed the chart"). Server; the share row is the
// one client child.
export default function ShareBand() {
  return (
    <div className="lsh" data-share-band>
      <span className="lsh__eyebrow mono">{SHARE_BAND.eyebrow}</span>
      <h2 className="lsh__h2">{SHARE_BAND.h2}</h2>
      {/* The band that talks about sharing lets you do it: the site itself,
          one tap (the phone's sheet, copy, or the pre-written post). */}
      <ShareActions post={sitePost()} surface="landing" className="mt-5 justify-center" />
    </div>
  )
}
