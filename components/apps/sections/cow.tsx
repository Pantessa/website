'use client'

// COW PROTOCOL on the apps page (squad apps-page, TRADE lane). Limit orders.
//   full: the resting orders with their fill bars and the tile's own row
//         asks (Check status, Cancel), recent fills, and "Place one": a price
//         for what the wallet holds, in the CoW limit grammar the chat builds
//         (`limit order: buy 0.01353 ETH for at most 25 USDC on Base`).
//   side: the count line, the top three orders, or the place-one asks.
//   line: one sentence and one button.
//
// A limit price is never invented: "Place one" prices from Hyperliquid's own
// marks (the same shared read the Hyperliquid section uses). When the marks
// cannot be read, it offers the tile's own suggested asks instead.

import TokenIcon from '@/components/TokenIcon'
import { RowProgress } from '@/components/splash/viz'
import { AppLineRow, AskButton, Fact, FactRow, ListBlock, ListRow, SectionFrame, SectionPending } from '@/components/apps/parts'
import {
  cowChainWord,
  cowHeadline,
  cowLine,
  cowView,
  fmtPrice,
  heldOnCowChains,
  placeRows,
  type CowView,
} from '@/lib/apps-trade'
import type { PageTiles } from '@/lib/apps-page'
import type { SplashTile } from '@/lib/splash/types'
import { useHlMarks } from './hyperliquid'
import type { AppSectionProps, SectionModule } from './types'
import '@/components/apps/trade.css'

function prompts(tiles: SplashTile[]) {
  return tiles.flatMap((t) => t.prompts).filter((p, i, all) => all.findIndex((q) => q.prompt === p.prompt) === i)
}

/** The first token of a pair ("WETH → USDC" → WETH), for its mark. */
const pairLead = (pair: string) => pair.split(/→|->/)[0].trim()

