'use client'

// SNAPSHOT on the apps page (squad apps-page, TRADE lane). Governance: the
// open votes in the spaces this wallet follows, soonest to close first.
//   full: the headline's facts, the vote closing soonest as a featured block,
//         every open vote as a row (avatar, title, space, time left, the
//         leading choice's share), the spaces followed on the right.
//   side: the soonest vote, compact, then up to three more rows.
//   line: one sentence and the vote button.
// Voting itself happens in the chat: every button hands the tile's own ask
// grammar to onAsk ("Prepare my vote on …" → the native vote card).

import { Avatar } from '@/components/SplashDashboard'
import { RowProgress } from '@/components/splash/viz'
import { AppLineRow, AskButton, Fact, FactRow, ListBlock, ListRow, SectionFrame, SectionPending } from '@/components/apps/parts'
import {
  closesWhen,
  snapshotHeadline,
  snapshotLine,
  snapshotView,
  summarizeAsk,
  timeLeftShort,
  voteAsk,
  type SnapshotView,
} from '@/lib/apps-trade'
import type { ProposalRow, SplashTile } from '@/lib/splash/types'
import type { AppSectionProps, SectionModule } from './types'
import '@/components/apps/trade.css'

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

function closeDate(endsAt: number): string {
  try {
    return new Date(endsAt * 1000).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function prompts(tiles: SplashTile[]) {
  return tiles.flatMap((t) => t.prompts).filter((p, i, all) => all.findIndex((q) => q.prompt === p.prompt) === i)
}

/** The vote closing soonest, drawn as the page's featured block. */
function Featured({ p, compact, onAsk }: { p: ProposalRow; compact?: boolean; onAsk: AppSectionProps['onAsk'] }) {
  const now = Date.now()
  return (
    <div className="apgt-feature" data-apgt-feature="">
      <div className="apgt-feature__label">
        <Avatar url={p.avatarUrl} label={p.spaceName} size={20} />
        <span className="apg-eyebrow">
          {p.spaceName} · closes {closesWhen(p.endsAt, now, tz())}
        </span>
      </div>
      <h2 className={compact ? 'apgt-feature__title apgt-feature__title--sm' : 'apgt-feature__title'}>{p.title}</h2>
      {p.choices.length > 0 && (
        <div className="apgt-choices">
          {p.choices.slice(0, compact ? 3 : 6).map((c, i) => {
            const lead = p.leadingChoice === c
            return (
              <div key={`${c}-${i}`} className="apgt-choice">
                <div className="apgt-choice__row">
                  <span className={lead ? 'apgt-choice__name apgt-choice__name--lead' : 'apgt-choice__name'}>{c}</span>
                  {lead && p.leadingPct != null && <span className="apgt-num">leading, {p.leadingPct}%</span>}
                </div>
                {lead && p.leadingPct != null && <RowProgress pct={p.leadingPct} />}
              </div>
            )
          })}
          {!p.leadingChoice && <p className="apgt-small">No votes cast yet.</p>}
          {p.choices.length > (compact ? 3 : 6) && <p className="apgt-small">and {p.choices.length - (compact ? 3 : 6)} more choices</p>}
        </div>
      )}
      <div className="apgt-acts">
        <AskButton strong onClick={() => onAsk(voteAsk(p))}>
          Vote
        </AskButton>
        <AskButton onClick={() => onAsk(summarizeAsk(p))}>Summarize this vote</AskButton>
      </div>
    </div>
  )
}

function VoteRow({ p, onAsk, withAct = true }: { p: ProposalRow; onAsk: AppSectionProps['onAsk']; withAct?: boolean }) {
  const now = Date.now()
  return (
    <ListRow
      lead={<Avatar url={p.avatarUrl} label={p.spaceName} size={28} />}
      main={p.title}
      sub={
        <span className="apgt-votesub">
          <span>
            {p.spaceName} · {timeLeftShort(p.endsAt, now)}
          </span>
          {p.leadingChoice && p.leadingPct != null ? (
            <span className="apgt-votesub__lead">
              <span className="apgt-num">
                {p.leadingChoice} {p.leadingPct}%
              </span>
              <span className="apgt-votesub__bar">
                <RowProgress pct={p.leadingPct} />
              </span>
            </span>
          ) : (
            <span>No votes yet</span>
          )}
        </span>
      }
      actions={
        withAct ? (
          <AskButton className="apgt-btn-sm" onClick={() => onAsk(voteAsk(p))}>
            Vote
          </AskButton>
        ) : undefined
      }
    />
  )
}

function EmptyState({ v, tiles, onAsk, onRetry }: { v: SnapshotView; tiles: SplashTile[]; onAsk: AppSectionProps['onAsk']; onRetry: () => void }) {
  const asks = prompts(tiles)
  if (v.error) {
    return (
      <div className="apgt-empty">
        <p>Snapshot did not answer just now. Your votes are still there.</p>
        <div className="apgt-acts">
          <AskButton onClick={onRetry}>Try again</AskButton>
        </div>
      </div>
    )
  }
  return (
    <div className="apgt-empty">
      <p>
        {v.followsNothing
          ? 'This wallet follows no Snapshot space yet. Follow a DAO and its open votes show here, soonest to close first.'
          : 'Nothing is open for a vote in the spaces you follow. New votes show here as they open.'}
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

export function SnapshotSection({ server, tiles, pending, density, onAsk, onRetry }: AppSectionProps) {
  if (pending && tiles.length === 0) return <SectionPending server={server} line={density === 'line'} />
  const v = snapshotView(tiles)

  if (density === 'line') {
    const first = v.proposals[0]
    const fallback = prompts(tiles)[0]
    return (
      <AppLineRow
        server={server}
        tone={first ? 'needs' : undefined}
        text={snapshotLine(v)}
        act={
          v.error
            ? { label: 'Try again', onClick: onRetry }
            : first
              ? { label: 'Vote', onClick: () => onAsk(voteAsk(first)) }
              : fallback
                ? { label: fallback.label, onClick: () => onAsk(fallback.prompt) }
                : null
        }
      />
    )
  }

  const [first, ...rest] = v.proposals
  const note = v.proposals.length > 0 ? `${v.proposals.length} open` : undefined

  if (!first) {
    return (
      <SectionFrame server={server} note={note} className="apgt">
        <EmptyState v={v} tiles={tiles} onAsk={onAsk} onRetry={onRetry} />
      </SectionFrame>
    )
  }

  if (density === 'side') {
    return (
      <SectionFrame server={server} note={note} className="apgt">
        <Featured p={first} compact onAsk={onAsk} />
        {rest.length > 0 && (
          <ListBlock title="Also open" note={rest.length > 3 ? `${rest.length - 3} more in the chat` : undefined}>
            {rest.slice(0, 3).map((p) => (
              <VoteRow key={p.id} p={p} onAsk={onAsk} />
            ))}
          </ListBlock>
        )}
      </SectionFrame>
    )
  }

  // full
  const spacesWithVotes = v.spaces.filter((s) => s.open > 0)
  return (
    <SectionFrame server={server} note="read from Snapshot" className="apgt">
      <div className="apgt-grid">
        <div className="apgt-col">
          <Featured p={first} onAsk={onAsk} />
          <ListBlock title="Open votes" note={`${v.proposals.length} in all, soonest first`}>
            {v.proposals.map((p) => (
              <VoteRow key={p.id} p={p} onAsk={onAsk} />
            ))}
          </ListBlock>
        </div>
        <aside className="apgt-col apgt-col--side">
          <FactRow>
            <Fact value={String(v.proposals.length)} label="Open votes" />
            <Fact value={String(v.spaces.length)} label={v.spaces.length === 1 ? 'Space voting' : 'Spaces voting'} sub="of the spaces you follow" />
            <Fact value={timeLeftShort(first.endsAt).replace(/ left$/, '')} label="Next to close" sub={closeDate(first.endsAt)} />
          </FactRow>
          {spacesWithVotes.length > 0 && (
            <ListBlock title="Spaces">
              {spacesWithVotes.map((s) => (
                <ListRow
                  key={s.id}
                  lead={<Avatar url={s.avatarUrl} label={s.name} size={24} />}
                  main={s.name}
                  value={`${s.open} open`}
                />
              ))}
            </ListBlock>
          )}
          {prompts(tiles).length > 2 && (
            <div className="apgt-acts">
              {prompts(tiles)
                .slice(2, 3)
                .map((a) => (
                  <AskButton key={a.prompt} title={a.prompt} onClick={() => onAsk(a.prompt)}>
                    Summarize every open vote
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
  Section: SnapshotSection,
  headline: ({ tiles }) => (tiles.length === 0 ? null : snapshotHeadline(snapshotView(tiles), Date.now(), tz())),
  quiet: ({ tiles }) => {
    const v = snapshotView(tiles)
    return !v.error && v.proposals.length === 0
  },
}
export default mod
