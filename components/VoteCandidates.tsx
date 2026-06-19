'use client'

// Clickable proposal picker shown when a vote intent ("vote yes") matched more
// than one active proposal. Each chip carries the FULL proposal id; clicking it
// re-submits "vote <choice> on <full-id>", which routes straight back into the
// vote flow and lands on <SignVoteButton>. This replaces the old dead-end where
// the chat asked the user to paste an id they could only see truncated.

import { ChevronRight } from 'lucide-react'
import type { VoteCandidates as VoteCandidatesData } from '@/lib/snapshot-vote'

export default function VoteCandidates({
  data,
  onPick,
  disabled,
}: {
  data: VoteCandidatesData
  onPick: (id: string) => void
  disabled?: boolean
}) {
  const choice = data.choiceText || 'on this'
  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      <div className="text-[12px] text-[color:var(--muted)]">
        Pick the proposal to vote <span className="text-[color:var(--fg)] font-medium">{choice}</span> on:
      </div>
      <div className="flex flex-col gap-1.5">
        {data.items.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            disabled={disabled}
            title={p.id}
            className="group flex items-center gap-2 text-left text-[12px] px-3 py-2 max-lg:min-h-10 rounded-lg border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] disabled:opacity-50 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--muted-2)] group-hover:text-white" />
            <span className="min-w-0 flex-1 truncate">
              <span className="text-[color:var(--fg)] font-medium">{p.title}</span>
              <span className="text-[color:var(--muted-2)]"> — {p.space}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