function PlaceOne({ page, tiles, compact, onAsk }: { page: PageTiles; tiles: SplashTile[]; compact?: boolean; onAsk: AppSectionProps['onAsk'] }) {
  const { marks, failed } = useHlMarks()
  const asks = prompts(tiles)
  if (!marks) {
    if (!failed) return <div className="apg-skel apg-skel--short" aria-label="Reading prices" />
    return asks.length > 0 ? (
      <div className="apgt-acts">
        {asks.slice(0, 2).map((a) => (
          <AskButton key={a.prompt} title={a.prompt} onClick={() => onAsk(a.prompt)}>
            {a.label}
          </AskButton>
        ))}
      </div>
    ) : null
  }
  const rows = placeRows(heldOnCowChains(page), marks)
  if (rows.length === 0) return null
  const hasSell = rows.some((r) => r.sell)

  if (compact) {
    return (
      <ListBlock title="Place one" note="5% under the price now">
        {rows.slice(0, 2).map((r) => (
          <ListRow
            key={r.symbol}
            lead={<TokenIcon symbol={r.symbol} size={24} />}
            main={r.symbol}
            sub={<span className="apgt-num">now {fmtPrice(r.price)}</span>}
            actions={
              r.buy ? (
                <AskButton className="apgt-btn-sm" onClick={() => onAsk(r.buy!.ask)} title={r.buy.ask}>
                  Buy at {fmtPrice(r.buy.at)}
                </AskButton>
              ) : undefined
            }
          />
        ))}
      </ListBlock>
    )
  }

  return (
    <div className="apg-list">
      <div className="apg-list__head">
        <span className="apg-eyebrow">Place one</span>
        <span className="apg-list__note">${rows[0].buyUsd} a buy, prices are Hyperliquid marks</span>
      </div>
      <div className={hasSell ? 'apgt-tbl apgt-tbl--place' : 'apgt-tbl apgt-tbl--place3'} role="table" aria-label="Place a limit order">
        <div className="apgt-tbl__row apgt-tbl__head" role="row">
          <span className="apg-eyebrow" role="columnheader">Asset</span>
          <span className="apg-eyebrow apgt-r" role="columnheader">Now</span>
          <span className="apg-eyebrow apgt-r" role="columnheader">Buy 5% lower</span>
          {hasSell && <span className="apg-eyebrow apgt-r" role="columnheader">Sell 10% higher</span>}
          <span role="columnheader" />
        </div>
        {rows.map((r) => (
          <div key={r.symbol} className="apgt-tbl__row" role="row">
            <span className="apgt-mkt" role="cell">
              <TokenIcon symbol={r.symbol} size={28} />
              <span className="apgt-mkt__name">{r.symbol}</span>
            </span>
            <span className="apgt-num apgt-r" role="cell">{fmtPrice(r.price)}</span>
            <span className="apgt-num apgt-r" role="cell">{r.buy ? fmtPrice(r.buy.at) : ''}</span>
            {hasSell && <span className="apgt-num apgt-r" role="cell">{r.sell ? fmtPrice(r.sell.at) : <span className="apgt-muted">not held</span>}</span>}
            <span className="apgt-acts apgt-acts--row" role="cell">
              {r.buy && (
                <AskButton className="apgt-btn-sm" onClick={() => onAsk(r.buy!.ask)} title={r.buy.ask}>
                  Buy
                </AskButton>
              )}
              {r.sell && (
                <AskButton className="apgt-btn-sm" onClick={() => onAsk(r.sell!.ask)} title={r.sell.ask}>
                  Sell
                </AskButton>
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="apgt-small apgt-foot">An order rests until the price gets there. Signing places it, and nothing leaves your wallet until it fills.</p>
    </div>
  )
}

function OrderRows({ v, max, compact, onAsk }: { v: CowView; max: number; compact?: boolean; onAsk: AppSectionProps['onAsk'] }) {
  return (
    <>
      {v.open.slice(0, max).map((o, i) => (
        <ListRow
          key={`${o.pair}-${o.chain}-${i}`}
          lead={<TokenIcon symbol={pairLead(o.pair)} size={28} />}
          main={
            <>
              {o.pair}
              {o.kind && <span className="apgt-small"> · {o.kind}</span>}
            </>
          }
          sub={
            <span className="apgt-ordersub">
              <span>
                {cowChainWord(o.chain) ?? o.chain}
                {compact && o.value ? `, ${o.value}` : ''}
              </span>
              {o.filledPct != null && (
                <span className="apgt-ordersub__bar">
                  <RowProgress pct={o.filledPct} />
                </span>
              )}
            </span>
          }
          value={compact ? undefined : <span className="apgt-num">{o.value}</span>}
          actions={
            o.actions.length > 0 ? (
              <>
                {o.actions.slice(0, compact ? 1 : 2).map((a) => (
                  <AskButton key={a.prompt} className="apgt-btn-sm" onClick={() => onAsk(a.prompt)} title={a.prompt}>
                    {a.label.replace(/ order$/, '')}
                  </AskButton>
                ))}
              </>
            ) : undefined
          }
        />
      ))}
    </>
  )
}

function Fills({ v, onAsk }: { v: CowView; onAsk: AppSectionProps['onAsk'] }) {
  if (v.fills.length === 0) return null
  return (
    <ListBlock title="Recent fills">
      {v.fills.map((f, i) => (
        <ListRow
          key={`${f.pair}-${f.chain}-${i}`}
          lead={<TokenIcon symbol={pairLead(f.pair)} size={28} />}
          main={f.pair}
          sub={`filled on ${cowChainWord(f.chain) ?? f.chain}`}
          actions={
            f.actions[0] ? (
              <AskButton className="apgt-btn-sm" onClick={() => onAsk(f.actions[0].prompt)} title={f.actions[0].prompt}>
                {f.actions[0].label}
              </AskButton>
            ) : undefined
          }
        />
      ))}
    </ListBlock>
  )
}

export function CowSection({ server, tiles, pending, density, page, onAsk, onRetry }: AppSectionProps) {
  if (pending && tiles.length === 0) return <SectionPending server={server} line={density === 'line'} />
  const v = cowView(tiles)
  const resting = v.open.length > 0

  if (density === 'line') {
    const first = v.open[0]
    const check = first?.actions.find((a) => /status/i.test(a.label)) ?? first?.actions[0]
    const fallback = prompts(tiles)[0]
    return (
      <AppLineRow
        server={server}
        tone={resting ? 'ok' : undefined}
        text={cowLine(v)}
        act={
          v.error
            ? { label: 'Try again', onClick: onRetry }
            : check
              ? { label: check.label, onClick: () => onAsk(check.prompt) }
              : fallback
                ? { label: fallback.label, onClick: () => onAsk(fallback.prompt) }
                : null
        }
      />
    )
  }

  const note = resting ? `${v.open.length} resting` : undefined

  if (v.error && !resting) {
    return (
      <SectionFrame server={server} className="apgt">
        <div className="apgt-empty">
          <p>CoW Protocol did not answer just now. Any order you placed is still resting.</p>
          <div className="apgt-acts">
            <AskButton onClick={onRetry}>Try again</AskButton>
          </div>
        </div>
      </SectionFrame>
    )
  }

  if (density === 'side') {
    return (
      <SectionFrame server={server} note={note} className="apgt">
        {resting ? (
          <ListBlock title="Resting orders" note={v.open.length > 3 ? `${v.open.length - 3} more` : undefined}>
            <OrderRows v={v} max={3} compact onAsk={onAsk} />
          </ListBlock>
        ) : (
          <>
            <p className="apgt-lead">No orders resting. Name a price and let it wait.</p>
            <PlaceOne page={page} tiles={tiles} compact onAsk={onAsk} />
          </>
        )}
      </SectionFrame>
    )
  }

  // full
  return (
    <SectionFrame server={server} note="read from CoW Protocol" className="apgt">
      {(resting || v.fills.length > 0 || v.lifetime != null) && (
        <FactRow>
          <Fact value={String(v.open.length)} label={v.open.length === 1 ? 'Resting order' : 'Resting orders'} />
          {v.fills.length > 0 && <Fact value={String(v.fills.length)} label="Recent fills" />}
          {v.lifetime != null && <Fact value={String(v.lifetime)} label="Trades, all time" />}
        </FactRow>
      )}
      <div className="apgt-grid">
        <div className="apgt-col">
          {resting ? (
            <ListBlock title="Resting orders" note="cancelling costs no gas">
              <OrderRows v={v} max={v.open.length} onAsk={onAsk} />
            </ListBlock>
          ) : (
            <div className="apgt-empty">
              <p>
                {v.noHistory
                  ? 'This wallet has no CoW Protocol orders yet. A limit order waits for your price, and placing it costs no gas.'
                  : 'Nothing is resting right now. A limit order waits for your price, and placing it costs no gas.'}
              </p>
            </div>
          )}
          <PlaceOne page={page} tiles={tiles} onAsk={onAsk} />
        </div>
        <aside className="apgt-col apgt-col--side">
          <Fills v={v} onAsk={onAsk} />
          {prompts(tiles).length > 0 && (
            <div className="apgt-acts">
              {prompts(tiles)
                .slice(0, 2)
                .map((a) => (
                  <AskButton key={a.prompt} title={a.prompt} onClick={() => onAsk(a.prompt)}>
                    {a.label}
                  </AskButton>
                ))}
            </div>
          )}
        </aside>
      </div>
    </SectionFrame>
  )
}

const mod: SectionModule = {
  Section: CowSection,
  headline: ({ tiles }) => (tiles.length === 0 ? null : cowHeadline(cowView(tiles))),
  quiet: ({ tiles }) => {
    const v = cowView(tiles)
    return !v.error && v.open.length === 0
  },
}
export default mod
