'use client'

// components/desk/PolicySection.tsx — the tenant's policy, maker-checker
// (squad five-million, CONSOLE lane, 2026-11-03).
//
// The ACTIVE document read-only, with the contract's vocabulary beside it
// (every value from lib/tenant/spec, handed down as props); what the policy
// admits, venue by venue; the pending proposals (a proposer under
// maker-checker waits for a second admin; anyone else may approve or reject —
// the API decides and its refusal prints verbatim); and "Propose a change", a
// JSON editor shape-checked in the browser before POST /api/tenants/:id/policy.

import { useEffect, useMemo, useState } from 'react'
import { Card, CardTitle } from '@/lib/dashboard-ui'
import { call, type Answer } from './api'
import { chainWord, proposalSeat, ruleLines, shortAddr, when } from './derive'
import { checkPolicyText, policyDocJson } from './policy-check'
import { AnswerNote } from './ui'
import type { DeskVocab, PolicyVersionJson, TenantDetailJson, TenantPolicyDoc } from './types'

export default function PolicySection({ detail, policies, vocab, reload }: { detail: TenantDetailJson; policies: PolicyVersionJson[] | null; vocab: DeskVocab; reload: () => Promise<void> }) {
  const t = detail.tenant
  const active = detail.policy
  const makerChecker = detail.entitlements.approvals
  const viewer = detail.you.address
  const pending = (policies ?? detail.versions).filter((p) => p.state === 'proposed')
  const history = (policies ?? detail.versions).filter((p) => p.state !== 'proposed' && p.state !== 'active')

  return (
    <div className="dcx" data-desk-section="policy">
      <Card>
        <CardTitle serif eyebrow={active ? `ACTIVE · VERSION ${active.version}` : 'NO ACTIVE POLICY'}>
          {active ? 'The policy every order answers to' : 'Nothing trades until a policy is active'}
        </CardTitle>
        {active ? (
          <ActiveMeta versions={policies ?? detail.versions} version={active.version} />
        ) : (
          <p className="dcx__p">
            With no active policy the gate refuses every order by name (NO_POLICY), and no desk key can be minted. Propose
            one below{makerChecker ? '; a second admin approves it.' : '; your plan has no maker-checker, so you may activate it yourself.'}
          </p>
        )}
        {active && (
          <>
            <h3 className="dcx__h3 mt-4">What it admits</h3>
            <div className="dcx-rules" data-desk-rules>
              {active.document.venues.length === 0 && <p className="dcx__p">No venue rule: every order is refused (VENUE_DENIED).</p>}
              {active.document.venues.map((r, i) => (
                <div className="dcx-rule" key={`${r.venue}-${i}`}>
                  <span className="dcx-rule__venue">{r.venue}</span>
                  <dl className="dcx-kv">
                    {ruleLines(r, vocab).map((l) => (
                      <Pair key={l.k} k={l.k} v={l.v} />
                    ))}
                  </dl>
                </div>
              ))}
            </div>
            <details className="dcx-details mt-3">
              <summary>The document, as stored (read-only JSON)</summary>
              <pre className="dcx-json" data-desk-active-json>
                {policyDocJson(active.document)}
              </pre>
            </details>
          </>
        )}
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardTitle serif eyebrow={`PROPOSED · ${pending.length}`}>
            Waiting for a decision
          </CardTitle>
          <div className="dcx-list">
            {pending.map((p) => (
              <Proposal key={p.version} tenantId={t.id} p={p} seat={proposalSeat(p, viewer, makerChecker)} makerChecker={makerChecker} reload={reload} />
            ))}
          </div>
        </Card>
      )}

      <Proposer tenantId={t.id} vocab={vocab} active={active?.document ?? null} activeVersion={active?.version ?? null} makerChecker={makerChecker} hooks={detail.entitlements.hooks} reload={reload} />

      <Card>
        <CardTitle serif eyebrow="THE VOCABULARY">
          What a policy can say
        </CardTitle>
        <Vocabulary vocab={vocab} />
      </Card>

      {history.length > 0 && (
        <Card>
          <details className="dcx-details">
            <summary>Version history · {history.length}</summary>
            <div className="dcx-list mt-2">
              {history.map((p) => (
                <div className="dcx-item" key={p.version}>
                  <div className="dcx-item__main">
                    <span className="dcx__row">
                      <span className="dcx__mono text-[13px]">v{p.version}</span>
                      <span className={`dcx-pill ${p.state === 'rejected' ? 'dcx-pill--bad' : ''}`}>{p.state}</span>
                    </span>
                    <span className="dcx__faint text-[12px]">
                      proposed by {shortAddr(p.proposedBy)} {when(p.createdAt)}
                      {p.approvedBy ? ` · ${p.state === 'rejected' ? 'rejected' : 'approved'} by ${shortAddr(p.approvedBy)}` : ''}
                      {p.note ? ` · “${p.note}”` : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </Card>
      )}
    </div>
  )
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  )
}

function ActiveMeta({ versions, version }: { versions: PolicyVersionJson[]; version: number }) {
  const row = versions.find((v) => v.version === version)
  if (!row) return null
  return (
    <p className="dcx__p">
      Proposed by <span className="dcx__mono">{shortAddr(row.proposedBy)}</span>
      {row.approvedBy ? (
        <>
          {', approved by '}
          <span className="dcx__mono">{shortAddr(row.approvedBy)}</span>
          {row.approvedBy.toLowerCase() === row.proposedBy.toLowerCase() ? ' (the proposer, on a plan without maker-checker)' : ''}
        </>
      ) : null}
      {row.activatedAt ? `, active since ${when(row.activatedAt)}` : ''}.{row.note ? ` Note: “${row.note}”.` : ''}
    </p>
  )
}

function Proposal({ tenantId, p, seat, makerChecker, reload }: { tenantId: string; p: PolicyVersionJson; seat: 'awaiting-second-admin' | 'approve'; makerChecker: boolean; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const act = async (verb: 'approve' | 'reject') => {
    setBusy(verb)
    setAnswer(null)
    const a = await call('POST', `/api/tenants/${tenantId}/policy/${p.version}/${verb}`, verb === 'reject' ? {} : undefined)
    setBusy(null)
    setAnswer(a)
    if (a.ok) {
      setOk(verb === 'approve' ? `Version ${p.version} is active.` : `Version ${p.version} was rejected; the active policy stands.`)
      await reload()
    }
  }
  return (
    <div className="dcx-version" data-desk-proposal={p.version}>
      <div className="dcx__row dcx__row--between">
        <span className="dcx__row">
          <span className="dcx__mono text-[13px]">v{p.version}</span>
          <span className="dcx-pill dcx-pill--warn">proposed</span>
          <span className="dcx__faint text-[12px]">
            by {shortAddr(p.proposedBy)} · {when(p.createdAt)}
          </span>
        </span>
        <span className="dcx__row">
          {seat === 'awaiting-second-admin' ? (
            <span className="dcx__muted text-[12.5px]" data-desk-awaiting>
              Awaiting a second admin: you proposed it, and maker-checker needs a different admin to approve.
            </span>
          ) : (
            <button type="button" className="dcx-btn dcx-btn--small dcx-btn--accent" disabled={!!busy} onClick={() => void act('approve')}>
              {busy === 'approve' ? 'Approving…' : makerChecker ? 'Approve' : 'Approve and activate'}
            </button>
          )}
          <button type="button" className="dcx-btn dcx-btn--small dcx-btn--danger" disabled={!!busy} onClick={() => void act('reject')}>
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
        </span>
      </div>
      {p.note && <p className="dcx__p">“{p.note}”</p>}
      {p.document && (
        <details className="dcx-details">
          <summary>The proposed document</summary>
          <pre className="dcx-json">{policyDocJson(p.document)}</pre>
        </details>
      )}
      <AnswerNote answer={answer} ok={ok} tag="policy" />
    </div>
  )
}

function Proposer({ tenantId, vocab, active, activeVersion, makerChecker, hooks, reload }: { tenantId: string; vocab: DeskVocab; active: TenantPolicyDoc | null; activeVersion: number | null; makerChecker: boolean; hooks: boolean; reload: () => Promise<void> }) {
  const [text, setText] = useState(() => policyDocJson(active ?? vocab.sample))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer<{ version?: number; next?: string }> | null>(null)
  // A new active version (an approval) refills the editor once; a reload
  // that changed nothing leaves an edit in progress alone.
  useEffect(() => {
    setText(policyDocJson(active ?? vocab.sample))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersion])
  const check = useMemo(() => checkPolicyText(text, vocab), [text, vocab])
  const unchanged = active ? text.trim() === policyDocJson(active).trim() : false

  const submit = async () => {
    if (!check.ok) return
    setBusy(true)
    setAnswer(null)
    const a = await call<{ version?: number; next?: string }>('POST', `/api/tenants/${tenantId}/policy`, { document: check.doc, ...(note.trim() ? { note: note.trim() } : {}) })
    setBusy(false)
    setAnswer(a)
    if (a.ok) {
      setNote('')
      await reload()
    }
  }

  return (
    <Card>
      <CardTitle serif eyebrow="PROPOSE A CHANGE">
        {active ? 'Edit the policy as a new version' : 'Propose the first policy'}
      </CardTitle>
      <p className="dcx__p mb-3">
        {active ? 'Prefilled with the active document. ' : 'Prefilled with the README’s demo policy: CoW and Uniswap v3 on Base, $500 an order, one desk “macro” with one approval over $250. '}
        A proposal never trades: it becomes version N+1 in state “proposed”, and the active policy stands until{' '}
        {makerChecker ? 'a different admin approves it.' : 'it is approved (on your plan the proposer may approve it).'}
        {hooks ? '' : ' Pre/post-trade hooks need a plan with hooks.'}
      </p>
      <label className="dcx-field">
        <span className="sr-only">Policy document (JSON)</span>
        <textarea className="dcx-textarea" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" rows={18} aria-describedby="dcx-policy-check" data-desk-editor />
      </label>
      <p id="dcx-policy-check" className={`dcx-note mt-2 ${check.ok ? 'dcx-note--ok' : 'dcx-note--bad'}`} data-desk-check={check.ok ? 'ok' : check.field}>
        {check.ok ? (unchanged ? 'Shape OK — and identical to the active version.' : 'Shape OK. The server checks it again when you propose.') : check.error}
      </p>
      <div className="dcx-form dcx-form--trio mt-3">
        <label className="dcx-field">
          Note for the approver (optional)
          <input className="dcx-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="Why this change" />
        </label>
        <button type="button" className="dcx-btn" onClick={() => setText(policyDocJson(active ?? vocab.sample))}>
          {active ? 'Reset to active' : 'Reset to the sample'}
        </button>
        <button type="button" className="dcx-btn dcx-btn--solid" disabled={busy || !check.ok || unchanged} onClick={() => void submit()} data-desk-propose>
          {busy ? 'Proposing…' : 'Propose'}
        </button>
      </div>
      <div className="mt-3">
        <AnswerNote answer={answer} ok={answer?.ok ? `Proposed as version ${answer.json?.version}. ${answer.json?.next ?? ''}`.trim() : null} tag="proposed" />
      </div>
    </Card>
  )
}

function Vocabulary({ vocab }: { vocab: DeskVocab }) {
  const chainIds = Object.keys(vocab.chainNames).map(Number)
  return (
    <div className="dcx__stack">
      <p className="dcx__p">
        Version 1 is default-deny: an order no venue rule admits is refused. A rule can only narrow what its venue runs on;
        an omitted list means “all of them” for that field.
      </p>
      <dl className="dcx-vocab" data-desk-vocab>
        <dt>venues[].venue</dt>
        <dd>
          A guarded builder family, and the chains it runs on:
          <span className="dcx__stack mt-1">
            {vocab.venues.map((v) => (
              <span key={v}>
                <span className="dcx-chip">{v}</span>{' '}
                <span className="dcx__faint text-[12px]">{vocab.venueChains[v] === null ? 'off-chain (the venue signs its own actions)' : (vocab.venueChains[v] ?? []).map((c) => chainWord(c, vocab)).join(' · ')}</span>
              </span>
            ))}
          </span>
        </dd>
        <dt>chains</dt>
        <dd>
          Chain ids, inside the venue’s own list. Omitted: every chain the venue runs on. A sandbox tenant only reaches{' '}
          {vocab.testnets.filter((c) => vocab.chainNames[String(c)]).map((c) => `${chainWord(c, vocab)} (${c})`).join(', ')} and the Hyperliquid testnet.
          <span className="dcx-chips mt-1">
            {chainIds.map((c) => (
              <span className="dcx-chip" key={c}>
                {c} {chainWord(c, vocab)}
              </span>
            ))}
          </span>
        </dd>
        <dt>ops</dt>
        <dd>
          What the order does. Omitted: every op the venue has. A perp-close only reduces exposure, so size caps never trap it.
          <span className="dcx-chips mt-1">
            {vocab.ops.map((o) => (
              <span className="dcx-chip" key={o}>
                {o}
              </span>
            ))}
          </span>
        </dd>
        <dt>sides</dt>
        <dd>
          Omitted: any side.
          <span className="dcx-chips mt-1">
            {vocab.sides.map((s) => (
              <span className="dcx-chip" key={s}>
                {s}
              </span>
            ))}
          </span>
        </dd>
        <dt>tokens</dt>
        <dd>Symbols in capitals, or 0x addresses. When a rule lists tokens, every token the order touches must be on the list.</dd>
        <dt>caps</dt>
        <dd>
          <span className="dcx__mono">maxOrderUsd</span>, <span className="dcx__mono">maxPriceImpactBps</span> and <span className="dcx__mono">maxLeverage</span> cap each
          order on the rule. An order the desk cannot price is refused (UNPRICED), never waved through.
        </dd>
        <dt>desks[]</dt>
        <dd>
          Each desk key is bound to one desk id. <span className="dcx__mono">perOrderUsd</span>, <span className="dcx__mono">perDayUsd</span> (the UTC day,
          summed from the blotter’s signed rows), <span className="dcx__mono">approvals</span> {'{ overUsd, approvers }'} (distinct admins), and{' '}
          <span className="dcx__mono">hours</span> {'{ tz, from, to, days }'} in an IANA zone, 24-hour HH:MM, days 0–6 with Sunday = 0.
        </dd>
        <dt>signing</dt>
        <dd>
          {'{ lane, wallets }'}; lanes:{' '}
          <span className="dcx-chips">
            {vocab.lanes.map((l) => (
              <span className="dcx-chip" key={l}>
                {l}
              </span>
            ))}
          </span>
        </dd>
        <dt>hooks</dt>
        <dd>{'{ preTrade, postTrade }'}: https URLs, on a plan with hooks.</dd>
      </dl>
    </div>
  )
}
