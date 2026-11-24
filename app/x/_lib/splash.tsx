// The pieces of the /x splash: the plot of one scanned account (a price line
// with a dot per call), the tile that wears it in the grid, the larger panel
// the hero wears, and the scoreline (the tally drawn as one segmented rule).
//
// FLAT (2026-11-16): no card, no shadow, no gradient. Structure is hairlines
// and type; the one mark is the tally's bar (components/sleek/ScoreBar), the same on a tile and in the hero.
//
// Server components, no script. The line is an SVG stretched over a box whose
// height is CSS; each dot is a span placed by percentages, so nothing is
// measured and a dot stays round. A verdict is a colour AND a word everywhere.
import Link from 'next/link'
import ScoreBar from '@/components/sleek/ScoreBar'
import { VERDICT_WORDS, chartHref } from '@/lib/called-it/spec'
import { cleanLine, fmtCount, fmtUtcDate } from '@/lib/called-it/card-layout'
import { agoWords } from './plotted'
import { Avatar } from './parts'
import type { PlotSummary } from './featured'

/** The price line with a dot per call. Decorative: the counts beside it carry the meaning. */
export function Spark({ summary, size }: { summary: PlotSummary; size: 'tile' | 'hero' }) {
  if (!summary.line) return <div className={`xrc-spark xrc-spark--${size} xrc-spark--none`} aria-hidden />
  return (
    <div className={`xrc-spark xrc-spark--${size}`} aria-hidden>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d={`${summary.line}L100 100L0 100Z`} className="xrc-spark__area" />
        <path d={summary.line} className="xrc-spark__line" vectorEffect="non-scaling-stroke" />
      </svg>
      {summary.dots.map((d, i) => (
        <span key={i} className={`xrc-spark__dot is-${d.verdict}${d.picked ? ' is-picked' : ''}`} style={{ left: `${d.x}%`, top: `${d.y}%` }} />
      ))}
    </div>
  )
}

function Who({ summary, avatar, size }: { summary: PlotSummary; avatar: string | null; size: 'sm' | 'md' }) {
  const named = summary.name && summary.name.trim().toLowerCase() !== summary.handle
  return (
    <span className="xrc-who">
      <Avatar uri={avatar} name={summary.name} handle={summary.handle} size={size} />
      <span className="xrc-who__text">
        <span className="xrc-who__name">
          <bdi>{named ? cleanLine(summary.name ?? '', 32) : `@${summary.handle}`}</bdi>
          {summary.verified && <span className="xrc-who__verified">Verified</span>}
        </span>
        <span className="xrc-who__handle">
          {named ? `@${summary.handle}` : null}
          {named && summary.followers ? ' · ' : null}
          {summary.followers ? `${fmtCount(summary.followers)} followers` : null}
        </span>
      </span>
    </span>
  )
}

/** One scanned account in the grid: who, on what, the tally, the line. The whole tile is the link, straight onto the live chart with the account plotted (the chart wears the record's header; Nate, 2026-11-16). */
export function Tile({ summary, avatar, now }: { summary: PlotSummary; avatar: string | null; now: number }) {
  return (
    <Link href={chartHref(summary.handle, summary.symbol)} className="xrc-tile" prefetch={false} data-journey="called_recent" aria-label={summary.headline}>
      <span className="xrc-tile__head">
        <Who summary={summary} avatar={avatar} size="sm" />
        <span className="xrc-tile__sym">{summary.symbol}</span>
      </span>
      <Spark summary={summary} size="tile" />
      {/* The tally as the kit's bar (squad mobile-sleek, round 3): every verdict the scan counted, misses beside hits. */}
      <ScoreBar counts={summary.tally} words={VERDICT_WORDS} />
      <span className="xrc-tile__foot">
        <span className="xrc-tile__total">
          {summary.tally.total} {summary.tally.total === 1 ? 'call' : 'calls'}
        </span>
        <span className="xrc-tile__when">{agoWords(summary.scannedAt, now)}</span>
      </span>
    </Link>
  )
}

/** The hero's panel: one real record, drawn. Its line, its tally and two of its calls in the account's own words. */
export function Featured({ summary, avatar }: { summary: PlotSummary; avatar: string | null }) {
  const href = chartHref(summary.handle, summary.symbol)
  return (
    <section className="xrc-feat" aria-label={`A real record: ${summary.headline}`}>
      <div className="xrc-feat__head">
        <Who summary={summary} avatar={avatar} size="md" />
        <span className="xrc-feat__sym">on {summary.symbol}</span>
      </div>
      <Spark summary={summary} size="hero" />
      {/* The tally as one bar (squad mobile-sleek): every verdict the scan counted has a segment, misses beside hits. */}
      <div className="xrc-feat__tally">
        <p className="xrc-feat__total">
          {summary.tally.total} {summary.tally.total === 1 ? 'call' : 'calls'}
        </p>
        <ScoreBar counts={summary.tally} words={VERDICT_WORDS} size="lg" />
      </div>
      <ul className="xrc-feat__quotes">
        {summary.quotes.map((q) => (
          <li key={q.postId} className={`xrc-quote is-${q.verdict}`}>
            <p className="xrc-quote__text">
              <bdi>{cleanLine(q.text, 150)}</bdi>
            </p>
            <p className="xrc-quote__foot">
              <span className="xrc-quote__verdict">{VERDICT_WORDS[q.verdict]}</span>
              <span className="xrc-quote__move">{q.move}</span>
              <span className="xrc-quote__date">{fmtUtcDate(q.postedAt)}</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="xrc-feat__more">
        {summary.coverage && <span className="xrc-feat__cov">{summary.coverage}</span>}
        <Link href={href} className="xrc-go" prefetch={false} data-journey="called_featured">
          Open on the chart
        </Link>
      </p>
    </section>
  )
}
