'use client'

// Clarify chips (RR17) — the general "which one did you mean?" surface.
// Rendered when a routed turn returns a clarify artifact instead of picks:
// the planner judged a MONEY/GOVERNANCE target genuinely ambiguous and
// refused to guess (read-only asks never clarify — they best-guess and say
// so). Each chip carries the user's request FULLY RESOLVED with that
// choice; clicking sends it as the next message, so the route resumes as a
// perfectly normal turn (working context, guardrails, sign flow all see
// nothing special). Generalizes VoteCandidates' proven pattern.

import { HelpCircle, ChevronRight } from 'lucide-react'
import type { ClarifyRequest } from '@/lib/clarify'

export default function ClarifyChips({
  clarify,
  onPick,
  disabled,
}: {
  clarify: ClarifyRequest
  onPick: (resume: string) => void
  disabled?: boolean
}) {
  return (
    <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1.5">
      <div className="flex items-center gap-1.5 text-[12px] text-[color:var(--muted)]">
        <HelpCircle className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-[color:var(--fg)]">{clarify.question}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {clarify.options.map((o, i) => (
          <button
            key={`${o.label}-${i}`}
            onClick={() => onPick(o.resume)}
            disabled={disabled}
            title={o.resume}
            className="group flex items-center gap-2 text-left text-[12px] px-3 py-2 max-lg:min-h-10 rounded-lg border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] disabled:opacity-50 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--muted-2)] group-hover:text-white" />
            <span className="min-w-0 flex-1 truncate">
              <span className="text-[color:var(--fg)] font-medium">{o.label}</span>
              {i === 0 && <span className="text-[color:var(--muted-2)]"> — best guess</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
