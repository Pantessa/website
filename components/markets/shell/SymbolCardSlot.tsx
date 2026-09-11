'use client'

// The right-rail symbol card SLOT: what the token is, where it trades, the
// session state, and the feed that answered. COMM pins headlines into it
// and CHART's performance tiles ride here at integration; the venue/session
// block is SHELL's and stays.

import Link from 'next/link'
import type { ChartPair } from '@/lib/charts'
import { CHART_FEED_LABELS, type ChartFeed } from '@/lib/charts'
import { sessionState, symbolName, venueLabel } from '@/lib/markets'

export default function SymbolCardSlot({
  symbol,
  pair,
  feed,
}: {
  symbol: string
  pair: ChartPair | null
  feed: ChartFeed | null
}) {
  const session = sessionState(pair)
  const name = symbolName(symbol)
  return (
    <section className="mkt-card" aria-label={`About ${symbol}`} data-slot="symbol-card">
      <header className="mkt-card__head">
        <h2 className="mkt-card__title">About {symbol}</h2>
        <span className="mkt-card__eyebrow mono">{venueLabel(pair).toUpperCase()}</span>
      </header>
      <dl className="mkt-kv">
        <div>
          <dt>Name</dt>
          <dd>{name}</dd>
        </div>
        <div>
          <dt>Trades</dt>
          <dd>{session.line}</dd>
        </div>
        <div>
          <dt>Candles</dt>
          <dd>{feed ? CHART_FEED_LABELS[feed] ?? feed : pair ? 'loading…' : 'none yet'}</dd>
        </div>
        <div>
          <dt>Custody</dt>
          <dd>Your wallet signs every order. Pantessa never holds funds.</dd>
        </div>
      </dl>
      <p className="mkt-card__note">
        Headlines pinned to bars and performance tiles land here this round.{' '}
        <Link href="/markets" className="mkt-link">
          All markets →
        </Link>
      </p>
    </section>
  )
}
