import MarketsShell from '@/components/markets/shell/MarketsShell'
import './skeleton.css'

// Route skeletons (squad pre-gtm POLISH, 2026-10-07): what every loading.tsx a
// stranger can reach renders. Server components, no client JS — they paint
// before hydration. Each wears the page's own silhouette so the real page
// lands in place (no layout jump), says in words what is loading (the
// polite live region), and never spins forever: Next swaps it out the moment
// the segment resolves, and a failure falls to app/error.tsx's named state.
//
// Deliberately NOT on /i /l /p /r /w /lists /c: a loading boundary makes Next
// send the 200 shell before the page runs, so a dead slug's notFound() would
// answer 200 instead of 404 (measured on a prod build). Those pages are direct
// arrivals from outside anyway; the 404 is worth more than the shimmer.

const Bar = ({ w, h, kind }: { w: string | number; h?: number; kind?: 'title' | 'chip' | 'block' }) => (
  <span
    aria-hidden
    className={`skel__bar${kind ? ` skel__bar--${kind}` : ''}`}
    style={{ width: typeof w === 'number' ? `${w}px` : w, ...(h ? { height: h } : {}) }}
  />
)

/** The markets frame's docked side column, at rest. */
function SideColumn() {
  return (
    <div className="skel__side skel" aria-hidden>
      <div className="skel__side-top">
        <Bar w={120} kind="chip" />
        <Bar w={92} kind="chip" />
      </div>
      <div className="skel__side-rows">
        <Bar w="40%" />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="skel__row" style={{ justifyContent: 'space-between' }}>
            <Bar w={56 + ((i * 17) % 40)} />
            <Bar w={64} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** /t/<symbol>: header + price, the act strip, the tab strip, the chart card. */
export function SymbolSkeleton() {
  return (
    <MarketsShell sym>
      <main className="sym skel skel--sym" aria-busy="true">
        <p className="sr-only" role="status">Loading the chart…</p>
        <div className="skel__head">
          <div className="skel__stack">
            <Bar w={110} />
            <Bar w={220} kind="title" />
          </div>
          <div className="skel__stack" style={{ alignItems: 'flex-end' }}>
            <Bar w={150} kind="title" />
            <Bar w={90} />
          </div>
        </div>
        <div className="skel__row">
          <Bar w={108} kind="chip" />
          <Bar w={108} kind="chip" />
          <Bar w={132} kind="chip" />
        </div>
        <div className="skel__tabs">
          {[78, 58, 92, 96, 62].map((w, i) => <Bar key={i} w={w} h={16} />)}
        </div>
        <div className="skel__bar skel__bar--block skel__chart" aria-hidden />
      </main>
      <SideColumn />
    </MarketsShell>
  )
}

/** /live (and any markets-frame board): tab strip, the chart band, rows. */
export function BoardSkeleton({ said = 'Opening the live tape' }: { said?: string }) {
  return (
    <MarketsShell>
      <main className="mkt-frame__main skel skel--board" aria-busy="true">
        <p className="sr-only" role="status">{said}…</p>
        <div className="skel__row" style={{ justifyContent: 'space-between' }}>
          <span className="skel__said">{said}</span>
          <div className="skel__row">
            {[64, 64, 64, 56].map((w, i) => <Bar key={i} w={w} kind="chip" />)}
          </div>
        </div>
        <div className="skel__bar skel__bar--block skel__band" aria-hidden />
        <div className="skel__row">
          {[1, 2, 3, 4, 5].map((i) => <Bar key={i} w="calc(20% - 8px)" h={58} kind="block" />)}
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skel__row" style={{ justifyContent: 'space-between' }}>
            <Bar w={`${28 + ((i * 13) % 30)}%`} />
            <Bar w={96} kind="chip" />
          </div>
        ))}
      </main>
      <SideColumn />
    </MarketsShell>
  )
}
