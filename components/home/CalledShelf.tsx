// THE CALLED IT SHELF on the home (2026-11-16, Nate: "add our featured scans
// to the home page … and a link to /x"). Three records we chose
// (app/x/_lib/home-shelf HOME_CALLED), drawn as /x's own tiles: who, on what,
// the price line with a dot per call, the tally. A tile opens the live chart
// with the account plotted (lib/called-it/spec chartHref, a public page); the
// head and the foot link to /x, where any handle can be plotted.
//
// A server component, no script: page.tsx reads the records and hands this to
// HomeSurface as the `called` seat. No records → nothing renders (the seat
// leaves no hole).
import Link from 'next/link'
import { Tile } from '@/app/x/_lib/splash'
import type { CalledShelfData } from '@/app/x/_lib/home-shelf'
import { JUDGE_DAYS } from '@/lib/called-it/spec'
import '@/components/called/called-record.css'
import './called-shelf.css'

export default function CalledShelf({ data }: { data: CalledShelfData }) {
  if (!data.summaries.length) return null
  const now = Date.now()
  return (
    <section className="xrc xrc--shelf" aria-labelledby="called-shelf-title" data-called-shelf={data.summaries.length}>
      <header className="xrc-shelf__head">
        <div className="xrc-shelf__say">
          <Link href="/x" className="xrc-shelf__eyebrow" prefetch={false} data-journey="home_called_eyebrow">
            Called it
          </Link>
          <h2 id="called-shelf-title" className="xrc-shelf__title">
            See who actually called it.
          </h2>
          <p className="xrc-shelf__sub">Every market call an X account made, pinned to its day and judged by the price {JUDGE_DAYS} days later.</p>
        </div>
        <Link href="/x" className="xrc-shelf__go" prefetch={false} data-journey="home_called_go">
          Plot any handle<span aria-hidden="true">{' →'}</span>
        </Link>
      </header>
      <ul className="xrc-tiles">
        {data.summaries.map((s, i) => (
          <li key={`${s.handle}:${s.symbol}`}>
            <Tile summary={s} avatar={data.avatars[i] ?? null} now={now} />
          </li>
        ))}
      </ul>
    </section>
  )
}
