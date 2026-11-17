'use client'

// ROBINHOOD CHAIN on the apps page (squad apps-page, lane PORTFOLIO): the
// wallet's tokenized stocks, USDG and ETH on chain 4663
// (`robinhood-portfolio`, sources.ts robinhoodSource: the largest rows, each
// with its own Buy more / Sell asks). Drawn with the portfolio pieces the
// Uniswap section exports, with stock words: a fact for how many are stocks.

import { AppLineRow, Fact, SectionFrame, SectionPending } from '@/components/apps/parts'
import { holdingsCounts, holdingsSentence, holdingsTileOf, stockCount } from '@/lib/apps-portfolio'
import type { SplashTile } from '@/lib/splash/types'
import { HoldingsFull, HoldingsSide, TileState } from './uniswap'
import type { AppSectionProps, SectionModule } from './types'
import '../portfolio.css'

const NOUN: [string, string] = ['holding', 'holdings']
const NOTHING = 'Nothing on Robinhood Chain in this wallet yet. Ask the chat to bring USDC over and buy a stock.'

function sentence(tiles: SplashTile[]): string | null {
  const tile = holdingsTileOf(tiles)
  if (!tile) return null
  const stocks = stockCount(tile.subtitle)
  const base = holdingsSentence({ totalUsd: tile.totalUsd, counts: holdingsCounts(tile), noun: NOUN })
  if (stocks == null || stocks === 0) return base
  return `${base.slice(0, -1)}, ${stocks === 1 ? 'one of them a stock' : `${stocks} of them stocks`}.`
}

function RobinhoodSection({ server, tiles, pending, density, onAsk, onRetry }: AppSectionProps) {
  if (pending && tiles.length === 0) return <SectionPending server={server} line={density === 'line'} />
  const tile = holdingsTileOf(tiles)
  const prompts = tiles.flatMap((t) => t.prompts)
  const text = sentence(tiles)
  if (density === 'line') {
    const act = prompts[0]
    return <AppLineRow server={server} text={text ?? NOTHING} act={act ? { label: act.label, onClick: () => onAsk(act.prompt) } : null} />
  }
  if (!tile)
    return (
      <SectionFrame server={server}>
        <TileState tiles={tiles} onRetry={onRetry} onAsk={onAsk} fallback={NOTHING} />
      </SectionFrame>
    )
  if (density === 'side')
    return (
      <SectionFrame server={server}>
        <HoldingsSide tile={tile} sentence={text!} onAsk={onAsk} />
      </SectionFrame>
    )
  const stocks = stockCount(tile.subtitle)
  return (
    <SectionFrame server={server} note="CHAIN 4663">
      <HoldingsFull
        tile={tile}
        totalLabel="On Robinhood Chain"
        noun={NOUN}
        onAsk={onAsk}
        facts={stocks != null ? <Fact value={stocks} label={stocks === 1 ? 'Stock' : 'Stocks'} /> : null}
        aside={
          prompts.length > 0 ? (
            <aside className="apgp-only" aria-label="Ask">
              <div className="apgp-block">
                <div className="apg-eyebrow">Ask</div>
                <div className="apgp-asks">
                  {prompts.slice(0, 4).map((p) => (
                    <button key={p.prompt} type="button" className="apg-btn apgp-btn apgp-btn--wrap" title={p.prompt} onClick={() => onAsk(p.prompt)}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          ) : null
        }
      />
    </SectionFrame>
  )
}

const mod: SectionModule = {
  Section: RobinhoodSection,
  headline: ({ tiles }) => sentence(tiles) ?? (tiles.some((t) => t.render === 'empty') ? 'Nothing on Robinhood Chain in this wallet yet.' : null),
}
export default mod
