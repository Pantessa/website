'use client'

// Dashboard · Agents → the PAYEE side. While AgentsPanel lists apps that SPEND
// from your account (payers), this lists the MCP servers you operate and COLLECT
// x402 revenue from (payees) — the ones you've claimed by signing in with their
// payTo wallet. Each row links to its public detail page.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Server, ArrowUpRight, BadgeCheck } from 'lucide-react'

interface ServerRow {
  slug: string
  name: string
  category: string
  priceUsd: string | null
  callable: boolean
  host: string | null
  verifiedVia: string
  claimedAt: string
}

function fmtPrice(p: string | null): string | null {
  if (!p) return null
  const n = Number(p)
  if (isNaN(n)) return null
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}/call` : `$${n.toFixed(2)}/call`
}

export default function MyServersPanel() {
  const [servers, setServers] = useState<ServerRow[] | null>(null)

  useEffect(() => {
    fetch('/api/mcp/mine', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ServerRow[]) => setServers(Array.isArray(data) ? data : []))
      .catch(() => setServers([]))
  }, [])

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4 mb-6 min-w-0">
      <h2 className="text-sm font-semibold text-white mb-1">
        My MCP servers
        <span className="font-normal text-[color:var(--muted-2)]">
          {' '}
          — services you operate and collect x402 revenue from
        </span>
      </h2>

      {!servers ? (
        <p className="text-xs text-[color:var(--muted-2)] py-4">Loading servers…</p>
      ) : servers.length === 0 ? (
        <div className="flex items-start gap-2.5 mt-4 text-[color:var(--muted-2)]">
          <Server className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">
            No servers claimed yet. If you operate an MCP,{' '}
            <Link href="/dashboard/servers" className="text-white underline underline-offset-2 decoration-dotted">
              find it in the directory
            </Link>{' '}
            and claim it on its detail page — sign in with the wallet its x402{' '}
            <span className="mono">payTo</span> is set to, and it shows up here.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {servers.map((s) => {
            const price = fmtPrice(s.priceUsd)
            return (
              <li
                key={s.slug}
                className="px-3 py-2.5 rounded-xl border border-[var(--line)] bg-black/20 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Server className="w-4 h-4 flex-shrink-0 text-[color:var(--muted-2)]" />
                  <span className="text-xs font-medium text-white truncate min-w-0">{s.name}</span>
                  <span
                    className="mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 flex-shrink-0 inline-flex items-center gap-1"
                    title={s.verifiedVia === 'admin' ? 'Admin-verified claim' : 'Verified via payTo receiver'}
                  >
                    <BadgeCheck className="w-2.5 h-2.5" />
                    claimed
                  </span>
                  <Link
                    href={`/servers/${s.slug}`}
                    className="ml-auto flex-shrink-0 flex items-center gap-1 text-[11px] px-2 py-1 max-lg:min-h-9 rounded-md border border-[var(--line)] text-white hover:border-[var(--line-2)] hover:bg-white/5 transition-colors"
                  >
                    Details
                    <ArrowUpRight className="w-3 h-3" />
                  </Link>
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
