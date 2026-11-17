'use client'

// HYPERLIQUID on the apps page (squad apps-page, TRADE lane). Perps.
//   full: facts from the account (value, positions, PnL, the closest
//         liquidation), the positions with their own Close / Protect asks,
//         and the venue's busiest markets so the app is useful with nothing
//         open (mark, today's move, funding as a yearly percent, Long / Short).
//   side: the account line and the top positions, or the top markets.
//   line: one sentence and one button.
//
// The markets come from Hyperliquid's own keyless info API, read in the
// browser exactly as /live reads it (lib/battle-feed readArmyContexts): no
// key, no route of ours, no wallet address in the request. One read per tab
// per 45 seconds, shared by every section that asks (CoW prices its "place
// one" asks from the same marks).

import { useEffect, useState } from 'react'
import TokenIcon from '@/components/TokenIcon'
import { AppLineRow, AskButton, Fact, FactRow, ListBlock, ListRow, SectionFrame, SectionPending } from '@/components/apps/parts'
import { readArmyContexts } from '@/lib/battle-feed'
import type { ArmyContext } from '@/lib/battle'
import { followAsk } from '@/lib/tape'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useTradable } from '@/lib/use-tradable'
import {
  fmtCompactUsd,
  fmtFundingYearly,
  fmtPrice,
  fmtSignedPct,
  fmtUsdPlain,
  hlClosestLiq,
  hlCloseAsk,
  hlHeadline,
  hlLine,
  hlProtectAsk,
  hlTotalPnl,
  hlView,
  topHlMarkets,
  type HlMarketRow,
  type HlPositionItem,
  type HlView,
} from '@/lib/apps-trade'
import type { SplashTile } from '@/lib/splash/types'
import type { AppSectionProps, SectionModule } from './types'
import '@/components/apps/trade.css'

// ── The venue's marks, shared per tab ────────────────────────────────────────

const MARKS_TTL_MS = 45_000
let marksCache: { at: number; map: Map<string, ArmyContext> } | null = null
let marksInflight: Promise<Map<string, ArmyContext> | null> | null = null

function readMarks(): Promise<Map<string, ArmyContext> | null> {
  if (marksCache && Date.now() - marksCache.at < MARKS_TTL_MS) return Promise.resolve(marksCache.map)
  if (marksInflight) return marksInflight
  marksInflight = readArmyContexts()
    .then((map) => {
      if (map.size > 0) marksCache = { at: Date.now(), map }
      return map.size > 0 ? map : marksCache?.map ?? null
    })
    .catch(() => marksCache?.map ?? null)
    .finally(() => {
      marksInflight = null
    })
  return marksInflight
}

/** Hyperliquid's context row per market (mark, prev-day, funding, volume),
 *  or null while reading; `failed` once a read came back empty. */
export function useHlMarks(): { marks: Map<string, ArmyContext> | null; failed: boolean } {
  const [marks, setMarks] = useState<Map<string, ArmyContext> | null>(() => marksCache?.map ?? null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    const pull = () =>
      void readMarks().then((m) => {
        if (!live) return
        if (m) setMarks(m)
        else setFailed(true)
      })
    pull()
    const tick = setInterval(() => {
      if (!document.hidden) pull()
    }, MARKS_TTL_MS)
    return () => {
      live = false
      clearInterval(tick)
    }
  }, [])
  return { marks, failed }
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function prompts(tiles: SplashTile[]) {
  return tiles.flatMap((t) => t.prompts).filter((p, i, all) => all.findIndex((q) => q.prompt === p.prompt) === i)
}

function liqTone(pct: number | null): string {
  if (pct == null) return 'apgt-muted'
  return pct < 10 ? 'apgt-neg' : pct < 25 ? 'apgt-warn' : 'apgt-pos'
}

function PnlBar({ pnl, maxAbs }: { pnl: number; maxAbs: number }) {
  const w = maxAbs > 0 ? (Math.abs(pnl) / maxAbs) * 50 : 0
  return (
    <span className="apgt-pnlbar" aria-hidden>
      <span className="apgt-pnlbar__mid" />
      <span className={pnl >= 0 ? 'apgt-pnlbar__fill apgt-pnlbar__fill--pos' : 'apgt-pnlbar__fill apgt-pnlbar__fill--neg'} style={pnl >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} />
    </span>
  )
}

function signedUsd(n: number): string {
  return `${n >= 0 ? '+' : '-'}${fmtUsdPlain(Math.abs(n))}`
}

