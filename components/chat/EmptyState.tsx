'use client'

// The empty chat surface: the invitation to ask. Lives outside the
// ChatInterface monolith so shell work can restyle it without touching the
// thread. Rendering contract: flex-1 (never h-full) — the thread wrapper is
// a min-h-full flex column, so percentage heights don't resolve; growing
// into the free space is what keeps the vertical centering.

import { Link2, Send, Sparkles } from 'lucide-react'
import { EXAMPLE_PROMPTS } from '@/lib/examples'
import SampleCallDemo from '@/components/SampleCallDemo'

// One-tap example asks: a click SENDS the turn (the caller passes runExample).
// Asking is free — anything transactional still ends at the wallet signature —
// so the chip is the whole first turn, not a writing prompt.
function ExampleGallery({ onPick }: { onPick: (prompt: string, slug?: string) => void }) {
  return (
    <div className="mt-7 w-full max-w-md">
      <p className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">
        Run one — a tap sends it
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLE_PROMPTS.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => onPick(ex.prompt, ex.slug)}
            title={ex.prompt}
            className="group flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[color:var(--accent)]/45 hover:bg-white/5 transition-colors"
          >
            <Send className="w-3 h-3 text-[color:var(--muted-2)] group-hover:text-[color:var(--accent)] transition-colors" />
            {ex.label}
          </button>
        ))}
      </div>
      <div className="flex justify-center">
        <SampleCallDemo />
      </div>
    </div>
  )
}

export default function EmptyState({
  activeCount,
  autoRouter,
  onPick,
  showLinksHint,
  guestBannerPad,
}: {
  activeCount: number
  autoRouter: boolean
  onPick: (prompt: string, slug?: string) => void
  /** First-party chat only — the embed has no rail or mint affordances. */
  showLinksHint?: boolean
  /** The guest sign-in banner (ChatSignInGate) floats over the thread above
   *  the composer; on short mobile viewports it covered the last example
   *  chip. Reserve its height below the gallery so every chip stays
   *  reachable by scrolling (below lg only — desktop has the room). */
  guestBannerPad?: boolean
}) {
  return (
    <div className={`flex flex-col items-center justify-center flex-1 text-center py-20${guestBannerPad ? ' max-lg:pb-44' : ''}`}>
      <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/15 border border-[var(--accent)]/50 flex items-center justify-center mb-6">
        <Sparkles className="w-8 h-8" style={{ color: 'var(--accent)' }} />
      </div>
      {/* The chat voice face (Fraunces) — not the site serif; the thread and
          the invitation should speak in the same type. */}
      <h3
        className="text-white font-semibold mb-2"
        style={{ fontFamily: 'var(--font-chat-display)', fontSize: '1.75rem', letterSpacing: '-0.01em' }}
      >
        Say what should happen.
      </h3>
      <p className="text-[color:var(--muted)] text-sm max-w-sm">
        {autoRouter
          ? 'Auto Router picks the right MCP for each ask and shows its work. Anything that moves money is compiled into a guarded transaction — only your wallet can sign it.'
          : activeCount === 0
            ? 'Pick MCPs from the rail, or just ask — swaps, schedules, stop-losses, and portfolios are built in. Only your wallet can sign what comes back.'
            : `Your ${activeCount} MCP${activeCount > 1 ? 's' : ''} answer questions free; anything that moves money is compiled into a guarded transaction only your wallet can sign.`}
      </p>
      <ExampleGallery onPick={onPick} />
      {showLinksHint && (
        <p className="mt-6 text-[11px] text-[color:var(--muted-2)] max-w-sm">
          Any ask here can become a shareable intent link — hover a sent message for the{' '}
          <Link2 className="inline w-3 h-3 align-[-1px]" aria-hidden />
          {' '}mint icon, or open the rail&apos;s Links tab.
        </p>
      )}
    </div>
  )
}
