'use client'

// components/desk/KeysSection.tsx — desk keys: mint, pause, resume, revoke
// (squad five-million, CONSOLE lane, 2026-11-03).
//
// POST /api/tenants/:id/keys { deskId, label } answers the dk_ secret ONCE;
// the console shows it in a copy box that says so and keeps it only in this
// component's state (never storage, never the URL) until the admin closes
// it. The desk picker reads the ACTIVE policy's desks — the route refuses any
// other id. PATCH { paused } pauses / resumes; DELETE revokes, final, behind
// an inline confirm.

import { useEffect, useState } from 'react'
import { Card, CardTitle } from '@/lib/dashboard-ui'
import { call, type Answer } from './api'
import { capWords, when } from './derive'
import { AnswerNote, ConfirmButton } from './ui'
import type { KeyJson, TenantDetailJson } from './types'

interface Minted extends KeyJson {
  secret: string
  note?: string
}

export default function KeysSection({ detail, reload, presetDesk }: { detail: TenantDetailJson; reload: () => Promise<void>; presetDesk: string | null }) {
  const t = detail.tenant
  const desks = detail.policy?.document.desks.map((d) => d.id) ?? []
  const live = detail.keys.filter((k) => !k.revoked)
  const revoked = detail.keys.filter((k) => k.revoked)
  const [deskId, setDeskId] = useState(presetDesk && desks.includes(presetDesk) ? presetDesk : (desks[0] ?? ''))
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [minted, setMinted] = useState<Minted | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (presetDesk && desks.includes(presetDesk)) setDeskId(presetDesk)
    else if (!desks.includes(deskId)) setDeskId(desks[0] ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetDesk, desks.join(',')])

  const mint = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setAnswer(null)
    setCopied(false)
    const a = await call<Minted>('POST', `/api/tenants/${t.id}/keys`, { deskId, ...(label.trim() ? { label: label.trim() } : {}) })
    setBusy(false)
    if (a.ok && a.json?.secret) {
      setMinted(a.json)
      setLabel('')
      await reload()
    } else setAnswer(a)
  }

  const copy = async () => {
    if (!minted) return
    try {
      await navigator.clipboard.writeText(minted.secret)
      setCopied(true)
    } catch {
      const el = document.getElementById('dcx-secret-value')
      if (el) window.getSelection()?.selectAllChildren(el)
    }
  }

  return (
    <div className="dcx" data-desk-section="keys">
      <Card>
        <CardTitle serif eyebrow={`DESK KEYS · ${capWords(live.length, detail.entitlements.keysPerTenant)} LIVE`}>
          Mint a key for an agent
        </CardTitle>
        <p className="dcx__p mb-3">
          A desk key is bound to this tenant and to one desk in the active policy, so it can never widen what the policy
          admits. An agent presents it as <span className="dcx__mono">Authorization: Bearer {'<key>'}</span> on <span className="dcx__mono">/api/broker/mcp</span>. Only its
          hash is stored.
        </p>
        {desks.length === 0 ? (
          <p className="dcx-note dcx-note--warn">There is no active policy, so there is no desk to bind a key to. Activate a policy first.</p>
        ) : (
          <form className="dcx-form" onSubmit={(e) => void mint(e)} data-desk-mint>
            <label className="dcx-field">
              Desk (from the active policy)
              <select className="dcx-select" value={deskId} onChange={(e) => setDeskId(e.target.value)} name="deskId">
                {desks.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="dcx-field">
              Label
              <input className="dcx-input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="rebalancer agent" autoComplete="off" name="label" />
            </label>
            <button type="submit" className="dcx-btn dcx-btn--solid" disabled={busy || !deskId}>
              {busy ? 'Minting…' : 'Mint key'}
            </button>
          </form>
        )}
        <div className="mt-3">
          <AnswerNote answer={answer} tag="mint" />
        </div>
        {minted && (
          <div className="dcx-secret mt-3" data-desk-secret>
            <span className="dcx__eyebrow">Shown once</span>
            <p className="dcx__p">
              This is the only time the key is shown. Store it now in your agent’s secret store; the desk keeps only its hash
              and its prefix <span className="dcx__mono">{minted.prefix}…</span>. Lose it and you mint another.
            </p>
            <code id="dcx-secret-value" className="dcx-secret__value">
              {minted.secret}
            </code>
            <span className="dcx__row">
              <button type="button" className="dcx-btn dcx-btn--accent" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy key'}
              </button>
              <button type="button" className="dcx-btn" onClick={() => setMinted(null)}>
                I stored it — hide
              </button>
              <span className="dcx__faint text-[12px]">
                desk {minted.deskId} · {minted.label}
              </span>
            </span>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle serif eyebrow="KEYS">
          {live.length ? 'Live keys' : 'No live keys'}
        </CardTitle>
        {live.length === 0 && <p className="dcx__p">Mint one above. A paused key refuses every desk tool by name (KEY_PAUSED) except status and close.</p>}
        <div className="dcx-list">
          {live.map((k) => (
            <KeyRow key={k.id} tenantId={t.id} k={k} reload={reload} />
          ))}
        </div>
        {revoked.length > 0 && (
          <details className="dcx-details mt-2">
            <summary>Revoked · {revoked.length}</summary>
            <div className="dcx-list">
              {revoked.map((k) => (
                <div className="dcx-item" key={k.id}>
                  <div className="dcx-item__main">
                    <span className="dcx__row">
                      <span className="dcx__mono text-[13px]">{k.prefix}…</span>
                      <span className="dcx-pill dcx-pill--bad">revoked</span>
                    </span>
                    <span className="dcx__faint text-[12px]">
                      {k.label} · desk {k.deskId} · revoked {when(k.revokedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>
    </div>
  )
}

function KeyRow({ tenantId, k, reload }: { tenantId: string; k: KeyJson; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const path = `/api/tenants/${tenantId}/keys/${k.id}`
  const pause = async (paused: boolean) => {
    setBusy(true)
    const a = await call('PATCH', path, { paused })
    setBusy(false)
    setAnswer(a.ok ? null : a)
    if (a.ok) await reload()
  }
  const revoke = async () => {
    const a = await call('DELETE', path)
    setAnswer(a.ok ? null : a)
    if (a.ok) await reload()
  }
  return (
    <div className="dcx-item" data-desk-key={k.prefix}>
      <div className="dcx-item__main">
        <span className="dcx__row">
          <span className="dcx__mono text-[13px]">{k.prefix}…</span>
          <span className={`dcx-pill ${k.paused ? 'dcx-pill--warn' : 'dcx-pill--ok'}`}>{k.paused ? 'paused' : 'live'}</span>
        </span>
        <span className="dcx__faint text-[12px]">
          {k.label} · desk {k.deskId} · minted {when(k.createdAt)} · {k.lastUsedAt ? `last used ${when(k.lastUsedAt)}` : 'never used'}
        </span>
        <AnswerNote answer={answer} tag="key" />
      </div>
      <div className="dcx-item__acts">
        <button type="button" className="dcx-btn dcx-btn--small" disabled={busy} onClick={() => void pause(!k.paused)}>
          {busy ? '…' : k.paused ? 'Resume' : 'Pause'}
        </button>
        <ConfirmButton label="Revoke" confirm={`Revoke ${k.prefix}…? A revoked key never works again.`} yes="Revoke for good" onYes={revoke} />
      </div>
    </div>
  )
}