/** The positions table (full): market, value, PnL with its bar, liquidation
 *  distance, and the row's own asks. */
function PositionsTable({ positions, onAsk }: { positions: HlPositionItem[]; onAsk: AppSectionProps['onAsk'] }) {
  const maxAbs = Math.max(...positions.map((p) => Math.abs(p.pnlUsd)), 0.01)
  return (
    <div className="apgt-tbl apgt-tbl--pos" role="table" aria-label="Open positions">
      <div className="apgt-tbl__row apgt-tbl__head" role="row">
        <span className="apg-eyebrow" role="columnheader">Position</span>
        <span className="apg-eyebrow apgt-r" role="columnheader">Value</span>
        <span className="apg-eyebrow apgt-r" role="columnheader">PnL</span>
        <span className="apg-eyebrow apgt-r apgt-hide-n" role="columnheader">To liquidation</span>
        <span role="columnheader" />
      </div>
      {positions.map((p) => (
        <div key={`${p.coin}-${p.side}`} className="apgt-tbl__row" role="row">
          <span className="apgt-mkt" role="cell">
            <TokenIcon symbol={p.coin} size={28} />
            <span className="apgt-mkt__text">
              <span className="apgt-mkt__name">{p.coin}</span>
              <span className="apgt-small">
                {p.side === 'long' ? 'Long' : 'Short'}
                {p.leverage ? `, ${p.leverage}x` : ''}
              </span>
            </span>
          </span>
          <span className="apgt-num apgt-r" role="cell">{fmtUsdPlain(p.valueUsd)}</span>
          <span className="apgt-pnl" role="cell">
            <PnlBar pnl={p.pnlUsd} maxAbs={maxAbs} />
            <span className={`apgt-num ${p.pnlUsd >= 0 ? 'apgt-pos' : 'apgt-neg'}`}>{signedUsd(p.pnlUsd)}</span>
          </span>
          <span className={`apgt-num apgt-r apgt-hide-n ${liqTone(p.liqDistancePct)}`} role="cell">
            {p.liqDistancePct == null ? 'none' : `${p.liqDistancePct.toFixed(1)}% away`}
          </span>
          <span className="apgt-acts apgt-acts--row" role="cell">
            <AskButton className="apgt-btn-sm" onClick={() => onAsk(hlProtectAsk(p))} title={hlProtectAsk(p)}>
              Protect
            </AskButton>
            <AskButton className="apgt-btn-sm" onClick={() => onAsk(hlCloseAsk(p))} title={hlCloseAsk(p)}>
              Close
            </AskButton>
          </span>
        </div>
      ))}
    </div>
  )
}

/** The Long / Short asks a market row offers, in the grammar the perp layer
 *  builds (lib/tape followAsk), only where the venue gate allows. */
function useMarketAsks() {
  const tradable = useTradable()
  return (coin: string) => {
    const long = followAsk({ market: coin, side: 'buy' })
    const short = followAsk({ market: coin, side: 'sell' })
    return {
      long: long && long.venue === 'hyperliquid' && canTradeAsk(long.ask, tradable) ? long.ask : null,
      short: short && short.venue === 'hyperliquid' && canTradeAsk(short.ask, tradable) ? short.ask : null,
    }
  }
}

