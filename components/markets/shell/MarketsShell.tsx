import AppSpine from '@/components/AppSpine'
import { FRAME_ATTR, SCROLL_ATTR } from '@/lib/phone-shell'
import '@/components/markets/look.css'
import '@/components/markets/markets.css'

// The markets shell (2026-09-11, Nate: "add the sidebar we have in the app
// on the left in market and asset view and remove the header nav") — the
// app's spine stands beside the /markets frame the way it stands beside the
// chat and the dashboard, and IS the navigation here: the brochure nav
// returns null on every markets path (Navigation → isMarketsPath), and the
// nav's Ask button + account control dock in the frame's side column
// (MarketsTopStrip). Same shape as .dashshell: a flex row, the spine sticky
// and viewport-tall, the frame taking the rest.
//
// Below lg this is a PHONE FRAME (squad mobile-native, 2026-09-24; app/
// native-shell.css): the shell is the frame (data-app-frame), the .mkt-frame
// grid is its ONE scroller (data-app-scroll — its sticky strips stick to it),
// and the spine's tab bar is the frame's last row, in flow. The document
// never scrolls, so Safari's toolbar never collapses and the bar never
// drifts. No bottom reserve: the scroller ends where the bar begins.
export default function MarketsShell({ sym = false, children }: { sym?: boolean; children: React.ReactNode }) {
  const frame = { [FRAME_ATTR]: '' }
  const scroll = { [SCROLL_ATTR]: '' }
  return (
    <div className="mkt-shell" {...frame}>
      <AppSpine surface="markets" />
      <div className={sym ? 'mkt-frame mkt-frame--sym' : 'mkt-frame'} {...scroll}>
        {children}
      </div>
    </div>
  )
}
