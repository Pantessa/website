// HireConsentFrame — the hire MOMENT's framing (FIRST HIRE sprint, visuals
// lane). Wraps the consent step UI/UX already runs (server-minted consent
// bytes + the wallet ask — children): the frame names who is being hired,
// shows their mark, and says the whole safety contract in three beats:
//
//     One signature. Fire anytime. It can only propose.
//
// Pure presentation, no flow logic — the consent text is NEVER composed
// here (security CONTRACTS v1: the API mints it; this frame just makes the
// moment feel like hiring a person, not pasting a hash).

import type { ReactNode } from 'react'
import ManagerMark from '@/components/ManagerMark'

export default function HireConsentFrame({
  name,
  handle,
  house = false,
  capUsd,
  children,
}: {
  name: string
  handle?: string | null
  house?: boolean
  /** The slot's per-proposal cap — named at the moment of consent. */
  capUsd?: number | null
  children?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] p-4" style={{ background: 'var(--surf-1)' }}>
      <div className="flex items-center gap-3">
        <ManagerMark handle={handle} house={house} size={44} />
        <div className="min-w-0">
          <div className="mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
            You are hiring
          </div>
          <div className="truncate text-[15px] font-semibold text-[color:var(--fg)]">{name}</div>
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-[color:var(--fg)]">
        One signature. Fire anytime. It can only propose.
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--muted)]">
        {/* the space rides INSIDE the conditional — a text node opening on a
            new JSX line loses its leading space (the SWC entity-space class,
            caught live in the 375 shot: ")lands") */}
        Every move it proposes{capUsd != null ? ` (capped at $${capUsd} each) ` : ' '}lands in your
        inbox as a guarded, signable card — nothing happens without this wallet&apos;s signature,
        and there is never anything to withdraw.
      </p>

      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  )
}
