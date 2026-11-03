'use client'

// components/desk/TenantConsole.tsx — /dashboard/desk/[id]: one governed desk
// (squad five-million, CONSOLE lane, 2026-11-03).
//
// The header (name, slug, status, sandbox, the plan line, the active policy
// version) over seven sections: Policy · Desks · Keys · Approvals · Blotter ·
// Statement · Settings, the open one in `?tab=` so a link opens on it. A
// section mounts the first time it opens and then stays mounted (hidden), so
// a half-written proposal or a just-minted key survives a tab switch.
//
// Reads GET /api/tenants/:id (tenant, entitlements, active policy, versions,
// keys, you) and GET …/policy (the documents); the approvals queue is read
// off the blotter (no list route exists — CONSOLE.md Spec asks). The
// dashboard layout above is the SIWE gate; a wallet that is not an admin of
// this tenant gets the route's 404 ("Not found."), the same answer as no
// tenant at all.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardTitle, SkeletonCard } from '@/lib/dashboard-ui'
import { call, refusalText, type Answer } from './api'
import { approvalQueue, blotterQuery, deskLines, fmtUsd, planLine, shortAddr, when, type ApprovalItem } from './derive'
import PolicySection from './PolicySection'
import KeysSection from './KeysSection'
import BlotterSection from './BlotterSection'
import StatementSection from './StatementSection'
import SettingsSection from './SettingsSection'
import { AnswerNote } from './ui'
import type { BlotterPageJson, BlotterRowJson, DeskVocab, PolicyVersionJson, TenantDetailJson } from './types'
import './desk-console.css'

export const DESK_TABS = ['policy', 'desks', 'keys', 'approvals', 'blotter', 'statement', 'settings'] as const
export type DeskTab = (typeof DESK_TABS)[number]
const TAB_WORDS: Record<DeskTab, string> = {
  policy: 'Policy',
  desks: 'Desks',
  keys: 'Keys',
  approvals: 'Approvals',
  blotter: 'Blotter',
  statement: 'Statement',
  settings: 'Settings',
}

/** How far back the approvals queue reads the blotter. */
const QUEUE_DAYS = 14

