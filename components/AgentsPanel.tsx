'use client'

// Dashboard panel for connected agents — the apps paying through the `yeetful`
// SDK. An agent IS an API key (that's how it authenticates), so rows come from
// /api/keys; what makes this the Agents surface is the spend side: per-day
// budget (PATCH /api/keys/[id]) and a spent-today meter from receipts the
// agent synced. The budget is advisory at the rails (the agent pays from its
// own wallet) — the SDK reads it via /api/agent/policy and refuses locally.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot, Check, Loader2, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AgentRow {
  id: string
  label: string
  prefix: string
  perDayUsd: number | null
  spentTodayUsd: number
  lastUsedAt: string | null
  createdAt: string
}

function fmtUsd(n: number): string {
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`
}

function fmtLastUsed(iso: string | null): string {
  if (!iso) return 'never used'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'never used'
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return 'active just now'
  if (mins < 60) return `active ${mins}m ago`
  if (mins < 60 * 24) return `active ${Math.floor(mins / 60)}h ago`
  return `active ${d.toLocaleDateString()}`
}

export default function AgentsPanel({ orgId }: { orgId?: string | null }) {
  const [agents, setAgents] = useState<AgentRow[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Keyed on the active org (F3): switching scope refetches; the server
  // re-checks membership on every call.
  const load = useCallback(async () => {
    setAgents(null)
    try {
      const res = await fetch(`/api/keys${orgId ? `?org=${orgId}` : ''}`, { cache: 'no-store' })
      setAgents(res.ok ? await res.json() : [])
    } catch {
      setAgents([])
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const startEdit = (a: AgentRow) => {
    setEditing(a.id)
    setDraft(a.perDayUsd == null ? '' : String(a.perDayUsd))
    setError('')
  }

  const saveBudget = async (id: string) => {
    const trimmed = draft.trim()
    const perDayUsd = trimmed === '' ? null : Number(trimmed)
    if (perDayUsd != null && (!(perDayUsd > 0) || isNaN(perDayUsd))) {
      setError('Budget must be a positive number — or empty for no budget.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ perDayUsd }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed.')
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4 mb-6">
      <h2 className="text-sm font-semibold text-white mb-1">
        Connected agents
        <span className="font-normal text-[color:var(--muted-2)]">
          {' '}
          — apps paying through the yeetful SDK, each on its own daily budget
        </span>
      </h2>

      {!agents ? (
        <p className="text-xs text-[color:var(--muted-2)] py-4">Loading agents…</p>
      ) : agents.length === 0 ? (
        <div className="flex items-start gap-2.5 mt-4 text-[color:var(--muted-2)]">
          <Bot className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">
            No agents connected yet. An agent connects by holding one of your{' '}
            <Link href="/dashboard/keys" className="text-white underline underline-offset-2 decoration-dotted">
              API keys
            </Link>{' '}
            — mint one, hand it to the app via <span className="mono">yeetful(&#123; apiKey &#125;)</span>, and its
            spend shows up here with a budget you control. See{' '}
            <Link href="/docs/agents" className="text-white underline underline-offset-2 decoration-dotted">
              how agent budgets work
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {agents.map((a) => {
            const pct = a.perDayUsd ? Math.min(100, (a.spentTodayUsd / a.perDayUsd) * 100) : 0
            const over = a.perDayUsd != null && a.spentTodayUsd >= a.perDayUsd
            return (
              <li key={a.id} className="px-3 py-2.5 rounded-xl border border-[var(--line)] bg-black/20">
                <div className="flex items-center gap-3">
                  <Bot className="w-4 h-4 flex-shrink-0 text-[color:var(--muted-2)]" />
                  <span className="text-xs text-white font-medium truncate min-w-0">{a.label}</span>
                  <span className="mono text-[10px] text-[color:var(--muted-2)] flex-shrink-0">{a.prefix}…</span>
                  <span className="text-[10px] text-[color:var(--muted-2)] mono flex-shrink-0 ml-auto hidden sm:inline">
                    {fmtLastUsed(a.lastUsedAt)}
                  </span>
                </div>

                <div className="flex items-center gap-3 mt-2.5">
                  {editing === a.id ? (
                    <>
                      <span className="text-[11px] text-[color:var(--muted)] flex-shrink-0">$/day</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !saving) void saveBudget(a.id)
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        placeholder="no budget"
                        className="w-24 px-2 py-1 max-lg:min-h-10 rounded-md bg-black/30 border border-[var(--line)] text-white text-xs mono focus:outline-none focus:border-[var(--line-2)]"
                      />
                      <button
                        onClick={() => void saveBudget(a.id)}
                        disabled={saving}
                        className="flex items-center gap-1 text-[11px] px-2 py-1 max-lg:min-h-10 rounded-md bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                      >
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Save
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="text-[color:var(--muted-2)] hover:text-white transition-colors max-lg:min-h-10"
                        aria-label="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        {a.perDayUsd != null ? (
                          <>
                            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all',
                                  over ? 'bg-red-400' : pct > 85 ? 'bg-amber-400' : 'bg-emerald-400',
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <p className={cn('text-[10px] mono mt-1', over ? 'text-red-400' : 'text-[color:var(--muted-2)]')}>
                              {fmtUsd(a.spentTodayUsd)} of {fmtUsd(a.perDayUsd)} today{over ? ' — over budget' : ''}
                            </p>
                          </>
                        ) : (
                          <p className="text-[10px] mono text-[color:var(--muted-2)]">
                            {fmtUsd(a.spentTodayUsd)} today · no daily budget — the grant alone governs
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => startEdit(a)}
                        className="flex-shrink-0 flex items-center gap-1 text-[11px] px-2 py-1 max-lg:min-h-10 rounded-md text-[color:var(--muted-2)] hover:text-white transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        {a.perDayUsd != null ? 'Edit budget' : 'Set budget'}
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {error && <p className="text-[11px] text-red-400 mt-2">{error}</p>}
    </div>
  )
}
