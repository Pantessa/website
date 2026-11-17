'use client'

// AAVE on the apps page (squad apps-page, EARN lane). One app alone is a
// product: the headline says what is earning and what is not, the facts are
// the position's own numbers, the main list is what is supplied and borrowed
// (each row with the ask that undoes it), and "Where it could earn" lists the
// assets this wallet holds that Aave lists, at Aave's best rate, read from
// the public earn board (GET /api/markets/earn: no address, cached 60s).
// Every number comes from the scan or that board; unknown values are left out.
//
// This file also holds the small state pieces the other earn sections share
// (EarnState, EarnPrompts): exported, so one look covers five apps.

import { useEffect, useState, type ReactNode } from 'react'
import TokenIcon from '@/components/TokenIcon'
import { LendingViz } from '@/components/splash/viz'
import { AppLineRow, AskButton, Fact, FactRow, ListBlock, ListRow, SectionFrame, SectionPending } from '@/components/apps/parts'
import {
  aaveHeadline,
  aaveOffers,
  aaveViewOf,
  errorOf,
  heldBySymbol,
  idleOf,
  pctWords,
  placedHoldings,
  previewOf,
  usdWords,
  yearlyEarn,
  compactUsd,
  type BoardOffer,
  type EarnBoardRow,
} from '@/lib/apps-earn'
import type { SuggestedPrompt } from '@/lib/splash/types'
import type { AppSectionProps, SectionModule } from './types'
import '@/components/apps/earn.css'

// ── Shared by the earn sections ─────────────────────────────────────────────

/** The asks a block offers, deduped by label, as outlined pills. */
export function EarnPrompts({ prompts, onAsk, max = 3 }: { prompts: SuggestedPrompt[]; onAsk: AppSectionProps['onAsk']; max?: number }) {
  const list = prompts.filter((p, i, all) => all.findIndex((q) => q.label === p.label) === i).slice(0, max)
  if (list.length === 0) return null
  return (
    <div className="apge-prompts">
      {list.map((p, i) => (
        <AskButton key={p.label} strong={i === 0} onClick={() => onAsk(p.prompt)}>
          {p.label}
        </AskButton>
      ))}
    </div>
  )
}

/** A section with nothing of its own to draw: loading, an error with Retry,
 *  or the preview's honest "nothing here yet" with the app's own asks. Null
 *  when the tiles DO hold something (the section draws it). */
export function EarnState({
  server,
  tiles,
  pending,
  density,
  onAsk,
  onRetry,
  fallback,
}: Pick<AppSectionProps, 'server' | 'tiles' | 'pending' | 'density' | 'onAsk' | 'onRetry'> & { fallback: string }) {
  if (pending && tiles.length === 0) return <SectionPending server={server} line={density === 'line'} />
  const err = errorOf(tiles)
  const preview = previewOf(tiles)
  if (density === 'line') {
    if (err) return <AppLineRow server={server} tone="needs" text={err} act={{ label: 'Retry', onClick: onRetry }} />
    const act = preview?.prompts[0]
    return <AppLineRow server={server} text={fallback} act={act ? { label: act.label, onClick: () => onAsk(act.prompt) } : null} />
  }
  return (
    <SectionFrame server={server} note={err ? 'did not load' : undefined}>
      {err ? (
        <div className="apge-state">
          <p className="apge-state__text">{err}</p>
          <div className="apge-prompts">
            <AskButton onClick={onRetry}>Retry</AskButton>
          </div>
        </div>
      ) : (
        <div className="apge-state">
          <p className="apge-state__text">{preview?.message ?? fallback}</p>
          <EarnPrompts prompts={preview?.prompts ?? []} onAsk={onAsk} />
        </div>
      )}
    </SectionFrame>
  )
}

/** The two-column body a section in `full` gets (one column when narrow). */
export function EarnColumns({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="apge">
      <div className="apge__cols">
        <div className="apge__main">{main}</div>
        <aside className="apge__side">{side}</aside>
      </div>
    </div>
  )
}

/** A short explanatory line under a list (provenance, what is counted). */
export const EarnFoot = ({ children }: { children: ReactNode }) => <p className="apge-foot">{children}</p>

// ── The public earn board (rates across markets) ────────────────────────────

let boardCache: { at: number; rows: EarnBoardRow[] } | null = null
let boardInflight: Promise<EarnBoardRow[]> | null = null