export default function TenantConsole({ tenantId, vocab }: { tenantId: string; vocab: DeskVocab }) {
  const [detail, setDetail] = useState<TenantDetailJson | null>(null)
  const [policies, setPolicies] = useState<PolicyVersionJson[] | null>(null)
  const [failed, setFailed] = useState<Answer | null>(null)
  const [tab, setTab] = useState<DeskTab>('policy')
  const [seen, setSeen] = useState<Set<DeskTab>>(() => new Set(['policy']))
  const [queue, setQueue] = useState<ApprovalItem[] | null>(null)
  const [queueNote, setQueueNote] = useState<Answer | null>(null)
  const [presetDesk, setPresetDesk] = useState<string | null>(null)

  const loadQueue = useCallback(
    async (viewer: string) => {
      const from = new Date(Date.now() - QUEUE_DAYS * 86_400_000).toISOString().slice(0, 10)
      const rows: BlotterRowJson[] = []
      let after: number | null = null
      for (let i = 0; i < 5; i++) {
        const a: Answer<BlotterPageJson> = await call<BlotterPageJson>('GET', `/api/tenants/${tenantId}/blotter${blotterQuery({ kind: 'intent,policy_verdict,approval', from, after, limit: 1000 })}`)
        if (!a.ok || !a.json) {
          setQueueNote(a)
          return
        }
        rows.push(...a.json.rows)
        if (!a.json.next) break
        after = a.json.next
      }
      setQueueNote(null)
      setQueue(approvalQueue(rows, viewer))
    },
    [tenantId],
  )

  const load = useCallback(async () => {
    const [d, p] = await Promise.all([call<TenantDetailJson>('GET', `/api/tenants/${tenantId}`), call<{ policies: PolicyVersionJson[] }>('GET', `/api/tenants/${tenantId}/policy`)])
    if (!d.ok || !d.json) return setFailed(d)
    setFailed(null)
    setDetail(d.json)
    if (p.ok && p.json) setPolicies(p.json.policies)
    void loadQueue(d.json.you.address)
  }, [tenantId, loadQueue])
  useEffect(() => {
    void load()
  }, [load])

  // ?tab= opens a section; switching writes it back without a navigation.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab')
    if (q && (DESK_TABS as readonly string[]).includes(q)) open(q as DeskTab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const open = (next: DeskTab) => {
    setTab(next)

    setSeen((s) => (s.has(next) ? s : new Set([...s, next])))
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', next)
      window.history.replaceState(window.history.state, '', url.toString())
    } catch {
      /* the URL is a convenience */
    }
  }

  // On a phone the tab strip scrolls sideways: keep the open tab in it (the
  // strip only — never the page). Runs once the tabs exist (after the read).
  const hasDetail = !!detail
  useEffect(() => {
    if (!hasDetail) return
    const btn = document.querySelector<HTMLElement>(`[data-desk-tab="${tab}"]`)
    const strip = btn?.parentElement
    if (!btn || !strip) return
    const l = btn.offsetLeft - strip.offsetLeft
    if (l < strip.scrollLeft || l + btn.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, l - 16)
  }, [tab, hasDetail])

  const awaiting = useMemo(() => queue?.filter((q) => q.state === 'awaiting').length ?? 0, [queue])
  const proposed = (policies ?? detail?.versions ?? []).filter((v) => v.state === 'proposed').length

  if (failed) {
    return (
      <div className="dcx">
        <Link href="/dashboard/desk" className="dcx__back">
          ← All tenants
        </Link>
        <Card>
          <p className="dcx__p" data-desk-failed={failed.status}>
            {failed.status === 404 ? 'No tenant here that this wallet administers. (A tenant id never confirms itself to a stranger.)' : refusalText(failed)}
          </p>
        </Card>
      </div>
    )
  }
  if (!detail) return <SkeletonCard />

  const t = detail.tenant
  const liveKeys = detail.keys.filter((k) => !k.revoked).length
  return (
    <div className="dcx" data-desk-console="tenant" data-tenant-id={t.id}>
      <Link href="/dashboard/desk" className="dcx__back">
        ← All tenants
      </Link>
      <header className="dcx-head">
        <div className="dcx-head__title">
          <h1 className="dash__h1 !mb-0">{t.name}</h1>
          <span className={`dcx-pill ${t.status === 'active' ? 'dcx-pill--ok' : 'dcx-pill--warn'}`} data-desk-status={t.status}>
            {t.status}
          </span>
          {t.sandbox && (
            <span className="dcx-pill dcx-pill--accent" data-desk-sandbox-badge>
              sandbox
            </span>
          )}
        </div>
        <p className="dcx__faint text-[12.5px] dcx__mono">
          {t.slug} · {detail.you.owner ? 'you own it' : `owner ${shortAddr(t.ownerAddress)}`} ·{' '}
          {detail.policy ? `policy v${detail.policy.version} active` : 'no active policy'}
        </p>
        <p className="dcx-plan" data-desk-plan>
          {planLine(t.plan, detail.entitlements, { keys: liveKeys }).map((p) => (
            <span key={p}>{p}</span>
          ))}
          <span>
            <Link href="/pricing#desk">Desk plans</Link>
          </span>
        </p>
      </header>

      <nav className="dcx-tabs" aria-label="Tenant sections" role="tablist">
        {DESK_TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`dcx-tab ${tab === k ? 'is-on' : ''}`} onClick={() => open(k)} data-desk-tab={k}>
            {TAB_WORDS[k]}
            {k === 'approvals' && awaiting > 0 && <span className="dcx-tab__n">{awaiting}</span>}
            {k === 'policy' && proposed > 0 && <span className="dcx-tab__n">{proposed}</span>}
          </button>
        ))}
      </nav>

      {DESK_TABS.map((k) =>
        seen.has(k) ? (
          <div key={k} hidden={tab !== k} role="tabpanel">
            {k === 'policy' && <PolicySection detail={detail} policies={policies} vocab={vocab} reload={load} />}
            {k === 'desks' && (
              <DesksSection
                detail={detail}
                onMint={(d) => {
                  setPresetDesk(d)
                  open('keys')
                }}
              />
            )}
            {k === 'keys' && <KeysSection detail={detail} reload={load} presetDesk={presetDesk} />}
            {k === 'approvals' && <ApprovalsSection detail={detail} queue={queue} queueNote={queueNote} reload={load} />}
            {k === 'blotter' && <BlotterSection detail={detail} vocab={vocab} />}
            {k === 'statement' && <StatementSection detail={detail} />}
            {k === 'settings' && <SettingsSection detail={detail} vocab={vocab} reload={load} />}
          </div>
        ) : null,
      )}
    </div>
  )
}

