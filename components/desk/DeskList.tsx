'use client'

// components/desk/DeskList.tsx — /dashboard/desk: the tenants this wallet
// owns or administers, and the door to create one (squad five-million,
// CONSOLE lane, 2026-11-03).
//
// Reads GET /api/tenants (the plan, its entitlements, how many the wallet
// owns), then GET /api/tenants/:id per card for the active policy version and
// the live key count (the list route does not carry them — CONSOLE.md Spec
// asks). Create = POST /api/tenants { slug, name }; a refusal (the tenants cap,
// a taken slug, a bad slug) prints the route's own sentence and the plan it
// names. The dashboard layout above is the SIWE gate.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Card, CardTitle, SkeletonCard } from '@/lib/dashboard-ui'
import { call, refusalText, type Answer } from './api'
import { capWords, planLine, shortAddr, upgradeWord, when } from './derive'
import type { DeskVocab, TenantDetailJson, TenantJson, TenantListJson } from './types'
import './desk-console.css'

interface CardFacts {
  version: number | null
  liveKeys: number
  owner: boolean
  pending: number
}

export default function DeskList({ vocab }: { vocab: DeskVocab }) {
  const router = useRouter()
  const [list, setList] = useState<TenantListJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [facts, setFacts] = useState<Record<string, CardFacts>>({})

  const load = useCallback(async () => {
    const a = await call<TenantListJson>('GET', '/api/tenants')
    if (!a.ok || !a.json) return setError(refusalText(a))
    setError(null)
    setList(a.json)
    const rows = a.json.tenants.slice(0, 24)
    const details = await Promise.all(rows.map((t) => call<TenantDetailJson>('GET', `/api/tenants/${t.id}`)))
    const next: Record<string, CardFacts> = {}
    details.forEach((d, i) => {
      if (!d.ok || !d.json) return
      next[rows[i].id] = {
        version: d.json.policy?.version ?? null,
        liveKeys: d.json.keys.filter((k) => !k.revoked).length,
        owner: d.json.you.owner,
        pending: d.json.versions.filter((v) => v.state === 'proposed').length,
      }
    })
    setFacts(next)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <Card>
        <p className="dcx__p">{error}</p>
      </Card>
    )
  }
  if (!list) return <SkeletonCard />

  const ent = list.entitlements
  return (
    <div className="dcx" data-desk-console="list">
      <Card>
        <CardTitle serif eyebrow="YOUR PLAN">
          What your plan lets a desk do
        </CardTitle>
        <p className="dcx-plan" data-desk-plan>
          {planLine(list.plan, ent, { tenants: list.owned }).map((p) => (
            <span key={p}>{p}</span>
          ))}
          <span>
            <Link href="/pricing#desk">Desk plans</Link>
          </span>
        </p>
        <p className="dcx__p mt-3">
          A tenant is one firm’s governed desk: a default-deny policy its admins write, desk keys its agents present, and a
          hash-chained blotter of everything the desk did. Nothing trades on a tenant until a policy is active.{' '}
          <Link href="/docs/desk" className="underline underline-offset-2">
            How the desk works
          </Link>
          .
        </p>
      </Card>

      {list.tenants.length === 0 ? (
        <Card>
          <p className="dcx__p" data-desk-empty>
            No tenants yet. Create one below; it starts in the sandbox{ent.mainnet ? ' unless your plan includes mainnet' : ' (Base Sepolia and the Hyperliquid testnet)'}.
          </p>
        </Card>
      ) : (
        <div className="dcx-tenants" data-desk-tenants>
          {list.tenants.map((t) => (
            <TenantCard key={t.id} t={t} f={facts[t.id]} keysCap={ent.keysPerTenant} />
          ))}
        </div>
      )}

      <CreateTenant
        canCreate={list.canCreate}
        owned={list.owned}
        cap={ent.tenants}
        slugRe={vocab.slugRe}
        sandboxFirst={!ent.mainnet}
        onCreated={(id) => router.push(`/dashboard/desk/${id}`)}
      />
    </div>
  )
}

