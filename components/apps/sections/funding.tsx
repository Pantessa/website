'use client'

// PANTESSA FINANCE (yeetful-tool-funding) on the apps page (squad apps-page,
// EARN lane): the idle-capital read. Its tile lists the balances earning
// nothing and what today's live rates would pay; the one ask is the
// rebalance the chat re-plans at the moment it runs. Modest on purpose.

import { AppLineRow, AskButton, Fact, FactRow, ListBlock, ListRow, SectionFrame } from '@/components/apps/parts'
import { errorOf, fundingHeadline, fundingViewOf, usdWords } from '@/lib/apps-earn'
import type { AppSectionProps, SectionModule } from './types'
import { EarnFoot, EarnPrompts, EarnState } from './aave'

function FundingSection(props: AppSectionProps) {
  const { server, tiles, density, onAsk } = props
  const view = fundingViewOf(tiles)
  if (!view) return <EarnState {...props} fallback="Nothing is worth moving right now." />

  if (density === 'line') {
    const act = view.prompts[0]
    return <AppLineRow server={server} tone="idle" text={fundingHeadline(view)} act={act ? { label: act.label, onClick: () => onAsk(act.prompt) } : null} />
  }

  const n = density === 'full' ? 8 : 4
  return (
    <SectionFrame server={server} note="live rates">
      {view.yearUsd != null && (
        <FactRow>
          <Fact value={usdWords(view.yearUsd)} label="A year on the table" sub="an estimate at today's rates, not advice" />
        </FactRow>
      )}
      <ListBlock title="Earning nothing" note={view.moves.length > n ? `${n} of ${view.moves.length}` : undefined}>
        {view.moves.slice(0, n).map((r) => (
          <ListRow
            key={r.label}
            main={r.label}
            sub={r.value}
            actions={(r.actions ?? []).slice(0, 1).map((a) => (
              <AskButton key={a.label} onClick={() => onAsk(a.prompt)}>
                {a.label}
              </AskButton>
            ))}
          />
        ))}
      </ListBlock>
      <EarnPrompts prompts={view.prompts} onAsk={onAsk} max={2} />
      {density === 'full' && <EarnFoot>The plan is made again when you ask, so it uses the rates of that moment. Your wallet signs every step.</EarnFoot>}
    </SectionFrame>
  )
}

const mod: SectionModule = {
  Section: FundingSection,
  headline: ({ tiles }) => (errorOf(tiles) ? null : fundingHeadline(fundingViewOf(tiles))),
  quiet: ({ tiles }) => !fundingViewOf(tiles) && !errorOf(tiles),
}
export default mod