function readBoard(): Promise<EarnBoardRow[]> {
  if (boardCache && Date.now() - boardCache.at < 60_000) return Promise.resolve(boardCache.rows)
  boardInflight ??= fetch('/api/markets/earn')
    .then((r) => (r.ok ? r.json() : { rows: [] }))
    .then((b: { rows?: EarnBoardRow[] }) => {
      const rows = Array.isArray(b.rows) ? b.rows : []
      if (rows.length > 0) boardCache = { at: Date.now(), rows }
      return rows
    })
    .catch(() => [] as EarnBoardRow[])
    .finally(() => {
      boardInflight = null
    })
  return boardInflight
}

export function useEarnBoard(on: boolean): EarnBoardRow[] | null {
  const [rows, setRows] = useState<EarnBoardRow[] | null>(boardCache?.rows ?? null)
  useEffect(() => {
    if (!on) return
    let live = true
    readBoard().then((r) => live && setRows(r))
    return () => {
      live = false
    }
  }, [on])
  return rows
}

export function OffersTable({
  offers,
  onAsk,
  title = 'Where it could earn on Aave',
  verb = 'Supply',
}: {
  offers: BoardOffer[]
  onAsk: AppSectionProps['onAsk']
  title?: string
  verb?: string
}) {
  return (
    <ListBlock title={title} note="for what you hold">
      <div className="apge-tbl apge-tbl--offers" role="table">
        <div className="apge-tbl__head" role="row">
          <span role="columnheader">Asset</span>
          <span role="columnheader" className="apge-num">Rate</span>
          <span role="columnheader" className="apge-num apge-hide-narrow">Supplied there</span>
          <span role="columnheader" className="apge-num">You hold</span>
          <span aria-hidden />
        </div>
        {offers.map((o) => (
          <div key={`${o.asset}-${o.chain}`} className="apge-tbl__row" role="row">
            <span className="apge-tbl__asset" role="cell">
              <TokenIcon symbol={o.asset} size={26} chain={o.chain} />
              <span className="apge-tbl__name">
                <span>
                  {o.asset} <span className="apge-sub">on {o.chain}</span>
                </span>
                <span className="apge-sub">{o.detail}</span>
              </span>
            </span>
            <span role="cell" className="apge-num apge-num--strong">{pctWords(o.apyPct)}</span>
            <span role="cell" className="apge-num apge-hide-narrow">{o.tvlUsd != null ? compactUsd(o.tvlUsd) : null}</span>
            <span role="cell" className="apge-num">{usdWords(o.heldUsd)}</span>
            <span role="cell" className="apge-tbl__act">
              <AskButton onClick={() => onAsk(o.ask)} title={o.ask}>
                {verb}
              </AskButton>
            </span>
          </div>
        ))}
      </div>
    </ListBlock>
  )
}

// ── The section ─────────────────────────────────────────────────────────────