function TenantCard({ t, f, keysCap }: { t: TenantJson; f: CardFacts | undefined; keysCap: number | null }) {
  return (
    <Link href={`/dashboard/desk/${t.id}`} className="dcx-tenant" data-tenant-card={t.slug}>
      <div className="dcx__row dcx__row--between">
        <span className="dcx-tenant__name">{t.name}</span>
        <span className="dcx__row">
          <span className={`dcx-pill ${t.status === 'active' ? 'dcx-pill--ok' : 'dcx-pill--warn'}`}>{t.status}</span>
          {t.sandbox && <span className="dcx-pill dcx-pill--accent">sandbox</span>}
        </span>
      </div>
      <span className="dcx-tenant__slug">{t.slug}</span>
      <dl className="dcx-kv">
        <dt>policy</dt>
        <dd>{f ? (f.version !== null ? `v${f.version} active` : 'no active policy') : '…'}{f && f.pending > 0 ? ` · ${f.pending} proposed` : ''}</dd>
        <dt>keys</dt>
        <dd>{f ? capWords(f.liveKeys, keysCap) : '…'}</dd>
        <dt>role</dt>
        <dd>{f ? (f.owner ? 'you own it' : `admin · owner ${shortAddr(t.ownerAddress)}`) : '…'}</dd>
        <dt>created</dt>
        <dd>{when(t.createdAt)}</dd>
      </dl>
    </Link>
  )
}

function CreateTenant({ canCreate, owned, cap, slugRe, sandboxFirst, onCreated }: { canCreate: boolean; owned: number; cap: number | null; slugRe: string; sandboxFirst: boolean; onCreated: (id: string) => void }) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const slugOk = new RegExp(slugRe).test(slug.trim().toLowerCase())

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setAnswer(null)
    const a = await call<{ tenant?: TenantJson }>('POST', '/api/tenants', { slug: slug.trim().toLowerCase(), name: name.trim() })
    setBusy(false)
    if (a.ok && a.json?.tenant?.id) return onCreated(a.json.tenant.id)
    setAnswer(a)
  }

  const up = upgradeWord(answer?.json?.upgrade)
  return (
    <Card>
      <CardTitle serif eyebrow="NEW TENANT">
        Create a tenant
      </CardTitle>
      <p className="dcx__p mb-3">
        The slug names the tenant in keys and exports: 3–32 lowercase letters, digits and dashes.{' '}
        {sandboxFirst ? 'It starts in the sandbox. ' : ''}
        {!canCreate && `Your plan’s tenants are in use (${capWords(owned, cap)}); the server will say what the next one needs.`}
      </p>
      <form className="dcx-form" onSubmit={(e) => void submit(e)} data-desk-create>
        <label className="dcx-field">
          Slug
          <input className="dcx-input dcx-input--mono" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme-macro" autoComplete="off" spellCheck={false} maxLength={32} name="slug" />
        </label>
        <label className="dcx-field">
          Name
          <input className="dcx-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Capital — macro desk" autoComplete="off" maxLength={80} name="name" />
        </label>
        <button type="submit" className="dcx-btn dcx-btn--solid" disabled={busy || !slugOk || !name.trim()}>
          {busy ? 'Creating…' : 'Create tenant'}
        </button>
      </form>
      {slug && !slugOk && <p className="dcx__faint text-[12.5px] mt-2">That slug will be refused: lowercase letters, digits and dashes, starting and ending with a letter or digit.</p>}
      {answer && !answer.ok && (
        <div className="dcx-note dcx-note--bad mt-3" role="alert" data-desk-refusal={answer.json?.entitlement ?? answer.json?.field ?? answer.status}>
          {refusalText(answer)}
          {up && (
            <>
              {' '}
              <Link href="/pricing#desk">See {up}</Link>.
            </>
          )}
        </div>
      )}
    </Card>
  )
}
