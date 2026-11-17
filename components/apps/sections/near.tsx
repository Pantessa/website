'use client'

// NEAR INTENTS on the apps page (squad apps-page, EARN lane). The app has no
// scan of its own (its tile is the preview), so the section reads the PAGE:
// the wallet's balances by chain, from any app's holdings tile on the page,
// else the money map's ETH and USDC. Each chain offers ONE move of a stable
// it holds, to the largest other chain the wallet uses, in the cross-chain
// grammar the chat builds (lib/cross-chain-swap) and never under a venue
// floor (lib/venue-floor). A balance with no honest move gets no button.

import TokenIcon from '@/components/TokenIcon'
import { AppLineRow, AskButton, Fact, FactRow, ListBlock, ListRow, SectionFrame, SectionPending } from '@/components/apps/parts'
import { chainGroups, countWord, errorOf, moveAsk, nearHeadline, placedHoldings, previewOf, tokensLine, usdWords, type ChainGroup } from '@/lib/apps-earn'
import type { AppSectionProps, SectionModule } from './types'
import { EarnColumns, EarnFoot, EarnPrompts, EarnState } from './aave'

/** The guard's own rule for every cross-chain build (lib/cross-chain-swap
 *  guardCrossChainBuild: deliverTo and refundTo are the paying wallet). */
const REFUND_LINE = 'Delivery and refunds both go to your own address.'

/** Each chain's one move: its largest stable that has an honest sentence. */
export function chainMoves(groups: ChainGroup[]) {
  return groups.map((g) => {
    for (const t of g.tokens) {
      const m = moveAsk(t, groups)
      if (m) return { group: g, move: { ...m, token: t } }
    }
    return { group: g, move: null }
  })
}

function readPage({ page, map }: Pick<AppSectionProps, 'page' | 'map'>) {
  const placed = placedHoldings(page.bySlug, map)
  const groups = chainGroups(placed.rows)
  return { placed, groups, moves: chainMoves(groups) }
}

function NearSection(props: AppSectionProps) {
  const { server, tiles, pending, density, onAsk } = props
  if (pending && tiles.length === 0) return <SectionPending server={server} line={density === 'line'} />
  if (errorOf(tiles)) return <EarnState {...props} fallback="NEAR Intents did not answer." />
  const { placed, groups, moves } = readPage(props)
  const movable = moves.filter((m) => m.move)
  const prompts = previewOf(tiles)?.prompts ?? tiles.flatMap((t) => t.prompts)

  if (groups.length === 0) {
    if (density === 'line') {
      const act = prompts[0]
      return <AppLineRow server={server} text="Moves money between chains in one step." act={act ? { label: act.label, onClick: () => onAsk(act.prompt) } : null} />
    }
    return (
      <SectionFrame server={server}>
        <div className="apge-state">
          <p className="apge-state__text">No balances on this page yet. Add Uniswap or the wallet to see your balances by chain here.</p>
          <EarnPrompts prompts={prompts} onAsk={onAsk} />
        </div>
      </SectionFrame>
    )
  }

  if (density === 'line') {
    const first = movable[0]?.move
    return (
      <AppLineRow
        server={server}
        text={groups.length === 1 ? nearHeadline(groups) : `Your money sits on ${countWord(groups.length)} chains.`}
        act={first ? { label: `Move ${first.token.symbol} to ${first.to}`, onClick: () => onAsk(first.ask) } : null}
      />
    )
  }

  const counted =
    placed.source === 'map'
      ? 'Counts ETH and USDC only. Add Uniswap or the wallet to see every token.'
      : `Chain totals count the ${placed.rows.length} ${placed.rows.length === 1 ? 'position' : 'positions'} this page lists.`

  const list = (n: number) => (
    <ListBlock title="Your money by chain" note={groups.length > n ? `${n} of ${groups.length}` : undefined}>
      {moves.slice(0, n).map(({ group, move }) => (
        <ListRow
          key={group.chain}
          lead={<TokenIcon symbol={group.tokens[0].symbol} size={28} chain={group.chain} />}
          main={group.chain}
          sub={tokensLine(group)}
          value={usdWords(group.totalUsd)}
          actions={
            move ? (
              <AskButton onClick={() => onAsk(move.ask)} title={move.ask}>
                {density === 'side' ? `Move ${move.token.symbol}` : `Move ${move.amount.toLocaleString('en-US')} ${move.token.symbol} to ${move.to}`}
              </AskButton>
            ) : undefined
          }
        />
      ))}
    </ListBlock>
  )

  const facts = (
    <FactRow>
      {groups.slice(0, density === 'full' ? 3 : 2).map((g) => (
        <Fact key={g.chain} value={usdWords(g.totalUsd)} label={g.chain} sub={tokensLine(g)} />
      ))}
    </FactRow>
  )

  if (density === 'side') {
    return (
      <SectionFrame server={server} note={`${countWord(groups.length)} ${groups.length === 1 ? 'chain' : 'chains'}`}>
        {facts}
        {list(4)}
        <EarnFoot>{REFUND_LINE}</EarnFoot>
      </SectionFrame>
    )
  }

  return (
    <SectionFrame server={server} note="cross-chain moves">
      <EarnColumns
        main={
          <>
            {list(8)}
            <EarnFoot>{counted} A move is offered for stablecoins of $5 or more.</EarnFoot>
          </>
        }
        side={
          <>
            {facts}
            <p className="apge-note">{REFUND_LINE}</p>
            <EarnPrompts prompts={prompts} onAsk={onAsk} max={2} />
          </>
        }
      />
    </SectionFrame>
  )
}

const mod: SectionModule = {
  Section: NearSection,
  headline: (p) => (errorOf(p.tiles) ? null : nearHeadline(readPage(p).groups)),
  // Quiet in the one-line posture when there is nothing it could move.
  quiet: (p) => !errorOf(p.tiles) && !readPage(p).moves.some((m) => m.move),
}
export default mod
