'use client'

// Dashboard · Organization — members, roles, and the danger zone for the
// ACTIVE org (picked in the rail switcher). Personal scope shows the create
// flow instead. Every action re-checks membership server-side (F2/F3); this
// page only decides what to RENDER from the role the API returns.

import { useCallback, useEffect, useState } from 'react'
import { useOrgStore } from '@/lib/org-store'
import OrgMembersView, { type OrgDetail } from '@/components/OrgMembersView'
import OrgReport from '@/components/OrgReport'
import { useSession } from '@/lib/session'
import { Building2 } from 'lucide-react'
import { SkeletonCard } from '@/lib/dashboard-ui'

export default function DashboardOrgPage() {
  const { activeOrgId, setActiveOrg } = useOrgStore()
  const { address } = useSession()
  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!activeOrgId) {
      setOrg(null)
      return
    }
    setLoading(true)
    const res = await fetch(`/api/orgs/${activeOrgId}`, { cache: 'no-store' })
    setLoading(false)
    if (res.ok) setOrg(await res.json())
    else setActiveOrg(null) // membership gone → back to personal
  }, [activeOrgId, setActiveOrg])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setCreateErr(null)
    try {
      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (res.ok) {
        const created = await res.json()
        setName('')
        setActiveOrg(created.id)
      } else {
        const body = await res.json().catch(() => ({}))
        setCreateErr(body.error || `Couldn’t create the organization (${res.status}).`)
      }
    } catch {
      setCreateErr('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!activeOrgId) {
    return (
      <>
        <h1 className="dash__h1">Organization</h1>
        <p className="dash__sub">
          You&apos;re in your personal scope. An organization is a shared expense account — members,
          shared agent keys, and one budget roof. Adding a wallet address is the invite; it takes
          effect the next time that wallet signs in.
        </p>
        <div className="max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-6">
          <div className="w-11 h-11 rounded-xl bg-[var(--surf-2)] grid place-items-center text-[color:var(--muted)] mb-4">
            <Building2 className="w-5 h-5" />
          </div>
          <h2 className="text-sm font-semibold text-white mb-1">Create an organization</h2>
          <p className="text-xs text-[color:var(--muted-2)] mb-4 leading-relaxed">
            You become its owner; invite teammates by wallet address after.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <input
              className="search__input !py-2.5 text-sm"
              placeholder="Organization name"
              value={name}
              maxLength={64}
              aria-invalid={!!createErr}
              aria-label="Organization name"
              onChange={(e) => {
                setName(e.target.value)
                if (createErr) setCreateErr(null)
              }}
            />
            <button className="btn btn--solid !px-5" type="submit" disabled={busy || !name.trim()} aria-busy={busy}>
              {busy ? '…' : 'Create'}
            </button>
          </form>
          {createErr && (
            <p className="text-xs text-red-400 mt-2" role="alert">
              {createErr}
            </p>
          )}
        </div>
      </>
    )
  }

  if (!org || loading) {
    return (
      <>
        <h1 className="dash__h1">Organization</h1>
        <div className="mt-4 grid gap-3">
          <SkeletonCard bodyClassName="h-24" />
          <SkeletonCard bodyClassName="h-40" />
        </div>
        <span className="sr-only" role="status">Loading organization…</span>
      </>
    )
  }

  return (
    <>
      <OrgMembersView
        org={org}
        myAddress={(address ?? '').toLowerCase()}
        onChanged={load}
        onGone={() => setActiveOrg(null)}
      />
      <OrgReport orgId={org.id} />
    </>
  )
}
