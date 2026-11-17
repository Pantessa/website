'use client'

// UNISWAP on the apps page (squad apps-page, lane PORTFOLIO). Nate: "if just
// Uniswap is selected it's a killer app in itself". The splash scan gives
// this app the wallet's multichain portfolio (`portfolio-holdings`: the
// largest rows with their own asks, the allocation across every holding) and
// its recent transfers (`recent-activity`). This file draws them three ways:
//   full  the whole page: facts, the allocation bar, ONE holdings list across
//         chains (every row its mark, chain, 30-day line, value and its own
//         asks), and "Only here": what Pantessa adds that Uniswap's app does not.
//   side  a column: the total, the bar, the top rows, one ask each on hover.
//   line  one sentence, one button.
// The Pantessa Wallet builds the SAME tiles (sections/wallet.tsx reuses the
// pieces exported here). Every button hands its ask to the chat (onAsk); a
// section never builds or signs.

import { useState, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ExternalLink, Repeat } from 'lucide-react'
import TokenIcon from '@/components/TokenIcon'
import { AllocationViz } from '@/components/splash/viz'
import { Delta24, Sparkline } from '@/components/splash/Sparkline'
import { AppLineRow, AskButton, Eyebrow, Fact, FactRow, SectionFrame, SectionPending } from '@/components/apps/parts'
import {
  activityWords,
  agoText,
  balanceText,
  biggestHolding,
  chainLabelsOf,
  holdingsCounts,
  holdingsSentence,
  holdingsShownUnder,
  holdingsTileOf,
  needsAboutHoldings,
  rankHoldings,
  recurringMonthly,
  recurringSentence,
  spellCount,
  usdText,
} from '@/lib/apps-portfolio'
import type { ActivityTile, HoldingRow, HoldingsTile, SplashTile, SuggestedPrompt } from '@/lib/splash/types'
import { cleanServerName } from '@/lib/utils'
import type { AppSectionProps, SectionModule } from './types'
import '../portfolio.css'

type Ask = AppSectionProps['onAsk']

/** How many rows the full list shows before "Show all". */
export const FULL_LIST_ROWS = 8
/** How many rows a side column shows before "N more". */
export const SIDE_LIST_ROWS = 3

const uniq = (ps: SuggestedPrompt[]) => ps.filter((p, i, all) => all.findIndex((q) => q.prompt === p.prompt) === i)

// ── Row actions: the first visible, the rest behind "More" ──────────────────

/** A row's asks: the first as a button, the rest (and the explorer link)
 *  behind a More toggle that opens a band under the row. Keyboard: the
 *  toggle is a real button with aria-expanded. */
export function RowActs({
  actions,
  onAsk,
  open,
  onToggle,
  strong,
}: {
  actions: SuggestedPrompt[]
  onAsk: Ask
  open: boolean
  onToggle: () => void
  strong?: boolean
}) {
  const [first, ...rest] = actions
  if (!first) return null
  return (
    <span className="apgp-acts">
      <AskButton strong={strong} onClick={() => onAsk(first.prompt)} title={first.prompt} className="apgp-btn">
        {first.label}
      </AskButton>
      {rest.length > 0 && (
        <button type="button" className="apgp-more" aria-expanded={open} onClick={onToggle} title={open ? 'Fewer actions' : `${rest.length} more ${rest.length === 1 ? 'action' : 'actions'}`}>
          <ChevronDown width={14} height={14} aria-hidden className="apgp-more__icon" />
          <span className="apgp-sr">{open ? 'Fewer actions' : 'More actions'}</span>
        </button>
      )}
    </span>
  )
}

/** The band a row opens: its other asks and its explorer link. */
export function RowBand({ actions, info, onAsk }: { actions: SuggestedPrompt[]; info?: { url: string; label: string } | null; onAsk: Ask }) {
  return (
    <div className="apgp-band">
      {actions.map((a) => (
        <AskButton key={a.prompt} onClick={() => onAsk(a.prompt)} title={a.prompt} className="apgp-btn">
          {a.label}
        </AskButton>
      ))}
      {info && (
        <a href={info.url} target="_blank" rel="noopener noreferrer" className="apgp-link">
          {info.label}
          <ExternalLink width={12} height={12} aria-hidden />
        </a>
      )}
    </div>
  )
}

