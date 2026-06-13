'use client'

// Organization members + settings — the presentational half of
// /dashboard/org (the page owns fetching; a visual harness can render this
// with mock data). What's rendered follows the role matrix the server
// enforces: rename = admin+, invite = admin+ (admins add members only),
// role changes + transfer + delete = owner, leave = any non-owner.

import { useState } from 'react'
import { Building2, LogOut, PiggyBank, ShieldAlert, Trash2, UserPlus } from 'lucide-react'
import { Card, CardTitle, short, timeAgo } from '@/lib/dashboard-ui'

export interface OrgDetail {
  id: string
  name: string
  slug: string
  perDayUsd: number | null
  createdAt: string
  role: 'owner' | 'admin' | 'member'
  members: { address: string; role: string; addedBy: string | null; createdAt: string }[]
}

export default function OrgMembersView({
  org,
  myAddress,
  onChanged,
  onGone,
}: {
  org: OrgDetail
  myAddress: string
  onChanged: () => void | Promise<void>
  /** The org no longer applies to me (left / deleted) — leave org scope. */
  onGone: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(org.name)
  const [cap, setCap] = useState(org.perDayUsd == null ? '' : String(org.perDayUsd))

  const isOwner = org.role === 'owner'
  const isAdmin = org.role === 'owner' || org.role === 'admin'

  const call = async (path: string, init: RequestInit): Promise<boolean> => {
    setBusy(true)
    setError(null)
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
    setBusy(false)
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? `Request failed (${res.status}).`)
      return false
    }
    return true
  }

  const addMember = async () => {
    const address = invite.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      setError('Enter a full 0x wallet address.')
      return
    }
    if (
      await call(`/api/orgs/${org.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ address, role: inviteRole }),
      })
    ) {
      setInvite('')
      setInviteRole('member')
      await onChanged()
    }
  }

  const setRole = async (address: string, role: string) => {
    if (role === 'owner' && !confirm('Transfer ownership? You become an admin of this org.')) return
    if (await call(`/api/orgs/${org.id}/members/${address}`, { method: 'PATCH', body: JSON.stringify({ role }) })) {
      await onChanged()
    }
  }

  const remove = async (address: string) => {
    const leaving = address === myAddress
    if (!confirm(leaving ? 'Leave this organization?' : `Remove ${short(address)} from ${org.name}?`)) return
    if (await call(`/api/orgs/${org.id}/members/${address}`, { method: 'DELETE' })) {
      if (leaving) onGone()
      else await onChanged()
    }
  }

  const rename = async () => {
    const name = newName.trim()
    if (!name || name === org.name) {
      setRenaming(false)
      return
    }
    if (await call(`/api/orgs/${org.id}`, { method: 'PATCH', body: JSON.stringify({ name }) })) {
      setRenaming(false)
      await onChanged()
    }
  }

  const saveCap = async () => {
    const trimmed = cap.trim()
    const perDayUsd = trimmed === '' ? null : Number(trimmed)
    if (perDayUsd != null && (!(perDayUsd > 0) || isNaN(perDayUsd))) {
      setError('Cap must be a positive number — or empty for no org cap.')
      return
    }
    if (await call(`/api/orgs/${org.id}`, { method: 'PATCH', body: JSON.stringify({ perDayUsd }) })) {
      await onChanged()
    }
  }

  const destroy = async () => {
    if (!confirm(`Delete ${org.name}? Its keys, grants, and ledger go with it. This can't be undone.`)) return
    if (await call(`/api/orgs/${org.id}`, { method: 'DELETE' })) onGone()
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-1 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-[var(--surf-2)] grid place-items-center text-[color:var(--muted)] shrink-0">
          <Building2 className="w-4 h-4" />
        </div>
        {renaming ? (
          <form
            className="flex gap-2 min-w-0"
            onSubmit={(e) => {
              e.preventDefault()
              void rename()
            }}
          >
            <input
              autoFocus
              className="search__input !py-2 text-sm"
              value={newName}
              maxLength={64}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button className="btn btn--solid !px-4 !py-2 text-sm" type="submit" disabled={busy}>
              Save
            </button>
          </form>
        ) : (
          <h1 className="dash__h1 !mb-0 min-w-0 truncate">{org.name}</h1>
        )}
        <span className="mono text-[11px] px-2 py-0.5 rounded-md bg-[var(--surf-2)] text-[color:var(--muted)]">
          {org.role}
        </span>
        {isAdmin && !renaming && (
          <button
            className="text-xs text-[color:var(--muted-2)] hover:text-white underline underline-offset-2 min-h-[40px]"
            onClick={() => {
              setNewName(org.name)
              setRenaming(true)
            }}
          >
            Rename
          </button>
        )}
      </div>
      <p className="dash__sub">
        {org.members.length} member{org.members.length === 1 ? '' : 's'} · created {timeAgo(org.createdAt)}.
        Adding a wallet address IS the invite — it takes effect on that wallet&apos;s next sign-in.
      </p>

      {error && (
        <p className="text-xs text-[color:#ff5d5d] mb-3 flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> {error}
        </p>
      )}

      <Card className="mb-4">
        <CardTitle>Members</CardTitle>
        <div className="grid grid-cols-1 gap-1">
          {org.members.map((m) => {
            const me = m.address === myAddress
            const canRemove =
              !me && m.role !== 'owner' && (isOwner || (isAdmin && m.role === 'member'))
            return (
              <div
                key={m.address}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 px-2 rounded-lg hover:bg-[var(--surf-1)] min-w-0"
              >
                <span className="mono text-xs text-white" title={m.address}>
                  {short(m.address)}
                </span>
                {me && <span className="text-[10px] text-[color:var(--muted-2)]">you</span>}
                <span className="text-[10px] text-[color:var(--muted-2)] hidden sm:inline">
                  joined {timeAgo(m.createdAt)}
                </span>
                <span className="flex items-center gap-2 ml-auto">
                  {isOwner && !me ? (
                    <select
                      className="mono text-[11px] bg-[var(--surf-2)] text-[color:var(--muted)] rounded-md px-2 py-2 border border-[var(--line)] min-h-[40px]"
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => void setRole(m.address, e.target.value)}
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                      <option value="owner">owner (transfer)</option>
                    </select>
                  ) : (
                    <span className="mono text-[11px] px-2 py-0.5 rounded-md bg-[var(--surf-2)] text-[color:var(--muted)]">
                      {m.role}
                    </span>
                  )}
                  {canRemove && (
                    <button
                      className="text-[color:var(--muted-2)] hover:text-[color:#ff5d5d] min-w-[40px] min-h-[40px] grid place-items-center"
                      title="Remove member"
                      disabled={busy}
                      onClick={() => void remove(m.address)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {me && m.role !== 'owner' && (
                    <button
                      className="flex items-center gap-1.5 text-[11px] text-[color:var(--muted-2)] hover:text-white min-h-[40px] px-2"
                      disabled={busy}
                      onClick={() => void remove(m.address)}
                    >
                      <LogOut className="w-3.5 h-3.5" /> Leave
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        {isAdmin && (
          <form
            className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--line)]"
            onSubmit={(e) => {
              e.preventDefault()
              void addMember()
            }}
          >
            <input
              className="search__input !py-2.5 text-sm flex-1 min-w-[220px] mono"
              placeholder="0x… wallet address"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
            />
            {isOwner && (
              <select
                className="mono text-xs bg-[var(--surf-1)] text-[color:var(--muted)] rounded-xl px-3 border border-[var(--line)] min-h-[44px]"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            )}
            <button className="btn btn--solid !px-5" type="submit" disabled={busy || !invite.trim()}>
              <UserPlus className="w-4 h-4" /> Add
            </button>
          </form>
        )}
      </Card>

      {/* The org level of the two-level budget. Admin+ may set it; the SDK
          enforces it via /api/agent/policy — advisory at the rails (F5). */}
      <Card className="mb-4">
        <CardTitle>Org daily budget</CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <PiggyBank className="w-4 h-4 text-[color:var(--muted-2)] shrink-0" />
          <p className="text-xs text-[color:var(--muted-2)] max-w-[44ch] leading-relaxed flex-1 min-w-[200px]">
            A daily USD cap across <em>all</em> of {org.name}&apos;s agent keys — the level above
            each key&apos;s own budget. The SDK reads it and stops paying when the org is over;
            empty means per-key budgets alone govern.
          </p>
          {isAdmin ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void saveCap()
              }}
            >
              <span className="text-[11px] text-[color:var(--muted)]">$/day</span>
              <input
                type="text"
                inputMode="decimal"
                className="w-24 px-2 py-2 min-h-[40px] rounded-md bg-black/30 border border-[var(--line)] text-white text-xs mono focus:outline-none focus:border-[var(--line-2)]"
                placeholder="no cap"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
              <button className="btn btn--solid !px-4 !py-2 text-sm" type="submit" disabled={busy}>
                Save
              </button>
            </form>
          ) : (
            <span className="mono text-xs text-[color:var(--muted)]">
              {org.perDayUsd != null ? `$${org.perDayUsd.toFixed(2)}/day` : 'no cap set'}
            </span>
          )}
        </div>
      </Card>

      {isOwner && (
        <Card className="border-[color:rgba(255,93,93,0.25)]">
          <CardTitle>Danger zone</CardTitle>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[color:var(--muted-2)] max-w-[48ch] leading-relaxed">
              Deleting the organization removes its members, org keys, and org expense account
              (including its ledger). Transfer ownership first if someone else should keep it.
            </p>
            <button
              className="btn btn--ghost !px-4 !text-[color:#ff5d5d] !border-[color:rgba(255,93,93,0.4)]"
              disabled={busy}
              onClick={() => void destroy()}
            >
              <Trash2 className="w-4 h-4" /> Delete organization
            </button>
          </div>
        </Card>
      )}
    </>
  )
}
