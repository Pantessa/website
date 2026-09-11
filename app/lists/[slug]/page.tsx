import type { Metadata } from 'next'
import SpineLink from '@/components/SpineLink'
import { notFound } from 'next/navigation'
import Footer from '@/components/Footer'
import TokenIcon from '@/components/TokenIcon'
import FollowListButton from '@/components/markets/watchlist/FollowListButton'
import { chartPairFor } from '@/lib/charts'
import { readQuotes } from '@/lib/quotes'
import { fmtQuotePrice, sectionedRows, symbolName } from '@/lib/watchlists'
import { publicWatchlistBySlug } from '@/lib/watchlists-store'

// /lists/<slug> — a shared watchlist as a social object (BUSINESS-MODEL
// §4: shareable, followable, forkable, free). Server-rendered with live
// quotes; every row links to its symbol page and carries a Buy chip that
// PREFILLS chat (a URL never fires a turn). The read fences BOTH is_public
// and NOT is_internal (lib/watchlists-store publicWatchlistBySlug) — a
// harness list can never be a page here. `/w/` is the wallet briefing;
// lists live at `/lists/`.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const list = await publicWatchlistBySlug(slug)
  if (!list) return { title: 'List not found — Pantessa' }
  const title = `${list.name} — a Pantessa watchlist`
  const description = `${list.symbols.length} symbols: ${list.symbols.slice(0, 8).join(', ')}${list.symbols.length > 8 ? '…' : ''}. Live quotes, and every row trades from one sentence — your wallet signs.`
  return { title, description, openGraph: { title, description } }
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export default async function PublicListPage({ params }: Params) {
  const { slug } = await params
  const list = await publicWatchlistBySlug(slug)
  if (!list) notFound()
  const { quotes } = await readQuotes(list.symbols).catch(() => ({ quotes: {} as Record<string, never> }))
  const groups = sectionedRows(list)
  return (
    <>
      <main className="x-main">
        <div className="lists">
          <div className="lists__eyebrow mono">Public watchlist{list.forkOf ? ` · followed from /lists/${list.forkOf}` : ''}</div>
          <h1 className="lists__title">{list.name}</h1>
          <div className="lists__meta">
            <span className="mono">{list.symbols.length} symbols</span>
            <span className="mono">{list.followers} following</span>
            <span className="mono" title={list.owner ?? ''}>by {list.owner ? short(list.owner) : 'guest'}</span>
            <span className="ml-auto">
              <FollowListButton slug={slug} owner={list.owner ?? ''} />
            </span>
          </div>
          <div className="lists__table">
            {groups.map((g) => (
              <div key={g.name ?? '__tail'}>
                {g.name && <div className="lists__section">{g.name}</div>}
                {g.symbols.map((sym) => {
                  const q = quotes[sym]
                  const pair = chartPairFor(sym)
                  const cls = q ? (q.chgPct > 0 ? ' lists__chg--up' : q.chgPct < 0 ? ' lists__chg--down' : '') : ''
                  return (
                    <SpineLink key={sym} href={`/t/${sym}`} className="lists__row" data-symbol={sym}>
                      <TokenIcon symbol={sym} size={22} {...(pair?.source === 'robinhood' ? { chain: 'Robinhood Chain' } : {})} />
                      <span className="min-w-0">
                        <span className="lists__sym">{sym}</span>
                        <span className="lists__name">{pair ? symbolName(sym) : 'no chart yet'}</span>
                      </span>
                      <span className="lists__last">{q ? `$${fmtQuotePrice(q.last)}` : '—'}</span>
                      <span className={`lists__chg${cls}`}>{q ? `${q.chgPct > 0 ? '+' : ''}${q.chgPct.toFixed(2)}%` : ''}</span>
                      <span className="wl__chip wl__chip--accent" title="prefills chat · you send it">
                        Buy $10
                      </span>
                    </SpineLink>
                  )
                })}
              </div>
            ))}
            {list.symbols.length === 0 && <div className="lists__row">This list is empty.</div>}
          </div>
          <p className="lists__foot">
            Follow copies these symbols into your own lists — unlimited lists, tickers and alerts, free at every tier.
            Every row opens its live chart; a Buy chip prefills one sentence in chat, and nothing moves until your wallet signs.{' '}
            <SpineLink href="/markets" className="wl__link">
              Markets →
            </SpineLink>
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}
