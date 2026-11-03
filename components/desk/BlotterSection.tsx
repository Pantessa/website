'use client'

// components/desk/BlotterSection.tsx — the tenant's hash-chained blotter
// (squad five-million, CONSOLE lane, 2026-11-03).
//
// GET /api/tenants/:id/blotter (kind / from / to filters, paged by `next`,
// ascending seq — the order the chain is written and verified in), the Verify
// button (GET …/blotter/verify → ok, or the first seq that does not replay),
// and the CSV export: offered when the owner's plan has blotterExport; the
// route answers 403 naming the entitlement otherwise, and the console prints
// that answer with the plan that includes it.

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { Card, CardTitle } from '@/lib/dashboard-ui'
import { cheapestPlanAllowing } from '@/lib/tenant/entitlements'
import { call, type Answer } from './api'
import { blotterQuery, chainWord, explorerTx, fileNameOf, fmtUsd, planWord, shortHash, when } from './derive'
import { policyJson } from './policy-check'
import { AnswerNote } from './ui'
import type { BlotterPageJson, BlotterRowJson, DeskVocab, TenantDetailJson, VerifyJson } from './types'

const PAGE = 200

export default function BlotterSection({ detail, vocab }: { detail: TenantDetailJson; vocab: DeskVocab }) {
  const t = detail.tenant
  const base = `/api/tenants/${t.id}/blotter`
  const [kind, setKind] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [applied, setApplied] = useState<{ kind: string; from: string; to: string }>({ kind: '', from: '', to: '' })
  const [page, setPage] = useState<BlotterPageJson | null>(null)
  const [rows, setRows] = useState<BlotterRowJson[]>([])
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const [verify, setVerify] = useState<Answer<VerifyJson> | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [csv, setCsv] = useState<Answer | null>(null)
  const [exporting, setExporting] = useState(false)

  const read = useCallback(
    async (q: { kind: string; from: string; to: string }, after: number | null) => {
      setBusy(true)
      const a = await call<BlotterPageJson>('GET', `${base}${blotterQuery({ ...q, after, limit: PAGE })}`)
      setBusy(false)
      if (!a.ok || !a.json) return setAnswer(a)
      setAnswer(null)
      setPage(a.json)
      setRows((prev) => (after ? [...prev, ...a.json!.rows] : a.json!.rows))
    },
    [base],
  )
  useEffect(() => {
    void read(applied, null)
  }, [read, applied])

  const apply = (e: React.FormEvent) => {
    e.preventDefault()
    setOpen(null)
    setApplied({ kind, from, to })
  }

  const runVerify = async () => {
    setVerifying(true)
    setVerify(await call<VerifyJson>('GET', `${base}/verify`))
    setVerifying(false)
  }

  const exportCsv = async () => {
    setExporting(true)
    setCsv(null)
    try {
      const res = await fetch(`${base}${blotterQuery({ ...applied, format: 'csv' })}`, { cache: 'no-store' })
      if (!res.ok) {
        let json = null
        try {
          json = await res.json()
        } catch {
          /* no body */
        }
        setCsv({ status: res.status, ok: false, json })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileNameOf(res.headers.get('content-disposition'), `blotter-${t.slug}.csv`)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setCsv({ status: 200, ok: true, json: null })
    } finally {
      setExporting(false)
    }
  }

  const v = verify?.ok ? verify.json : null
  const exportPlan = cheapestPlanAllowing('blotterExport')
  return (
    <div className="dcx" data-desk-section="blotter">
      <Card>
        <CardTitle serif eyebrow={page?.head ? `HEAD · SEQ ${page.head.seq}` : 'NO ROWS YET'}>
          The blotter
        </CardTitle>
        <p className="dcx__p mb-3">
          Every desk event in order: intents, the gate’s verdicts, builds, signatures, settlements, approvals, policy and key
          changes. Each row’s hash covers the row before it, so one edited row breaks every row after it.
          {page?.head ? (
            <>
              {' '}
              Head hash <span className="dcx__mono">{shortHash(page.head.hash, 16)}</span>.
            </>
          ) : null}
        </p>
        <div className="dcx__row">
          <button type="button" className="dcx-btn" onClick={() => void runVerify()} disabled={verifying} data-desk-verify>
            {verifying ? 'Replaying…' : 'Verify the chain'}
          </button>
          {detail.entitlements.blotterExport ? (
            <button type="button" className="dcx-btn" onClick={() => void exportCsv()} disabled={exporting} data-desk-csv>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          ) : (
            <span className="dcx__faint text-[12.5px]" data-desk-csv-locked>
              CSV export is on the {planWord(exportPlan)} plan and up.{' '}
              <Link href="/pricing#desk" className="underline underline-offset-2">
                Desk plans
              </Link>
            </span>
          )}
        </div>
        {verify && (
          <div className="mt-3" data-desk-verified={v ? (v.ok ? 'ok' : `broken-${v.brokenAt}`) : 'error'}>
            {v ? (
              v.ok ? (
                <p className="dcx-note dcx-note--ok">
                  The chain verifies: {v.rows} row{v.rows === 1 ? '' : 's'} replayed from genesis{v.head ? `, head seq ${v.head.seq} · ${shortHash(v.head.hash, 16)}` : ''}.
                </p>
              ) : (
                <p className="dcx-note dcx-note--bad">
                  Broken at seq {v.brokenAt}: {v.reason}. {v.head ? `The last good row is seq ${v.head.seq}.` : ''}
                </p>
              )
            ) : (
              <AnswerNote answer={verify} />
            )}
          </div>
        )}
        {csv && (
          <div className="mt-3">
            <AnswerNote answer={csv} ok="The CSV is downloading: every column, prev_hash + hash, and each payload as the JSON the hash covers." tag="csv" />
          </div>
        )}
      </Card>

      <Card>
        <form className="dcx-filters" onSubmit={apply} data-desk-filters>
          <label className="dcx-field">
            Kind
            <select className="dcx-select" value={kind} onChange={(e) => setKind(e.target.value)} name="kind">
              <option value="">Every kind</option>
              {vocab.kinds.map((k) => (
                <option key={k} value={k} title={vocab.kindWords[k]}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="dcx-field">
            From (UTC day)
            <input className="dcx-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} name="from" />
          </label>
          <label className="dcx-field">
            To (that day included)
            <input className="dcx-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} name="to" />
          </label>
          <button type="submit" className="dcx-btn dcx-btn--solid" disabled={busy}>
            {busy ? 'Reading…' : 'Apply'}
          </button>
        </form>
        {applied.kind && <p className="dcx__faint text-[12.5px] mt-2">{applied.kind}: {vocab.kindWords[applied.kind]}</p>}
        <div className="mt-3">
          <AnswerNote answer={answer} tag="blotter" />
        </div>
        {rows.length === 0 && !busy && !answer ? (
          <p className="dcx__p mt-2" data-desk-blotter-empty>
            No rows{applied.kind || applied.from || applied.to ? ' match these filters' : ' yet'}.
          </p>
        ) : (
          <div className="dcx-tablewrap mt-2">
            <table className="dcx-table" data-desk-blotter>
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>Kind</th>
                  <th>Time</th>
                  <th>Venue</th>
                  <th>Chain</th>
                  <th>Value</th>
                  <th>Fee</th>
                  <th>Tx</th>
                  <th>Verification</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tx = explorerTx(r.chainId, r.txHash, vocab)
                  return (
                    <Fragment key={r.seq}>
                      <tr className={open === r.seq ? 'is-open' : ''} data-blotter-kind={r.kind}>
                        <td data-col="seq" className="mono">
                          <button type="button" className="dcx-rowbtn" onClick={() => setOpen(open === r.seq ? null : r.seq)} aria-expanded={open === r.seq} title="Show the row">
                            {r.seq}
                          </button>
                        </td>
                        <td data-col="kind" className="mono" title={vocab.kindWords[r.kind]}>
                          {r.kind}
                        </td>
                        <td data-col="time" className="mono">
                          {when(r.createdAt)}
                        </td>
                        <td data-col="venue" data-empty={r.venue ? undefined : ''}>{r.venue ?? '—'}</td>
                        <td data-col="chain" data-empty={r.chainId == null ? '' : undefined}>{r.chainId == null ? '—' : chainWord(r.chainId, vocab)}</td>
                        <td data-col="value" className="num" data-empty={r.valueUsd == null ? '' : undefined}>
                          {fmtUsd(r.valueUsd)}
                        </td>
                        <td data-col="fee" className="num" data-empty={r.feeUsd == null ? '' : undefined}>
                          {r.feeUsd == null ? '—' : `${fmtUsd(r.feeUsd)}${r.feeBps != null ? ` · ${r.feeBps} bps` : ''}`}
                        </td>
                        <td data-col="tx" className="mono" data-empty={r.txHash ? undefined : ''}>
                          {r.txHash ? (
                            tx ? (
                              <a href={tx} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                                {shortHash(r.txHash)}
                              </a>
                            ) : (
                              shortHash(r.txHash)
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                        <td data-col="verification" data-empty={r.verification ? undefined : ''}>{r.verification ? <span className={`dcx-pill ${r.verification === 'verified' ? 'dcx-pill--ok' : r.verification === 'mismatch' ? 'dcx-pill--bad' : ''}`}>{r.verification}</span> : '—'}</td>
                      </tr>
                      {open === r.seq && (
                        <tr className="is-open">
                          <td colSpan={9} className="dcx-detail">
                            <RowDetail r={r} words={vocab.kindWords[r.kind]} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {page?.next ? (
          <div className="mt-3">
            <button type="button" className="dcx-btn" disabled={busy} onClick={() => void read(applied, page.next)}>
              {busy ? 'Reading…' : `Load the next ${PAGE}`}
            </button>
          </div>
        ) : null}
      </Card>
    </div>
  )
}

function RowDetail({ r, words }: { r: BlotterRowJson; words: string | undefined }) {
  const ids = [
    ['intent', r.intentId],
    ['job', r.jobId],
    ['desk', r.deskId],
    ['key', r.keyId],
  ].filter(([, v]) => v)
  return (
    <div className="dcx__stack">
      {words && <span className="dcx__muted text-[12.5px]">{words}</span>}
      <dl className="dcx-kv">
        {ids.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd className="dcx__mono">{v}</dd>
          </Fragment>
        ))}
        <dt>prev hash</dt>
        <dd className="dcx__mono">{r.prevHash}</dd>
        <dt>hash</dt>
        <dd className="dcx__mono">{r.hash}</dd>
      </dl>
      <pre className="dcx-json">{policyJson(r.payload ?? {})}</pre>
    </div>
  )
}
