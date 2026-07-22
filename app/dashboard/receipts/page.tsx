'use client'

// Dashboard · Earnings — the per-transaction EARN feed with its on-chain
// verification check (P0). Each call an MCP reports shows whether a USDC
// transfer to the MCP's payTo was actually found on the chain. This is the
// legible proof behind the Overview's "$X verified on-chain" KPI.

import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, Clock, HelpCircle, Coins } from 'lucide-react'
import { Card, EmptyState, short, timeAgo } from '@/lib/dashboard-ui'

interface Row {
  id: string
  mcpSlug: string
  mcpName: string
  ownerAddress: string
  amountUsd: number
  payer: string | null
  tool: string | null
  network: string | null
  txHash: string | null
  verified: boolean | null
  verifiedAt: string | null
  createdAt: string
  receiver: string | null
}
interface Feed {
  rows: Row[]
  summary: { total: number; verified: number; flagged: number; pending: number }
  admin: boolean
  scope: 'all' | 'mine'
}

function explorerTx(network: string | null, txHash: string): string {
  const n = (network ?? '').toLowerCase()
  const base = n.includes('sepolia') || n.includes('84532') ? 'https://sepolia.basescan.org' : 'https://basescan.org'
  return `${base}/tx/${txHash}`
}

function statusOf(r: Row) {
  if (r.verified === true) return { Icon: CheckCircle2, cls: 'text-emerald-400', label: 'verified on-chain' }
  if (r.verified === false) return { Icon: XCircle, cls: 'text-red-400', label: 'not backed by a tx' }
  if (!r.txHash) return { Icon: HelpCircle, cls: 'text-[color:var(--muted-2)]', label: 'no tx — unverifiable' }
  return { Icon: Clock, cls: 'text-amber-400', label: 'pending check' }
}

export default function DashboardReceiptsPage() {
  const [feed, setFeed] = useState<Feed | null>(null)
  const [all, setAll] = useState(false)

  useEffect(() => {
    void fetch(`/api/dashboard/receipts${all ? '?all=1' : ''}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((f) => f && setFeed(f))
  }, [all])

  const s = feed?.summary

  return (
    <>
      <h1 className="dash__h1">Earnings</h1>
      <p className="dash__sub">
        Every paid call your MCPs reported — each checked against the chain. A receipt is self-reported until a USDC
        transfer to the MCP&apos;s payTo is found on-chain.
      </p>

      {s && s.total > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 text-xs mono">
          <span className="px-2 py-1 rounded-md bg-emerald-400/10 text-emerald-400">{s.verified} verified</span>
          {s.flagged > 0 && <span className="px-2 py-1 rounded-md bg-red-400/10 text-red-400">{s.flagged} not backed</span>}
          {s.pending > 0 && <span className="px-2 py-1 rounded-md bg-amber-400/10 text-amber-400">{s.pending} pending</span>}
          <span className="px-2 py-1 rounded-md bg-white/5 text-[color:var(--muted-2)]">{s.total} total</span>
          {feed?.admin && (
            <button
              onClick={() => setAll((v) => !v)}
              className="ml-auto px-2 py-1 rounded-md bg-white/5 text-[color:var(--muted-2)] hover:text-white"
              title="Admin: view receipts across all operators"
            >
              {all ? 'Showing: all operators' : 'Showing: mine'}
            </button>
          )}
        </div>
      )}

      <Card>
        {!feed || feed.rows.length === 0 ? (
          <EmptyState
            icon={Coins}
            title="No earnings yet"
            description="When a claimed MCP reports a paid call (via reportUsage or POST /api/mcp/receipts), it shows up here with its on-chain check."
            cta={{ href: '/docs', label: 'Docs' }}
          />
        ) : (
          <div className="divide-y divide-white/5">
            {feed.rows.map((r) => {
              const { Icon, cls, label } = statusOf(r)
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs min-h-10">
                  <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${cls}`} />
                  <span className="text-white truncate">{r.mcpName}</span>
                  <span className={`mono flex-shrink-0 ${cls}`} title={label}>
                    {label}
                  </span>
                  {r.tool && <span className="text-[color:var(--muted-2)] truncate hidden md:block">{r.tool}</span>}
                  <span className="ml-auto mono text-emerald-400 flex-shrink-0">+${r.amountUsd.toFixed(4)}</span>
                  {r.txHash && (
                    <a
                      href={explorerTx(r.network, r.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="mono text-[color:var(--muted-2)] hover:text-white flex-shrink-0 inline-flex items-center max-lg:min-h-10 max-lg:-my-2"
                    >
                      {short(r.txHash)}
                    </a>
                  )}
                  <span className="mono text-[color:var(--muted-2)] flex-shrink-0 w-16 text-right">{timeAgo(r.createdAt)}</span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </>
  )
}
