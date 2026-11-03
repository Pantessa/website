'use client'

// components/desk/StatementSection.tsx — the tenant's monthly statement
// (squad five-million, CONSOLE lane, 2026-11-03).
//
// GET /api/tenants/:id/statement?ym=YYYY-MM: the platform line, the execution
// line (tiered bps on receipt-verified notional, or the tenant's flat bps),
// the in-calldata fees credited, and the amount due. Without the `statement`
// entitlement the route answers `preview: true` and cuts nothing; the console
// says so in the route's own words. The current month loads by itself (an
// open month is never cut); any other month waits for a press, because with
// the entitlement a CLOSED month is cut once — a `statement` row on the
// blotter and a draft invoice when billing is set up.

import { useCallback, useEffect, useState } from 'react'
import { Card, CardTitle } from '@/lib/dashboard-ui'
import { call, type Answer } from './api'
import { currentYm, fmtUsd, shortHash, ymClosed } from './derive'
import { AnswerNote } from './ui'
import type { StatementJson, TenantDetailJson } from './types'

export default function StatementSection({ detail }: { detail: TenantDetailJson }) {
  const t = detail.tenant
  const [ym, setYm] = useState(currentYm())
  const [answer, setAnswer] = useState<Answer<StatementJson> | null>(null)
  const [busy, setBusy] = useState(false)
  const entitled = detail.entitlements.statement
  const cuts = entitled && ymClosed(ym)

  const read = useCallback(
    async (month: string) => {
      setBusy(true)
      setAnswer(await call<StatementJson>('GET', `/api/tenants/${t.id}/statement?ym=${encodeURIComponent(month)}`))
      setBusy(false)
    },
    [t.id],
  )
  useEffect(() => {
    void read(currentYm())
  }, [read])

  const s = answer?.ok ? answer.json : null
  return (
    <div className="dcx" data-desk-section="statement">
      <Card>
        <CardTitle serif eyebrow="STATEMENT">
          The month, from the blotter
        </CardTitle>
        <form
          className="dcx-form dcx-form--month"
          onSubmit={(e) => {
            e.preventDefault()
            if (/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) void read(ym)
          }}
          data-desk-statement-form
        >
          <label className="dcx-field">
            Month (UTC)
            <input className="dcx-input" type="month" value={ym} max={currentYm()} onChange={(e) => setYm(e.target.value)} name="ym" />
          </label>
          <button type="submit" className="dcx-btn dcx-btn--solid" disabled={busy}>
            {busy ? 'Reading…' : cuts ? 'Cut and read' : 'Read the statement'}
          </button>
        </form>
        {cuts && (
          <p className="dcx__faint text-[12.5px] mt-2">
            A closed month is cut once on your plan: one statement row on the blotter, and a draft invoice when billing is set up.
            Reading it again returns the same numbers.
          </p>
        )}
        <div className="mt-3">
          <AnswerNote answer={answer && !answer.ok ? answer : null} tag="statement" />
        </div>
      </Card>

      {s && (
        <Card>
          <div className="dcx__row dcx__row--between mb-3">
            <span className="dcx__row">
              <span className="dcx__mono text-[13px]">{s.statement.ym}</span>
              {s.preview ? <span className="dcx-pill dcx-pill--warn" data-desk-preview>preview</span> : s.statement.final ? <span className="dcx-pill dcx-pill--ok">cut</span> : <span className="dcx-pill">open month</span>}
            </span>
            <span className="dcx__faint text-[12px]">
              {s.statement.period.from.slice(0, 10)} → {s.statement.period.to.slice(0, 10)}
            </span>
          </div>
          {s.preview && s.note && <p className="dcx-note dcx-note--warn mb-3">{s.note}</p>}
          <div className="dcx-lines" data-desk-lines={s.statement.lines.length}>
            {s.statement.lines.map((l) => (
              <div className="dcx-line" key={l.id}>
                <span className="dcx-line__desc">{l.description}</span>
                <span className="dcx-line__amt">{fmtUsd(l.amountUsd)}</span>
              </div>
            ))}
            <div className="dcx-line dcx-line--total">
              <span className="dcx-line__desc">{s.preview || !s.statement.closed ? 'Amount due, if the month closed today' : 'Amount due'}</span>
              <span className="dcx-line__amt" data-desk-due>
                {fmtUsd(s.statement.amountDueUsd)}
              </span>
            </div>
          </div>
          <dl className="dcx-kv mt-3">
            <dt>notional</dt>
            <dd>{fmtUsd(s.statement.notionalUsd)} across {s.statement.legs.total} signed leg{s.statement.legs.total === 1 ? '' : 's'}{s.statement.legs.unpriced ? ` (${s.statement.legs.unpriced} unpriced)` : ''}</dd>
            <dt>basis</dt>
            <dd>{s.statement.basisNote}</dd>
            <dt>platform</dt>
            <dd>{s.statement.platform.note}</dd>
            {s.statement.seq !== null && (
              <>
                <dt>blotter row</dt>
                <dd className="dcx__mono">
                  seq {s.statement.seq} · {shortHash(s.statement.hash, 16)}
                </dd>
              </>
            )}
            {s.statement.invoiceNote && (
              <>
                <dt>invoice</dt>
                <dd>{s.statement.invoiceNote}</dd>
              </>
            )}
          </dl>
        </Card>
      )}
    </div>
  )
}