const infoOf = (h: { infoUrl?: string | null; infoLabel?: string }) => (h.infoUrl ? { url: h.infoUrl, label: h.infoLabel ?? 'More info' } : null)
const rowKey = (h: HoldingRow) => `${h.chain ?? ''}|${h.address}|${h.symbol}`

// ── The holdings list (full) ────────────────────────────────────────────────

export function HoldingsTable({ tile, onAsk, total }: { tile: HoldingsTile; onAsk: Ask; total: number }) {
  const ranked = rankHoldings(tile.holdings)
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const rows = all ? ranked : ranked.slice(0, FULL_LIST_ROWS)
  const hidden = ranked.length - rows.length
  const multichain = tile.chain.includes('·') || new Set(ranked.map((h) => h.chain)).size > 1
  return (
    <div className="apgp-table" data-apgp-holdings={ranked.length}>
      <div className="apgp-thead" aria-hidden>
        <span>Asset</span>
        <span className="apgp-c-amt">Amount</span>
        <span className="apgp-c-spark">30 days</span>
        <span className="apgp-c-val">Value</span>
        <span className="apgp-c-act" />
      </div>
      {rows.map((h) => {
        const id = rowKey(h)
        const expanded = open === id
        const acts = h.actions ?? []
        return (
          <div key={id} className="apgp-hrow" data-open={expanded || undefined}>
            <div className="apgp-tr">
              <span className="apgp-asset">
                <TokenIcon symbol={h.symbol} size={28} chain={h.chain ?? tile.chain} />
                <span className="apgp-asset__text">
                  <span className="apgp-asset__sym">{h.symbol}</span>
                  {(h.chain || !multichain) && <span className="apgp-tag">{h.chain ?? tile.chain}</span>}
                </span>
              </span>
              <span className="apgp-c-amt apgp-num apgp-muted">{balanceText(h.balance)}</span>
              <span className="apgp-c-spark">
                <Sparkline symbol={h.symbol} width={72} height={22} />
                <Delta24 symbol={h.symbol} className="apgp-delta" />
              </span>
              <span className="apgp-c-val apgp-num">{h.valueUsd != null ? usdText(h.valueUsd) : <span className="apgp-muted">not priced</span>}</span>
              <span className="apgp-c-act">
                <RowActs actions={acts} onAsk={onAsk} open={expanded} onToggle={() => setOpen(expanded ? null : id)} />
                {acts.length === 0 && infoOf(h) && (
                  <a href={infoOf(h)!.url} target="_blank" rel="noopener noreferrer" className="apgp-link" title={infoOf(h)!.label}>
                    <ExternalLink width={13} height={13} aria-hidden />
                    <span className="apgp-sr">{infoOf(h)!.label}</span>
                  </a>
                )}
              </span>
            </div>
            {expanded && <RowBand actions={acts.slice(1)} info={infoOf(h)} onAsk={onAsk} />}
          </div>
        )
      })}
      <div className="apgp-tfoot">
        {hidden > 0 ? (
          <button type="button" className="apgp-textbtn" onClick={() => setAll(true)}>
            Show all {ranked.length}
          </button>
        ) : all && ranked.length > FULL_LIST_ROWS ? (
          <button type="button" className="apgp-textbtn" onClick={() => setAll(false)}>
            Show the top {FULL_LIST_ROWS}
          </button>
        ) : null}
        {total > ranked.length && (
          <span className="apgp-muted">
            The {spellCount(ranked.length)} largest of {total.toLocaleString('en-US')} positions.
          </span>
        )}
      </div>
    </div>
  )
}

// ── Recent activity ─────────────────────────────────────────────────────────

