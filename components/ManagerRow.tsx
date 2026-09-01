// ManagerRow — the storefront ROW treatment (FIRST HIRE sprint, visuals
// lane). Pure presentation: UI/UX's storefront section owns the data + the
// tap-to-hire logic and passes them in; this row owns how a hireable manager
// LOOKS. 375px first: the row is a wrapping flex line — mark + identity wrap
// above the trust anchor + CTA on narrow screens, one line on wide.
//
// The trust anchor is the record link: a manager is exactly as credible as
// its /agents/<handle> page (real signed history — never projections), so
// the row's only numbers are record facts, and they LINK there.

import Link from 'next/link'
import type { ReactNode } from 'react'
import ManagerMark from '@/components/ManagerMark'
import { MANDATE_KIND_LABELS, type MandateKind } from '@/lib/roster-client'

export default function ManagerRow({
  name,
  handle,
  house = false,
  founding = false,
  kinds = [],
  signedTurns = null,
  employers = null,
  cta,
}: {
  name: string
  /** Public 16-hex handle. Null only for a house row not yet minted. */
  handle?: string | null
  house?: boolean
  founding?: boolean
  /** Mandate kinds this manager serves — rendered as chips. */
  kinds?: MandateKind[]
  /** Record facts (real signed history) — null hides the figure, never fakes a 0. */
  signedTurns?: number | null
  employers?: number | null
  /** The hire control — supplied by the storefront (it owns the flow). */
  cta?: ReactNode
}) {
  const recordBits: string[] = []
  if (signedTurns != null) recordBits.push(`${signedTurns} signed`)
  if (employers != null) recordBits.push(`${employers} employer${employers === 1 ? '' : 's'}`)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-[var(--line)] px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        <ManagerMark handle={handle} house={house} size={42} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-[color:var(--fg)]">{name}</span>
            {house ? (
              <span className="mono rounded-full border border-[var(--line)] px-2 py-0.5 text-[9.5px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                House
              </span>
            ) : null}
            {founding ? (
              <span
                className="mono rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[color:var(--bg)]"
                style={{ background: 'var(--accent)' }}
              >
                Founding
              </span>
            ) : null}
          </div>
          {kinds.length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {kinds.map((k) => (
                <span
                  key={k}
                  className="mono rounded-full border border-[var(--line)] px-2 py-0.5 text-[9.5px] uppercase tracking-wide text-[color:var(--fg)]"
                >
                  {MANDATE_KIND_LABELS[k]}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-none items-center gap-3">
        {handle ? (
          <Link
            href={`/agents/${handle}`}
            className="mono text-[11px] uppercase tracking-wide text-[color:var(--muted)] underline-offset-2 hover:text-[color:var(--fg)] hover:underline"
            title="The public record — real signed history, never projections."
          >
            {recordBits.length ? `Record · ${recordBits.join(' · ')}` : 'Record'} →
          </Link>
        ) : null}
        {cta}
      </div>
    </div>
  )
}
