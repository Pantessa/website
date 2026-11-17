'use client'

// MORPHO on the apps page (squad apps-page, EARN lane): the markets this
// wallet lends into, posts collateral in, or borrows from, on Base and
// Ethereum, each row with the ask that undoes it (the tile's own). The
// payload carries token amounts and NO dollars, so nothing here prints one.

import TokenIcon from '@/components/TokenIcon'
import { HealthGauge } from '@/components/splash/viz'
import { AppLineRow, AskButton, Fact, FactRow, ListBlock, ListRow, SectionFrame } from '@/components/apps/parts'
import { countWord, errorOf, morphoHeadline, morphoViewOf } from '@/lib/apps-earn'
import type { StatRow } from '@/lib/splash/types'
import { EarnColumns, EarnFoot, EarnPrompts, EarnState } from './aave'
import type { AppSectionProps, SectionModule } from './types'

/** "USDC lent" → "USDC". */
const assetOf = (r: StatRow) => r.chartSymbol ?? r.label.split(/\s+/)[0]
const chainOf = (r: StatRow) => (/\bEthereum\b/.test(r.sub ?? '') ? 'Ethereum' : 'Base')

function PositionRow({ r, onAsk }: { r: StatRow; onAsk: AppSectionProps['onAsk'] }) {
  return (
    <ListRow
      lead={<TokenIcon symbol={assetOf(r)} size={28} chain={chainOf(r)} />}
      main={r.label}
      sub={r.sub}
      value={<span className={r.tone === 'neg' ? 'apge-neg' : undefined}>{r.value}</span>}
      actions={(r.actions ?? []).slice(0, 1).map((a) => (
        <AskButton key={a.label} onClick={() => onAsk(a.prompt)} title={a.prompt}>
          {a.label.replace(/\s+(all\s+)?\S+(\s+collateral)?$/i, '') || a.label}
        </AskButton>
      ))}
    />
  )
}

function MorphoSection(props: AppSectionProps) {
  const { server, tiles, density, onAsk } = props
  const view = morphoViewOf(tiles)
  if (!view || view.positions.length === 0) return <EarnState {...props} fallback="Nothing supplied on Morpho yet." />

  const lent = view.positions.filter((r) => / lent$/.test(r.label)).length
  const borrowed = view.positions.filter((r) => / borrowed$/.test(r.label)).length
  const hf = numOrNull(view.health?.value)

  if (density === 'line') {
    const act = view.prompts[0]
    return (
      <AppLineRow
        server={server}
        tone={hf != null && hf < 1.5 ? 'needs' : undefined}
        text={morphoHeadline(view)}
        act={act ? { label: act.label, onClick: () => onAsk(act.prompt) } : null}
      />
    )
  }

  const facts = (
    <FactRow>
      {lent > 0 && <Fact value={String(lent)} label="Lending in" sub={lent === 1 ? 'one market' : `${countWord(lent)} markets`} />}
      {borrowed > 0 && <Fact value={String(borrowed)} label="Borrowing in" sub={borrowed === 1 ? 'one market' : `${countWord(borrowed)} markets`} tone="neg" />}
      {view.chains.length > 0 && <Fact value={view.chains.join(', ')} label="Chains" />}
    </FactRow>
  )

  const list = (n: number) => (
    <ListBlock title="Your markets" note={view.positions.length > n ? `${n} of ${view.positions.length}` : undefined}>
      {view.positions.slice(0, n).map((r) => (
        <PositionRow key={`${r.label}-${r.sub}`} r={r} onAsk={onAsk} />
      ))}
    </ListBlock>
  )

  if (density === 'side') {
    return (
      <SectionFrame server={server}>
        {facts}
        {list(4)}
        <EarnPrompts prompts={view.prompts} onAsk={onAsk} max={2} />
      </SectionFrame>
    )
  }

  return (
    <SectionFrame server={server} note="Base and Ethereum">
      <EarnColumns
        main={
          <>
            {list(8)}
            <EarnFoot>Morpho reports token amounts, not dollars, so this page shows the amounts as they are.</EarnFoot>
          </>
        }
        side={
          <>
            {facts}
            {hf != null && (
              <div className="apge-gauge">
                <HealthGauge hf={hf} />
                {view.health?.sub && <span className="apge-sub">{view.health.sub}</span>}
              </div>
            )}
            <EarnPrompts prompts={view.prompts} onAsk={onAsk} />
          </>
        }
      />
    </SectionFrame>
  )
}

function numOrNull(s?: string): number | null {
  const n = Number(s)
  return s && Number.isFinite(n) ? n : null
}

const mod: SectionModule = {
  Section: MorphoSection,
  headline: ({ tiles }) => (errorOf(tiles) ? null : morphoHeadline(morphoViewOf(tiles))),
  quiet: ({ tiles }) => !(morphoViewOf(tiles)?.positions.length) && !errorOf(tiles),
}
export default mod
