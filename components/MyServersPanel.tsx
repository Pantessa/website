'use client'

// Dashboard · Agents → the PAYEE side. While AgentsPanel lists apps that SPEND
// from your account (payers), this lists the MCP servers tied to your wallet as
// payee: ones you've CLAIMED, plus ones whose x402 payTo receiver IS your wallet
// but that you haven't claimed yet (a red "unclaimed" badge + a one-click Claim).
// Each row links to its public detail page.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Server, ArrowUpRight, BadgeCheck, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ServerRow {
  slug: string
  name: string
  category: string
  priceUsd: string | null
  callable: boolean
  host: string | null
  claimed: boolean
}

function fmtPrice(p: string | null): string | null {
  if (!p) return null
  const n = Number(p)
  if (isNaN(n)) return null
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}/call` : `$${n.toFixed(2)}/call`
}

export default function MyServersPanel() {
  const [servers, setServers] = useState<ServerRow[] | null>(null)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/mine', { cache: 'no-store' })
      const data = res.ok ? await res.json() : []
      setServers(Array.isArray(data) ? data : [])
    } catch {
      setServers([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const claim = async (slug: string) => {
    setClaiming(slug)
    setError('')
    try {
      const res = await fetch(`/api/mcp/${slug}/claim`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Claim failed.')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Claim failed.')
    } finally {
      setClaiming(null)
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4 mb-6 min-w-0">
      <h2 className="text-sm font-semibold text-white mb-1">
        My MCP servers
        <span className="font-normal text-[color:var(--muted-2)]">
          {' '}
          — services you operate and collect x402 revenue from
        </span>
      </h2>

      {error && (
        <p className="flex items-center gap-1.5 text-[11px] text-red-400 mt-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </p>
      )}

      {!servers ? (
        <p className="text-xs text-[color:var(--muted-2)] py-4">Loading servers…</p>
      ) : servers.length === 0 ? (
        <div className="flex items-start gap-2.5 mt-4 text-[color:var(--muted-2)]">
          <Server className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">
            No servers tied to this wallet. If you operate an MCP,{' '}
            <Link href="/dashboard/servers" className="text-white underline underline-offset-2 decoration-dotted">
              find it in the directory
            </Link>{' '}
            — sign in with the wallet its x402 <span className="mono">payTo</span> is set to and it shows up here
            to claim.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {servers.map((s) => {
            const price = fmtPrice(s.priceUsd)
            return (
              <li
                key={s.slug}
                className={cn(
                  'px-3 py-2.5 rounded-xl border bg-black/20 transition-colors',
                  s.claimed ? 'border-[var(--line)]' : 'border-red-500/40 bg-red-500/[0.04]',
                )}
              >
                <div className="flex items-center gap-3">
                  <Server className="w-4 h-4 flex-shrink-0 text-[color:var(--muted-2)]" />
                  <span className="text-xs font-medium text-white truncate min-w-0">{s.name}</span>
                  {s.claimed ? (
                    <span className="mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 flex-shrink-0 inline-flex items-center gap-1">
                      <BadgeCheck className="w-2.5 h-2.5" />
                      claimed
                    </span>
                  ) : (
                    <span className="mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 flex-shrink-0">
                      unclaimed
                    </span>
                  )}

                  <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    {!s.claimed && (
                      <button
                        onClick={() => void claim(s.slug)}
                        disabled={claiming === s.slug}
                        className="flex items-center gap-1 text-[11px] px-2 py-1 max-lg:min-h-9 rounded-md bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                      >
                        {claiming === s.slug ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        Claim
                      </button>
                    )}
                    <Link
                      href={`/servers/${s.slug}`}
                      className="flex items-center gap-1 text-[11px] px-2 py-1 max-lg:min-h-9 rounded-md border border-[var(--line)] text-white hover:border-[var(--line-2)] hover:bg-white/5 transition-colors"
                    >
                      Details
                      <ArrowUpRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-2 text-[10px] mono text-[color:var(--muted-2)]">
                  <span className="px-1.5 py-0.5 rounded bg-white/5 text-[color:var(--muted)]">{s.category}</span>
                  {price && <span>{price}</span>}
                  {s.host && <span className="truncate min-w-0">· {s.host}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