function DesksSection({ detail, onMint }: { detail: TenantDetailJson; onMint: (deskId: string) => void }) {
  const desks = detail.policy?.document.desks ?? []
  const keysOn = (id: string) => detail.keys.filter((k) => !k.revoked && k.deskId === id).length
  return (
    <div className="dcx" data-desk-section="desks">
      {desks.length === 0 ? (
        <Card>
          <p className="dcx__p">No active policy, so no desks. A policy names its desks; each desk key is bound to one of them.</p>
        </Card>
      ) : (
        <div className="dcx-rules">
          {desks.map((d) => (
            <Card key={d.id}>
              <div className="dcx__row dcx__row--between mb-2">
                <span className="dcx-rule__venue">{d.id}</span>
                <span className="dcx__faint text-[12px]">{keysOn(d.id)} live key{keysOn(d.id) === 1 ? '' : 's'}</span>
              </div>
              <dl className="dcx-kv" data-desk-desk={d.id}>
                {deskLines(d).map((l) => (
                  <PairRow key={l.k} k={l.k} v={l.v} />
                ))}
              </dl>
              <div className="mt-3">
                <button type="button" className="dcx-btn dcx-btn--small" onClick={() => onMint(d.id)}>
                  Mint a key for {d.id}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="dcx__faint text-[12.5px]">Desks come from the active policy; change them by proposing a new version on the Policy tab.</p>
    </div>
  )
}

function PairRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  )
}

function ApprovalsSection({ detail, queue, queueNote, reload }: { detail: TenantDetailJson; queue: ApprovalItem[] | null; queueNote: Answer | null; reload: () => Promise<void> }) {
  const awaiting = queue?.filter((q) => q.state === 'awaiting') ?? []
  const done = queue?.filter((q) => q.state !== 'awaiting').slice(0, 10) ?? []
  const thresholds = (detail.policy?.document.desks ?? []).filter((d) => d.approvals)
  return (
    <div className="dcx" data-desk-section="approvals">
      <Card>
        <CardTitle serif eyebrow={`AWAITING · ${awaiting.length}`}>
          Intents waiting for an admin
        </CardTitle>
        <p className="dcx__p mb-3">
          An order over a desk’s approval threshold waits here until enough DISTINCT admins approve it; the agent’s next
          handoff or execute then proceeds (both re-judge it against the active policy).{' '}
          {thresholds.length
            ? thresholds.map((d) => `${d.id}: over ${fmtUsd(d.approvals!.overUsd, 0)}, ${d.approvals!.approvers} approver${d.approvals!.approvers === 1 ? '' : 's'}`).join(' · ') + '.'
            : 'No desk in the active policy has an approval threshold.'}{' '}
          Read off the blotter for the last {QUEUE_DAYS} days.
        </p>
        <AnswerNote answer={queueNote} tag="queue" />
        {queue === null && !queueNote && <p className="dcx__faint text-[12.5px]">Reading the blotter…</p>}
        {queue !== null && awaiting.length === 0 && <p className="dcx__p" data-desk-queue-empty>Nothing is waiting.</p>}
        <div className="dcx-list">
          {awaiting.map((q) => (
            <ApprovalRow key={q.intentId} tenantId={detail.tenant.id} q={q} reload={reload} />
          ))}
        </div>
      </Card>
      {done.length > 0 && (
        <Card>
          <CardTitle serif eyebrow="RECENT">
            Approved or refused
          </CardTitle>
          <div className="dcx-list">
            {done.map((q) => (
              <div className="dcx-item" key={q.intentId}>
                <div className="dcx-item__main">
                  <span className="dcx__row">
                    <span className="text-[13.5px]">{q.ask ?? q.intentId}</span>
                    <span className={`dcx-pill ${q.state === 'approved' ? 'dcx-pill--ok' : 'dcx-pill--bad'}`}>{q.state === 'approved' ? `approved ${q.have}/${q.needed}` : q.reason ?? 'refused'}</span>
                  </span>
                  <span className="dcx__faint text-[12px] dcx__mono">
                    {q.intentId} · {q.approvers.map(shortAddr).join(', ') || 'no approvals'} · {when(q.lastAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function ApprovalRow({ tenantId, q, reload }: { tenantId: string; q: ApprovalItem; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer<{ next?: string }> | null>(null)
  const approve = async () => {
    setBusy(true)
    const a = await call<{ next?: string }>('POST', `/api/tenants/${tenantId}/intents/${q.intentId}/approve`)
    setBusy(false)
    setAnswer(a)
    if (a.ok) await reload()
  }
  return (
    <div className="dcx-item" data-desk-approval={q.intentId}>
      <div className="dcx-item__main">
        <span className="text-[14px] text-[color:var(--fg)]">{q.ask ?? 'An over-threshold order'}</span>
        <span className="dcx__faint text-[12px]">
          {fmtUsd(q.usd)} · desk {q.deskId ?? '—'} · {q.have} of {q.needed} approval{q.needed === 1 ? '' : 's'}
          {q.approvers.length ? ` (${q.approvers.map(shortAddr).join(', ')})` : ''} · {when(q.lastAt)}
        </span>
        <span className="dcx__faint text-[11.5px] dcx__mono">intent {q.intentId}</span>
        <AnswerNote answer={answer} ok={answer?.ok ? (answer.json?.next ?? 'Approved.') : null} tag="approval" />
      </div>
      <div className="dcx-item__acts">
        {q.mine ? (
          <span className="dcx__muted text-[12.5px]">You approved it; {q.needed - q.have} more distinct admin{q.needed - q.have === 1 ? '' : 's'} needed.</span>
        ) : (
          <button type="button" className="dcx-btn dcx-btn--accent dcx-btn--small" disabled={busy} onClick={() => void approve()}>
            {busy ? 'Approving…' : 'Approve'}
          </button>
        )}
      </div>
    </div>
  )
}
