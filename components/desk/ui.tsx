'use client'

// components/desk/ui.tsx — the console's small shared pieces (squad
// five-million, CONSOLE lane, 2026-11-03): a route's answer printed verbatim,
// and an inline two-step confirm for the irreversible buttons.

import Link from 'next/link'
import { useState } from 'react'
import { refusalText, type Answer } from './api'
import { upgradeWord } from './derive'

/** A route's answer: its own sentence on a refusal (+ the plan it names),
 *  the console's short line on success. */
export function AnswerNote({ answer, ok, tag }: { answer: Answer<unknown> | null; ok?: string | null; tag?: string }) {
  if (!answer) return null
  if (answer.ok) return ok ? <p className="dcx-note dcx-note--ok" role="status" data-desk-answer={tag ?? 'ok'}>{ok}</p> : null
  const up = upgradeWord(answer.json?.upgrade)
  return (
    <p className="dcx-note dcx-note--bad" role="alert" data-desk-refusal={answer.json?.entitlement ?? answer.json?.reason ?? answer.json?.field ?? String(answer.status)}>
      {refusalText(answer)}
      {up && (
        <>
          {' '}
          <Link href="/pricing#desk">See {up}</Link>.
        </>
      )}
    </p>
  )
}

/** A button that asks once more before it fires. */
export function ConfirmButton({ label, confirm, yes, onYes, disabled, danger = true }: { label: string; confirm: string; yes: string; onYes: () => void | Promise<void>; disabled?: boolean; danger?: boolean }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!asking) {
    return (
      <button type="button" className={`dcx-btn dcx-btn--small ${danger ? 'dcx-btn--danger' : ''}`} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className="dcx__row" role="group" aria-label={confirm}>
      <span className="text-[12.5px] dcx__muted">{confirm}</span>
      <button
        type="button"
        className={`dcx-btn dcx-btn--small ${danger ? 'dcx-btn--danger' : 'dcx-btn--solid'}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onYes()
          } finally {
            setBusy(false)
            setAsking(false)
          }
        }}
      >
        {busy ? '…' : yes}
      </button>
      <button type="button" className="dcx-btn dcx-btn--small" onClick={() => setAsking(false)} disabled={busy}>
        Keep it
      </button>
    </span>
  )
}
