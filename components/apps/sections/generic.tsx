'use client'

// The section every app stands on until its family has its own: the app's
// tiles drawn with the splash's own renderers (holdings with marks and
// sparklines, votes with avatars, positions, rows), flat on the page instead
// of inside a card. A custom MCP, and any family whose lane has not landed,
// renders through this. Do not special-case a family here: give it a module.

import { PromptChips, TileSection } from '@/components/SplashDashboard'
import { lineFor } from '@/lib/apps-page'
import { AppLineRow, SectionFrame, SectionPending } from '@/components/apps/parts'
import type { AppSectionProps, SectionModule } from './types'

export function GenericSection({ server, tiles, pending, density, onAsk, onRetry }: AppSectionProps) {
  if (pending && tiles.length === 0) return <SectionPending server={server} line={density === 'line'} />

  if (density === 'line') {
    const line = lineFor(tiles)
    return (
      <AppLineRow
        server={server}
        text={line.text}
        act={line.act ? { label: line.act.label, onClick: () => onAsk(line.act!.prompt) } : null}
      />
    )
  }

  const prompts = tiles.flatMap((t) => t.prompts).filter((p, i, all) => all.findIndex((q) => q.label === p.label) === i)
  return (
    <SectionFrame server={server}>
      {tiles.length === 0 ? (
        <p className="apg-muted">Nothing to show for this wallet yet. Ask it anything in the chat.</p>
      ) : (
        tiles.map((t) => (
          <div key={t.id} className="apg-tile">
            <TileSection tile={t} onPick={(p) => onAsk(p)} onRetry={onRetry} />
          </div>
        ))
      )}
      <PromptChips prompts={prompts.slice(0, density === 'full' ? 6 : 3)} slug={server.slug} onPick={(p) => onAsk(p)} />
    </SectionFrame>
  )
}

const generic: SectionModule = { Section: GenericSection }
export default generic
