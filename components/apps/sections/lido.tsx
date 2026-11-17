'use client'

// LIDO on the apps page (squad apps-page, EARN lane): what is staked, at what
// rate, what that rate earns in a year (an estimate, said so), the 12-month
// projection, the position's rows and the tile's own asks (a live-amount
// stake when the wallet has spare ETH, else the guided ask). Lido stakes on
// Ethereum only; the scan reads nothing on other chains.

import TokenIcon from '@/components/TokenIcon'
import { YieldViz } from '@/components/splash/viz'
import { AppLineRow, Fact, FactRow, ListBlock, ListRow, SectionFrame } from '@/components/apps/parts'
import { errorOf, lidoHeadline, lidoViewOf, pctWords, usdWords } from '@/lib/apps-earn'
import { EarnColumns, EarnFoot, EarnPrompts, EarnState } from './aave'
import type { AppSectionProps, SectionModule } from './types'

const markOf = (label: string) => (/wsteth/i.test(label) ? 'wstETH' : /steth/i.test(label) ? 'stETH' : 'ETH')

function LidoSection(props: AppSectionProps) {
  const { server, tiles, density, onAsk } = props
  const view = lidoViewOf(tiles)
  if (!view) return <EarnState {...props} fallback="Nothing staked with Lido yet." />

  if (density === 'line') {
    const act = view.prompts[0]
    return (
      <AppLineRow
        server={server}
        text={lidoHeadline(view)}
        act={act ? { label: act.label, onClick: () => onAsk(act.prompt) } : null}
      />
    )
  }

  const facts = (
    <FactRow>
      {(view.stEth || view.stakedUsd != null) && (
        <Fact
          value={view.stakedUsd != null ? usdWords(view.stakedUsd) : `${view.stEth} stETH`}
          label="Staked"
          sub={view.stEth && view.stakedUsd != null ? `${view.stEth} stETH` : undefined}
        />
      )}
      {view.aprPct != null && <Fact value={pctWords(view.aprPct)} label="Rate" sub="a year, it moves daily" />}
      {view.yearUsd != null && <Fact value={usdWords(view.yearUsd)} label="A year at this rate" sub="an estimate, not a promise" tone="pos" />}
    </FactRow>
  )

  const rows = (
    <ListBlock title="Your position">
      {view.rows.map((r) => (
        <ListRow
          key={r.label}
          lead={r.label === 'Withdrawals' ? undefined : <TokenIcon symbol={markOf(r.label)} size={28} chain="Ethereum" />}
          main={r.label}
          sub={r.sub}
          value={r.value}
        />
      ))}
    </ListBlock>
  )

  if (density === 'side') {
    return (
      <SectionFrame server={server} note="Ethereum">
        {facts}
        {rows}
        <EarnPrompts prompts={view.prompts} onAsk={onAsk} max={2} />
      </SectionFrame>
    )
  }

  const viz = tiles.find((t) => t.id === 'lido-position')?.viz
  return (
    <SectionFrame server={server} note="Staking on Ethereum">
      <EarnColumns
        main={
          <>
            {viz?.kind === 'yield' && (
              <div className="apge-viz">
                <span className="apg-eyebrow">The next 12 months at today&apos;s rate</span>
                <YieldViz viz={viz} />
              </div>
            )}
            {rows}
            <EarnFoot>stETH rebases daily: the balance grows in the wallet. Lido stakes on Ethereum, so ETH on another chain moves there first.</EarnFoot>
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

const mod: SectionModule = {
  Section: LidoSection,
  headline: ({ tiles }) => (errorOf(tiles) ? null : lidoHeadline(lidoViewOf(tiles))),
  quiet: ({ tiles }) => !lidoViewOf(tiles) && !errorOf(tiles),
}
export default mod
