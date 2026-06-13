'use client'

// Scope switcher in the dashboard rail: Personal + every org the wallet
// belongs to, plus an inline "new organization" form. Selection is client
// state (lib/org-store, F3) — pages pass it explicitly to the APIs, which
// re-check membership server-side on every call.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Check, ChevronsUpDown, Plus, User } from 'lucide-react'
import { useOrgStore, type OrgSummary } from '@/lib/org-store'

export default function OrgSwitcher() {
  const router = useRouter()
  const { activeOrgId, setActiveOrg } = useOrgStore()
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  const load = () =>
    fetch('/api/orgs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((rows: OrgSummary[] | null) => {
        if (!rows) return
        setOrgs(rows)
        // Membership revoked (or org deleted) since last visit → fall back.
        if (activeOrgId && !rows.some((o) => o.id === activeOrgId)) setActiveOrg(null)
      })
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const active = orgs?.find((o) => o.id === activeOrgId) ?? null

  const pick = (id: string | null) => {
    setActiveOrg(id)
    setOpen(false)
    router.refresh()
  }

  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    const res = await fetch('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    setBusy(false)
    if (res.ok) {
      const org = await res.json()
      setName('')
      setCreating(false)
      await load()
      pick(org.id)
      router.push('/dashboard/org')
    }
  }

  return (
    <div className="orgsw" ref={wrap}>
      <button
        type="button"
        className="orgsw__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {active ? <Building2 width={14} height={14} /> : <User width={14} height={14} />}
        <span className="orgsw__name">{active ? active.name : 'Personal'}</span>
        <ChevronsUpDown width={13} height={13} className="orgsw__chev" />
      </button>

      {open && (
        <div className="orgsw__menu" role="listbox" aria-label="Scope">
          <button type="button" className="orgsw__item" role="option" aria-selected={!active} onClick={() => pick(null)}>
            <User width={13} height={13} />
            <span className="orgsw__name">Personal</span>
            {!active && <Check width={13} height={13} className="orgsw__check" />}
          </button>
          {(orgs ?? []).map((o) => (
            <button
              key={o.id}
              type="button"
              className="orgsw__item"
              role="option"
              aria-selected={o.id === activeOrgId}
              onClick={() => pick(o.id)}
            >
              <Building2 width={13} height={13} />
              <span className="orgsw__name">{o.name}</span>
              <span className="orgsw__role mono">{o.role}</span>
              {o.id === activeOrgId && <Check width={13} height={13} className="orgsw__check" />}
            </button>
          ))}
          <div className="orgsw__sep" />
          {creating ? (
            <form
              className="orgsw__new"
              onSubmit={(e) => {
                e.preventDefault()
                void create()
              }}
            >
              <input
                autoFocus
                className="orgsw__input"
                placeholder="Organization name"
                value={name}
                maxLength={64}
                onChange={(e) => setName(e.target.value)}
              />
              <button type="submit" className="orgsw__go" disabled={busy || !name.trim()}>
                {busy ? '…' : 'Create'}
              </button>
            </form>
          ) : (
            <button type="button" className="orgsw__item" onClick={() => setCreating(true)}>
              <Plus width={13} height={13} />
              <span className="orgsw__name">New organization</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
