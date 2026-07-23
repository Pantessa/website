'use client'

// ─────────────────────────────────────────────────────────────────────────
//  Ask failures — the product-gap queue (admin). Every money-shaped ask
//  that ended in a wall (no artifact, no job, no chips), with the funds
//  snapshot taken at failure time. "Had funds" rows are the ones that
//  matter: the user held movable money and the ladder/planner offered no
//  path to it — each is a grammar or funding-wiring gap to fix (the
//  2026-07-23 NFT buy with $19 of idle USDC is the archetype). Fed by
//  lib/ask-failure.ts via the chat route's response wrapper.
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, RefreshCw } from 'lucide-react'
import { useSession } from '@/lib/session'
import { isAdminAddress } from '@/lib/admin'

interface FailureRow {
  id: string
  wallet: string | null
  prompt: string
  reply: string | null
  kind: string
  buildPath: string | null
  hadFunds: boolean | null
  fundsUsd: number | null
  fundsDetail: string | null
  createdAt: string
}

interface Feed {
  days: number
  counts: { total: number; funded: number; broke: number; unknown: number }
  failures: FailureRow[]
}

const WINDOWS = [7, 14, 30] as const

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const when = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function FundsBadge({ row }: { row: FailureRow }) {
  if (row.hadFunds === true)
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider bg-[color:var(--accent,#34E0A1)]/10 text-[color:var(--accent,#34E0A1)] whitespace-nowrap">
        had ${row.fundsUsd?.toLocaleString() ?? '?'}
      </span>
    )
  if (row.hadFunds === false)
    return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider bg-[var(--surf-1)] text-[color:var(--muted-2)] whitespace-nowrap">broke</span>
  return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider bg-[var(--surf-1)] text-[color:var(--muted-2)] whitespace-nowrap">unscanned</span>
}

const KIND_LABEL: Record<string, string> = {
  'planner-answer': 'planner fall-through',
  'native-wall': 'native wall',
  blocked: 'guard blocked',
  error: 'error',
}

export default function FailuresPage() {
  const { address } = useSession()
  const [feed, setFeed] = useState<Feed | null>(null)
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(14)
  const [fundedOnly, setFundedOnly] = useState(false)
  const [external, setExternal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/ask-failures?days=${days}${fundedOnly ? '&funded=1' : ''}${external ? '&external=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) {
        setFeed(null)
        setError(res.status === 403 ? 'This wallet is not an admin.' : `The failures API returned ${res.status}.`)
        return
      }
      setFeed(await res.json())
    } catch {
      setFeed(null)
      setError('Could not reach the failures API.')
    } finally {
      setLoading(false)
    }
  }, [days, fundedOnly, external])

  useEffect(() => {
    if (isAdminAddress(address)) void load()
    else setLoading(false)
  }, [address, load])

  if (address && !isAdminAddress(address)) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] grid place-items-center text-[color:var(--muted)] mb-5">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Not authorized</h1>
        <p className="text-sm text-[color:var(--muted)]">The failure log is limited to Yeetful admins.</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="dash__h1">Ask failures</h1>
          <p className="text-sm text-[color:var(--muted)] mt-1 max-w-xl">
            Money-shaped asks that ended in a wall — no artifact, no job, no chips. <strong>Had funds</strong> rows are the fix queue: the wallet held movable money and got no path to use it.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {WINDOWS.map((w) => (
            <button key={w} className={`btn btn--sm ${days === w ? 'btn--solid' : ''}`} onClick={() => setDays(w)}>
              {w}d
            </button>
          ))}
          <button className={`btn btn--sm ${fundedOnly ? 'btn--solid' : ''}`} onClick={() => setFundedOnly((v) => !v)} title="Only failures where the wallet demonstrably held movable funds">
            had funds
          </button>
          <button className={`btn btn--sm ${external ? 'btn--solid' : ''}`} onClick={() => setExternal((v) => !v)} title="Hide Yeetful test wallets">
            external
          </button>
          <button className="btn btn--sm" onClick={() => void load()} title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {feed && (
        <div className="flex items-center gap-4 mt-4 text-sm text-[color:var(--muted)]">
          <span><strong className="text-white tabular-nums">{feed.counts.total}</strong> failures</span>
          <span className="text-[color:var(--accent,#34E0A1)]"><strong className="tabular-nums">{feed.counts.funded}</strong> had funds</span>
          <span><strong className="tabular-nums">{feed.counts.broke}</strong> broke</span>
          <span><strong className="tabular-nums">{feed.counts.unknown}</strong> unscanned</span>
        </div>
      )}

      {error && (
        <div className="mt-6 text-sm text-[color:var(--muted)]">
          {error}{' '}
          <button className="underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-[color:var(--muted)]">Loading…</div>}

      {!loading && feed && feed.failures.length === 0 && (
        <div className="mt-8 text-sm text-[color:var(--muted)]">Nothing in this window{fundedOnly ? ' with funds on hand' : ''} — the ladder answered every money ask with something actionable.</div>
      )}

      {!loading && feed && feed.failures.length > 0 && (
        <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--line)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-[color:var(--muted-2)] border-b border-[var(--line)]">
                <th className="px-3 py-2 whitespace-nowrap">When</th>
                <th className="px-3 py-2">Ask</th>
                <th className="px-3 py-2 whitespace-nowrap">Wallet</th>
                <th className="px-3 py-2 whitespace-nowrap">Ended as</th>
                <th className="px-3 py-2 whitespace-nowrap">Funds</th>
              </tr>
            </thead>
            <tbody>
              {feed.failures.map((r) => (
                <tr key={r.id} className="border-b border-[var(--line)] last:border-0 align-top cursor-pointer hover:bg-[var(--surf-1)]" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums text-[color:var(--muted)]">{when(r.createdAt)}</td>
                  <td className="px-3 py-2 max-w-[420px]">
                    <div className={open === r.id ? '' : 'truncate'}>{r.prompt}</div>
                    {open === r.id && (
                      <div className="mt-2 space-y-1 text-xs text-[color:var(--muted)]">
                        {r.reply && <div><span className="uppercase tracking-wider text-[10px] text-[color:var(--muted-2)]">reply · </span>{r.reply}</div>}
                        {r.fundsDetail && <div><span className="uppercase tracking-wider text-[10px] text-[color:var(--muted-2)]">funds · </span>{r.fundsDetail}</div>}
                        {r.buildPath && <div><span className="uppercase tracking-wider text-[10px] text-[color:var(--muted-2)]">layer · </span>{r.buildPath}</div>}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-[color:var(--muted)]">{r.wallet ? short(r.wallet) : 'guest'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-[color:var(--muted)]">{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><FundsBadge row={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