function AaveSection(props: AppSectionProps) {
  const { server, tiles, density, page, map, onAsk } = props
  const view = aaveViewOf(tiles)
  const idle = idleOf(map)
  const held = heldBySymbol(placedHoldings(page.bySlug, map).rows)
  const board = useEarnBoard(density === 'full')
  const offers = board ? aaveOffers(board, held) : []

  if (!view) {
    // No position: the honest empty state, plus (in full) what the wallet
    // could supply at today's rates, when it holds anything Aave lists.
    const state = <EarnState {...props} fallback={aaveHeadline(null, idle)} />
    if (density !== 'full' || offers.length === 0 || errorOf(tiles) || (props.pending && tiles.length === 0)) return state
    return (
      <SectionFrame server={server}>
        <EarnColumns
          main={
            <>
              <OffersTable offers={offers} onAsk={onAsk} />
              <EarnFoot>Rates are read live from Aave and change with every block. Your wallet signs every supply.</EarnFoot>
            </>
          }
          side={
            <>
              {idle && (
                <FactRow>
                  <Fact value={usdWords(idle.usd)} label="Idle USDC" sub={`on ${idle.chains.join(', ')}`} />
                </FactRow>
              )}
              <EarnPrompts prompts={previewOf(tiles)?.prompts ?? []} onAsk={onAsk} />
            </>
          }
        />
      </SectionFrame>
    )
  }

  const year = yearlyEarn(view.suppliedUsd, view.netApyPct)
  const supplied = view.rows.filter((r) => r.side === 'supplied')

  if (density === 'line') {
    const bits = [
      view.suppliedUsd != null && view.suppliedUsd > 0 ? `${usdWords(view.suppliedUsd)} supplied${view.netApyPct != null ? ` at ${pctWords(view.netApyPct)} net` : ''}` : null,
      view.borrowedUsd != null && view.borrowedUsd > 0 ? `${usdWords(view.borrowedUsd)} borrowed` : null,
      view.healthFactor != null ? `health factor ${view.healthFactor.toFixed(2)}` : null,
    ].filter(Boolean)
    const act = view.prompts[0]
    const risky = view.healthFactor != null && view.healthFactor < 1.5
    return (
      <AppLineRow
        server={server}
        tone={risky ? 'needs' : undefined}
        text={`${bits.join(', ') || 'An Aave position'}.`.replace(/^./, (c) => c.toUpperCase())}
        act={act ? { label: act.label, onClick: () => onAsk(act.prompt) } : null}
      />
    )
  }

  const facts = (
    <FactRow>
      {view.suppliedUsd != null && (
        <Fact value={usdWords(view.suppliedUsd)} label="Supplied" sub={supplied.length > 0 ? supplied.map((r) => r.symbol).join(', ') : undefined} />
      )}
      {view.netApyPct != null && <Fact value={pctWords(view.netApyPct)} label="Net rate" sub={year != null ? `about ${usdWords(year)} a year` : undefined} />}
      {view.borrowedUsd != null && (
        <Fact value={usdWords(view.borrowedUsd)} label="Borrowed" sub={view.borrowedUsd > 0 ? undefined : 'nothing to repay'} tone={view.borrowedUsd > 0 ? 'neg' : undefined} />
      )}
      {view.healthFactor != null && (
        <Fact value={view.healthFactor.toFixed(2)} label="Health factor" sub={view.healthFactor < 1.5 ? 'close to liquidation' : 'comfortable'} tone={view.healthFactor < 1.5 ? 'neg' : 'pos'} />
      )}
      {density === 'full' && idle && <Fact value={usdWords(idle.usd)} label="Idle USDC" sub={`on ${idle.chains.join(', ')}`} />}
    </FactRow>
  )

  const rowsList = (n: number) => (
    <ListBlock title="Your position" note={view.rows.length > n ? `${n} of ${view.rows.length}` : undefined}>
      {view.rows.slice(0, n).map((r) => (
        <ListRow
          key={`${r.side}-${r.symbol}`}
          lead={<TokenIcon symbol={r.symbol} size={28} chain="Ethereum" />}
          main={`${r.symbol} ${r.side}${r.collateral ? ', as collateral' : ''}`}
          sub={r.sub}
          value={<span className={r.side === 'borrowed' ? 'apge-neg' : undefined}>{r.value}</span>}
          actions={
            <span className="apge-act">
              {r.actions.slice(0, 1).map((a) => (
                <AskButton key={a.label} onClick={() => onAsk(a.prompt)} title={a.prompt}>
                  {a.label}
                </AskButton>
              ))}
            </span>
          }
        />
      ))}
    </ListBlock>
  )

  if (density === 'side') {
    return (
      <SectionFrame server={server} note="Ethereum">
        {facts}
        {rowsList(4)}
        <EarnPrompts prompts={view.prompts} onAsk={onAsk} max={2} />
      </SectionFrame>
    )
  }

  const viz = tiles.find((t) => t.id === 'aave-position')?.viz
  return (
    <SectionFrame server={server} note="Aave v4 on Ethereum">
      <EarnColumns
        main={
          <>
            {viz?.kind === 'lending' && (
              <div className="apge-viz">
                <LendingViz viz={viz} />
              </div>
            )}
            {rowsList(8)}
            {offers.length > 0 && <OffersTable offers={offers} onAsk={onAsk} />}
            <EarnFoot>Read from Aave a moment ago. Rates change with every block.</EarnFoot>
          </>
        }
        side={
          <>
            {facts}
            <EarnPrompts prompts={view.prompts} onAsk={onAsk} />
          </>
        }
      />
    </SectionFrame>
  )
}

const headline: SectionModule['headline'] = ({ tiles, map }) => {
  if (errorOf(tiles)) return null
  return aaveHeadline(aaveViewOf(tiles), idleOf(map))
}

const quiet: SectionModule['quiet'] = ({ tiles }) => !aaveViewOf(tiles) && !errorOf(tiles)

const mod: SectionModule = { Section: AaveSection, headline, quiet }
export default mod