function MarketsTable({ rows, onAsk }: { rows: HlMarketRow[]; onAsk: AppSectionProps['onAsk'] }) {
  const asksFor = useMarketAsks()
  return (
    <div className="apgt-tbl apgt-tbl--mkt" role="table" aria-label="Markets">
      <div className="apgt-tbl__row apgt-tbl__head" role="row">
        <span className="apg-eyebrow" role="columnheader">Market</span>
        <span className="apg-eyebrow apgt-r" role="columnheader">Price</span>
        <span className="apg-eyebrow apgt-r" role="columnheader">Today</span>
        <span className="apg-eyebrow apgt-r apgt-hide-n" role="columnheader">Funding</span>
        <span role="columnheader" />
      </div>
      {rows.map((m) => {
        const a = asksFor(m.coin)
        return (
          <div key={m.coin} className="apgt-tbl__row" role="row">
            <span className="apgt-mkt" role="cell">
              <TokenIcon symbol={m.coin} size={28} />
              <span className="apgt-mkt__text">
                <span className="apgt-mkt__name">{m.coin}</span>
                <span className="apgt-small">{fmtCompactUsd(m.volumeUsd)} traded today</span>
              </span>
            </span>
            <span className="apgt-num apgt-r" role="cell">{fmtPrice(m.mark)}</span>
            <span className={`apgt-num apgt-r ${m.changePct == null ? '' : m.changePct >= 0 ? 'apgt-pos' : 'apgt-neg'}`} role="cell">
              {fmtSignedPct(m.changePct)}
            </span>
            <span className="apgt-num apgt-r apgt-hide-n" role="cell" title={m.fundingPerHour >= 0 ? 'paid by longs to shorts' : 'paid by shorts to longs'}>
              {fmtFundingYearly(m.fundingPerHour)}
            </span>
            <span className="apgt-acts apgt-acts--row" role="cell">
              {a.long && (
                <AskButton className="apgt-btn-sm" onClick={() => onAsk(a.long!)} title={a.long}>
                  Long
                </AskButton>
              )}
              {a.short && (
                <AskButton className="apgt-btn-sm" onClick={() => onAsk(a.short!)} title={a.short}>
                  Short
                </AskButton>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function MarketsBlock({ n, compact, onAsk }: { n: number; compact?: boolean; onAsk: AppSectionProps['onAsk'] }) {
  const { marks, failed } = useHlMarks()
  const asksFor = useMarketAsks()
  if (!marks) {
    if (failed) return <p className="apgt-small">The markets list could not be read just now. Ask the chat for any market by name.</p>
    return <div className="apg-skel apg-skel--block" aria-label="Reading the markets" />
  }
  const rows = topHlMarkets(marks, n)
  if (rows.length === 0) return null
  if (compact) {
    return (
      <ListBlock title="Busiest markets" note="Hyperliquid, live">
        {rows.map((m) => {
          const a = asksFor(m.coin)
          return (
            <ListRow
              key={m.coin}
              lead={<TokenIcon symbol={m.coin} size={24} />}
              main={m.coin}
              sub={
                <span className="apgt-num">
                  {fmtPrice(m.mark)}{' '}
                  <span className={m.changePct == null ? '' : m.changePct >= 0 ? 'apgt-pos' : 'apgt-neg'}>{fmtSignedPct(m.changePct)}</span>
                </span>
              }
              actions={
                a.long ? (
                  <AskButton className="apgt-btn-sm" onClick={() => onAsk(a.long!)} title={a.long}>
                    Long
                  </AskButton>
                ) : undefined
              }
            />
          )
        })}
      </ListBlock>
    )
  }
  return (
    <div className="apg-list">
      <div className="apg-list__head">
        <span className="apg-eyebrow">Busiest markets</span>
        <span className="apg-list__note">{rows.length} by volume today, live from Hyperliquid</span>
      </div>
      <MarketsTable rows={rows} onAsk={onAsk} />
      <p className="apgt-small apgt-foot">Each button builds a $25 order in the chat for your wallet to sign. Ask for any other market by name.</p>
    </div>
  )
}

function Facts({ v }: { v: HlView }) {
  const pnl = hlTotalPnl(v.positions)
  const liq = hlClosestLiq(v.positions)
  return (
    <FactRow>
      {v.accountUsd != null && <Fact value={fmtUsdPlain(v.accountUsd)} label="Account value" />}
      <Fact value={String(v.positions.length)} label={v.positions.length === 1 ? 'Open position' : 'Open positions'} />
      {pnl != null && <Fact value={signedUsd(pnl)} label="Unrealized PnL" tone={pnl >= 0 ? 'pos' : 'neg'} />}
      {liq && <Fact value={`${liq.pct.toFixed(1)}%`} label="Closest liquidation" sub={`${liq.coin}, from the mark`} />}
    </FactRow>
  )
}

function GetStarted({ v, tiles, onAsk, onRetry }: { v: HlView; tiles: SplashTile[]; onAsk: AppSectionProps['onAsk']; onRetry: () => void }) {
  if (v.error) {
    return (
      <div className="apgt-empty">
        <p>Hyperliquid did not answer just now. Your positions are unchanged on the venue.</p>
        <div className="apgt-acts">
          <AskButton onClick={onRetry}>Try again</AskButton>
        </div>
      </div>
    )
  }
  const asks = prompts(tiles)
  return (
    <div className="apgt-empty">
      <p>
        {v.noAccount
          ? 'This wallet has no Hyperliquid account yet. A deposit opens one, and a long or short is one sentence after that.'
          : 'Nothing is open. Pick a market below, or ask for one by name.'}
      </p>
      {asks.length > 0 && (
        <div className="apgt-acts">
          {asks.slice(0, 3).map((a) => (
            <AskButton key={a.prompt} title={a.prompt} onClick={() => onAsk(a.prompt)}>
              {a.label}
            </AskButton>
          ))}
        </div>
      )}
    </div>
  )
}

export function HyperliquidSection({ server, tiles, pending, density, onAsk, onRetry }: AppSectionProps) {
  if (pending && tiles.length === 0) return <SectionPending server={server} line={density === 'line'} />
  const v = hlView(tiles)
  const open = v.positions.length > 0

  if (density === 'line') {
    const first = v.positions[0]
    const fallback = prompts(tiles)[0]
    return (
      <AppLineRow
        server={server}
        tone={open ? 'ok' : undefined}
        text={hlLine(v)}
        act={
          v.error
            ? { label: 'Try again', onClick: onRetry }
            : first
              ? { label: `Protect ${first.coin}`, onClick: () => onAsk(hlProtectAsk(first)) }
              : fallback
                ? { label: fallback.label, onClick: () => onAsk(fallback.prompt) }
                : null
        }
      />
    )
  }

  const note = open ? `${v.positions.length} open` : undefined

  if (density === 'side') {
    const pnl = hlTotalPnl(v.positions)
    return (
      <SectionFrame server={server} note={note} className="apgt">
        {open ? (
          <>
            <FactRow>
              {v.accountUsd != null && <Fact value={fmtUsdPlain(v.accountUsd)} label="Account value" />}
              {pnl != null && <Fact value={signedUsd(pnl)} label="Unrealized PnL" tone={pnl >= 0 ? 'pos' : 'neg'} />}
            </FactRow>
            <ListBlock title="Positions" note={v.positions.length > 4 ? `${v.positions.length - 4} more` : undefined}>
              {v.positions.slice(0, 4).map((p) => (
                <ListRow
                  key={`${p.coin}-${p.side}`}
                  lead={<TokenIcon symbol={p.coin} size={24} />}
                  main={`${p.coin} ${p.side}${p.leverage ? `, ${p.leverage}x` : ''}`}
                  sub={p.liqDistancePct != null ? `liquidation ${p.liqDistancePct.toFixed(1)}% away` : undefined}
                  value={fmtUsdPlain(p.valueUsd)}
                  valueSub={<span className={p.pnlUsd >= 0 ? 'apgt-pos' : 'apgt-neg'}>{signedUsd(p.pnlUsd)}</span>}
                  actions={
                    <AskButton className="apgt-btn-sm" onClick={() => onAsk(hlProtectAsk(p))} title={hlProtectAsk(p)}>
                      Protect
                    </AskButton>
                  }
                />
              ))}
            </ListBlock>
          </>
        ) : (
          <>
            <p className="apgt-lead">{v.error ? 'Hyperliquid did not answer just now.' : v.accountUsd != null ? `${fmtUsdPlain(v.accountUsd)} in the account, nothing open.` : 'Nothing open on Hyperliquid.'}</p>
            {v.error ? (
              <div className="apgt-acts">
                <AskButton onClick={onRetry}>Try again</AskButton>
              </div>
            ) : (
              <MarketsBlock n={4} compact onAsk={onAsk} />
            )}
          </>
        )}
      </SectionFrame>
    )
  }

  // full
  return (
    <SectionFrame server={server} note="read from Hyperliquid" className="apgt">
      {open ? (
        <>
          <Facts v={v} />
          <div className="apg-list">
            <div className="apg-list__head">
              <span className="apg-eyebrow">Open positions</span>
              <span className="apg-list__note">PnL is unrealized, at the mark</span>
            </div>
            <PositionsTable positions={v.positions} onAsk={onAsk} />
          </div>
          <MarketsBlock n={8} onAsk={onAsk} />
        </>
      ) : (
        <>
          <GetStarted v={v} tiles={tiles} onAsk={onAsk} onRetry={onRetry} />
          {!v.error && <MarketsBlock n={8} onAsk={onAsk} />}
        </>
      )}
    </SectionFrame>
  )
}

const mod: SectionModule = {
  Section: HyperliquidSection,
  headline: ({ tiles }) => (tiles.length === 0 ? null : hlHeadline(hlView(tiles))),
  quiet: ({ tiles }) => {
    const v = hlView(tiles)
    return !v.error && v.positions.length === 0
  },
}
export default mod