export function ActivityList({ tile, max = 4 }: { tile: ActivityTile; max?: number }) {
  return (
    <ul className="apgp-activity">
      {tile.rows.slice(0, max).map((r) => {
        const Icon = r.direction === 'out' ? ArrowUpRight : r.direction === 'in' ? ArrowDownLeft : Repeat
        const when = agoText(r.timestamp)
        return (
          <li key={r.chain + r.hash}>
            <a href={r.explorerUrl} target="_blank" rel="noopener noreferrer" className="apgp-act">
              <span className={`apgp-act__icon apgp-act__icon--${r.direction}`}>
                <Icon width={13} height={13} aria-hidden />
              </span>
              <span className="apgp-act__text">
                <span className="apgp-act__main">{activityWords(r)}</span>
                <span className="apgp-act__sub">
                  {r.chain}
                  {r.counterparty ? `, ${r.direction === 'out' ? 'to' : 'from'} ${r.counterparty}` : ''}
                  {when ? `, ${when}` : ''}
                </span>
              </span>
              <ExternalLink width={12} height={12} aria-hidden className="apgp-act__ext" />
            </a>
          </li>
        )
      })}
    </ul>
  )
}

// ── "Only here" (the side list of the full page) ────────────────────────────

function scrollToSel(sel: string) {
  const el = typeof document !== 'undefined' ? document.querySelector(sel) : null
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function OnlyHere({ tile, activity, page, prompts, onAsk }: { tile: HoldingsTile | null; activity: ActivityTile | null; page: AppSectionProps['page']; prompts: SuggestedPrompt[]; onAsk: Ask }) {
  const needs = tile ? needsAboutHoldings(page.briefing, tile.holdings.map((h) => h.symbol)) : 0
  const rec = recurringSentence(page.recurring)
  const monthly = recurringMonthly(page.recurring)
  return (
    <aside className="apgp-only" aria-label="Only here">
      {(needs > 0 || rec) && (
        <div className="apgp-block">
          <Eyebrow>Only here</Eyebrow>
          <ul className="apgp-notes">
            {needs > 0 && (
              <li>
                <button type="button" className="apgp-note" onClick={() => scrollToSel('[data-apps-needs]')}>
                  <span aria-hidden className="apg-dot apg-dot--needs" />
                  <span>
                    {needs === 1 ? 'One of these holdings needs you.' : `${spellCount(needs)} of these holdings need you.`.replace(/^./, (c) => c.toUpperCase())}{' '}
                    <span className="apgp-muted">It is at the top of the page.</span>
                  </span>
                </button>
              </li>
            )}
            {rec && (
              <li>
                <button type="button" className="apgp-note" onClick={() => scrollToSel('[data-apgp-recurring]')}>
                  <span aria-hidden className="apg-dot apg-dot--ok" />
                  <span>
                    {rec} {monthly && <span className="apgp-muted">{monthly}.</span>}
                  </span>
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
      {activity && activity.rows.length > 0 && (
        <div className="apgp-block">
          <Eyebrow>Recent activity</Eyebrow>
          <ActivityList tile={activity} />
        </div>
      )}
      {prompts.length > 0 && (
        <div className="apgp-block">
          <Eyebrow>Ask</Eyebrow>
          <div className="apgp-asks">
            {prompts.map((p) => (
              <AskButton key={p.prompt} onClick={() => onAsk(p.prompt)} title={p.prompt} className="apgp-btn apgp-btn--wrap">
                {p.label}
              </AskButton>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

// ── The states every density shares ─────────────────────────────────────────

/** An error tile's words + Retry, an empty tile's words, or a plain "nothing". */
export function TileState({ tiles, onRetry, onAsk, fallback }: { tiles: SplashTile[]; onRetry: () => void; onAsk: Ask; fallback: string }) {
  const err = tiles.find((t) => t.render === 'error')
  if (err && err.render === 'error')
    return (
      <div className="apgp-state" data-apgp-state="error">
        <p>{err.message}</p>
        <AskButton onClick={onRetry}>Try again</AskButton>
      </div>
    )
  const empty = tiles.find((t) => t.render === 'empty')
  const prompts = uniq(tiles.flatMap((t) => t.prompts)).slice(0, 3)
  return (
    <div className="apgp-state" data-apgp-state="empty">
      <p>{empty && empty.render === 'empty' ? empty.message : fallback}</p>
      {prompts.length > 0 && (
        <div className="apgp-asks">
          {prompts.map((p) => (
            <AskButton key={p.prompt} onClick={() => onAsk(p.prompt)} title={p.prompt} className="apgp-btn">
              {p.label}
            </AskButton>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Side density ────────────────────────────────────────────────────────────

export function HoldingsSide({ tile, sentence, onAsk }: { tile: HoldingsTile; sentence: string; onAsk: Ask }) {
  const ranked = rankHoldings(tile.holdings)
  const [more, setMore] = useState(false)
  const rows = more ? ranked : ranked.slice(0, SIDE_LIST_ROWS)
  const hidden = ranked.length - rows.length
  return (
    <div className="apgp-side">
      <p className="apgp-sentence">{sentence}</p>
      {tile.viz?.kind === 'allocation' && (
        <div className="apgp-alloc apgp-alloc--side">
          <AllocationViz viz={tile.viz} chain={tile.chain} />
        </div>
      )}
      <div className="apgp-srows">
        {rows.map((h) => {
          const act = h.actions?.[0]
          return (
            <div key={rowKey(h)} className="apgp-srow">
              <TokenIcon symbol={h.symbol} size={24} chain={h.chain ?? tile.chain} />
              <span className="apgp-srow__main">
                <span className="apgp-asset__sym">{h.symbol}</span>
                {h.chain && <span className="apgp-tag">{h.chain}</span>}
              </span>
              <span className="apgp-srow__val apgp-num">{h.valueUsd != null ? usdText(h.valueUsd) : <span className="apgp-muted">not priced</span>}</span>
              {act && (
                <span className="apgp-srow__act">
                  <AskButton onClick={() => onAsk(act.prompt)} title={act.prompt} className="apgp-btn apgp-btn--sm">
                    {act.label}
                  </AskButton>
                </span>
              )}
            </div>
          )
        })}
      </div>
      {hidden > 0 && (
        <button type="button" className="apgp-textbtn" onClick={() => setMore(true)}>
          {hidden} more
        </button>
      )}
    </div>
  )
}

// ── The section, parameterised so the wallet can wear it too ────────────────

export interface PortfolioWords {
  /** The headline's lead ("Your wallet holds"), or none. */
  lead?: string
  /** Facts' first label. */
  totalLabel: string
  /** What an app with nothing to show says. */
  nothing: string
}

export function portfolioSentence(tiles: SplashTile[], words: PortfolioWords): string | null {
  const tile = holdingsTileOf(tiles)
  if (!tile) return null
  return holdingsSentence({ totalUsd: tile.totalUsd, counts: holdingsCounts(tile), lead: words.lead })
}

export function makePortfolioSection(words: PortfolioWords) {
  return function PortfolioSection({ server, tiles, pending, density, page, onAsk, onRetry }: AppSectionProps) {
    if (pending && tiles.length === 0) return <SectionPending server={server} line={density === 'line'} />
    const tile = holdingsTileOf(tiles)
    const activity = (tiles.find((t) => t.render === 'activity') as ActivityTile | undefined) ?? null
    const under = holdingsShownUnder(server.slug, tiles, page.bySlug)
    const prompts = uniq(tiles.flatMap((t) => t.prompts))
    const sentence = portfolioSentence(tiles, words)

    if (density === 'line') {
      const text = sentence ?? (under ? `Your holdings are shown under ${cleanServerName(under)}.` : words.nothing)
      const act = prompts[0]
      return <AppLineRow server={server} text={text} act={act ? { label: act.label, onClick: () => onAsk(act.prompt) } : null} />
    }

    if (!tile) {
      return (
        <SectionFrame server={server}>
          {under ? (
            <div className="apgp-state" data-apgp-state="under">
              <p>Your holdings are shown under {cleanServerName(under)}.</p>
              {prompts.length > 0 && (
                <div className="apgp-asks">
                  {prompts.slice(0, 2).map((p) => (
                    <AskButton key={p.prompt} onClick={() => onAsk(p.prompt)} title={p.prompt} className="apgp-btn">
                      {p.label}
                    </AskButton>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <TileState tiles={tiles} onRetry={onRetry} onAsk={onAsk} fallback={words.nothing} />
              {activity && (
                <div className="apgp-block">
                  <Eyebrow>Recent activity</Eyebrow>
                  <ActivityList tile={activity} />
                </div>
              )}
            </>
          )}
        </SectionFrame>
      )
    }

    const counts = holdingsCounts(tile)
    if (density === 'side') {
      return (
        <SectionFrame server={server} note={counts.chains && counts.chains > 1 ? `${counts.chains} CHAINS` : undefined}>
          <HoldingsSide tile={tile} sentence={sentence!} onAsk={onAsk} />
        </SectionFrame>
      )
    }

    return (
      <SectionFrame server={server} note={`${counts.positions} ${counts.positions === 1 ? 'POSITION' : 'POSITIONS'}${counts.chains ? ` · ${counts.chains} ${counts.chains === 1 ? 'CHAIN' : 'CHAINS'}` : ''}`}>
        <HoldingsFull tile={tile} totalLabel={words.totalLabel} aside={<OnlyHere tile={tile} activity={activity} page={page} prompts={prompts.slice(0, 4)} onAsk={onAsk} />} onAsk={onAsk} />
      </SectionFrame>
    )
  }
}

/** The full page body for any holdings tile: facts, the bar, the list, an aside. */
export function HoldingsFull({ tile, totalLabel, aside, onAsk, facts }: { tile: HoldingsTile; totalLabel: string; aside: ReactNode; onAsk: Ask; facts?: ReactNode }) {
  const counts = holdingsCounts(tile)
  const big = biggestHolding(tile.holdings)
  const chains = chainLabelsOf(tile)
  return (
    <div className="apgp-full">
      <div className="apgp-full__facts">
        <FactRow>
          {tile.totalUsd != null && <Fact value={usdText(tile.totalUsd)} label={totalLabel} sub={`${counts.positions.toLocaleString('en-US')} ${counts.positions === 1 ? 'position' : 'positions'}`} />}
          {tile.totalUsd == null && <Fact value={counts.positions.toLocaleString('en-US')} label="Positions" />}
          {counts.chains != null && (
            <Fact
              value={counts.chains}
              label={counts.chains === 1 ? 'Chain' : 'Chains'}
              sub={counts.chainName ?? (chains.length > counts.chains ? `of ${chains.length} read` : undefined)}
            />
          )}
          {big && <Fact value={usdText(big.valueUsd!)} label="Largest" sub={`${big.symbol}${big.chain ? ` on ${big.chain}` : ''}`} />}
          {facts}
        </FactRow>
      </div>
      {tile.viz?.kind === 'allocation' && (
        <div className="apgp-full__alloc apgp-alloc">
          <AllocationViz viz={tile.viz} chain={tile.chain} />
        </div>
      )}
      <div className="apgp-full__list">
        <div className="apgp-listhead">
          <Eyebrow>Holdings</Eyebrow>
          <span className="apgp-listhead__note">{counts.chains && counts.chains > 1 ? 'Every chain, one list' : 'Largest first'}</span>
        </div>
        <HoldingsTable tile={tile} onAsk={onAsk} total={counts.positions} />
      </div>
      <div className="apgp-full__aside">{aside}</div>
    </div>
  )
}

const UNISWAP: PortfolioWords = {
  totalLabel: 'Portfolio',
  nothing: 'Nothing to show for this wallet on Uniswap yet. Ask it for a quote in the chat.',
}

const mod: SectionModule = {
  Section: makePortfolioSection(UNISWAP),
  headline: ({ tiles }) => portfolioSentence(tiles, UNISWAP),
}
export default mod
