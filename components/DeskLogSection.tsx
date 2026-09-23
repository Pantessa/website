'use client'

// The DESK section of Growth (squad contract C5): agents seen, the opened → executed → signed
// → settled funnel, money moved by agent, the fee those legs carried — in the same tile /
// card / series idiom as the sections above it, with the honesty line the desk needs: what
// the agents CLAIMED vs what the receipt-counted books saw (UI.md Finding 1).

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Bot, ScrollText } from 'lucide-react'

import '@/components/markets/look.css'
import { Card, CardTitle } from '@/lib/dashboard-ui'
import { formatEarnedUsd } from '@/lib/fees'
import { MK } from '@/lib/markets-look'
import type { DeskGrowth } from '@/lib/desk-activity'

const DeskDaily = dynamic(() => import('./DeskLogCharts').then((m) => m.DeskDaily), {
  ssr: false,
  loading: () => <div className="min-w-0 animate-pulse rounded-xl bg-white/5" style={{ height: 200 }} />,
})

const usd = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `$${n.toFixed(2)}`)

function Delta({ value }: { value: number | null }) {
  if (value == null) return null
  const up = value >= 0
  return (
    <span className={`text-[11px] mono ${up ? 'text-[color:var(--done,#34d399)]' : 'text-[color:var(--fail,#f87171)]'}`} title="vs the previous window of the same length">
      {up ? '+' : ''}
      {Math.round(value * 100)}%
    </span>
  )
}

function Stat({ label, value, delta, sub, lead }: { label: string; value: string; delta?: number | null; sub?: React.ReactNode; lead?: boolean }) {
  return (
    <div className={`rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4 min-w-0 ${lead ? 'ring-1 ring-[color:var(--accent,#34E0A1)]/30' : ''}`}>
      <p className="text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mono">{label}</p>
      <p className="flex items-baseline gap-2 flex-wrap mt-1">
        <span className="text-2xl font-semibold text-white tabular-nums break-all">{value}</span>
        <Delta value={delta ?? null} />
      </p>
      {sub && <p className="text-xs text-[color:var(--muted)] mt-1 break-words">{sub}</p>}
    </div>
  )
}

const FUNNEL: { key: keyof DeskGrowth['funnel']; label: string; note: string }[] = [
  { key: 'opened', label: 'Opened', note: 'an agent asked the desk' },
  { key: 'executed', label: 'Executed', note: 'consented + job compiled' },
  { key: 'signed', label: 'Signed', note: 'at least one leg claimed' },
  { key: 'settled', label: 'Settled', note: 'the job ran to done' },
]

/** Opened → executed → signed → settled, each as a share of opened. Words + width, never
 *  color alone; one hue, since this is one magnitude at four stops. */
function Funnel({ f, prev }: { f: DeskGrowth['funnel']; prev: DeskGrowth['funnelPrev'] }) {
  const max = Math.max(1, f.opened)
  return (
    <ol className="grid gap-2" data-desk-funnel>
      {FUNNEL.map((s, i) => {
        const n = f[s.key]
        const p = prev[s.key]
        const pct = f.opened > 0 ? Math.round((n / f.opened) * 100) : 0
        return (
          <li key={s.key} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 min-w-0">
            <span className="text-xs text-white truncate" title={s.note}>
              {s.label}
            </span>
            <span className="h-3 rounded-[4px] overflow-hidden bg-[var(--surf-2,rgba(255,255,255,0.04))] min-w-0">
              <span className="block h-full rounded-[4px]" style={{ width: `${Math.max(n > 0 ? 2 : 0, (n / max) * 100)}%`, background: `var(${MK.seq[Math.min(4, i + 1)]})` }} />
            </span>
            <span className="text-xs mono tabular-nums text-white whitespace-nowrap">
              {n}
              <span className="text-[color:var(--muted-2)]"> · {pct}%</span>
              {p !== n && <span className="text-[color:var(--muted-2)]"> · was {p}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function DeskLogSection({ desk, external }: { desk: DeskGrowth | null; external: boolean }) {
  const w = desk ? `${desk.windowDays}d` : ''
  return (
    <section className="mt-6" data-desk-section>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <Bot className="w-4 h-4 text-[color:var(--accent,#34E0A1)]" /> Agent desk
        </h2>
        <Link href="/dashboard/admin/desk" className="inline-flex items-center gap-1.5 text-xs text-[color:var(--accent,#34E0A1)] hover:underline whitespace-nowrap">
          <ScrollText className="w-3.5 h-3.5" /> Desk log
        </Link>
      </div>
      {!desk ? (
        <p className="text-xs text-[color:var(--muted-2)]">The desk tables did not answer.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label={`Agents seen · ${w}`} value={String(desk.agents)} sub={`${desk.agentsAllTime} identified agents ever${external ? ' · strangers only' : ''}`} />
            <Stat lead label={`Agent-signed · ${w}`} value={usd(desk.moneyUsd)} delta={desk.moneyDelta} sub={`${usd(desk.moneyAllTimeUsd)} all time · ${desk.legs} legs claimed`} />
            <Stat label={`Fee on those legs · ${w}`} value={formatEarnedUsd(desk.feeUsd)} sub={`${formatEarnedUsd(desk.feeAllTimeUsd)} all time · from each leg's own artifact`} />
            <Stat
              label={`Receipt-counted · ${w}`}
              value={usd(desk.countedUsd)}
              sub={
                desk.countedUsd + 0.005 < desk.moneyUsd ? (
                  <span className="text-[color:var(--gold,#f0b454)]">{usd(desk.moneyUsd - desk.countedUsd)} of claimed money is on no receipt-counted row.</span>
                ) : (
                  'what the money-moved books saw for the same wallets'
                )
              }
            />
          </div>
          <div className="grid lg:grid-cols-2 gap-3 mt-3">
            <Card>
              <CardTitle eyebrow={`last ${w}`}>Intents · opened to settled</CardTitle>
              <Funnel f={desk.funnel} prev={desk.funnelPrev} />
              <p className="text-[11px] text-[color:var(--muted-2)] mt-3">
                By the intent&rsquo;s open time. <em>Executed</em>{' '}= the agent consented and the desk compiled a job it drives with its own key.{' '}
                <em>Signed</em>{' '}= the agent posted at least one completed leg (its claim; the runner&rsquo;s wait leg checks the chain).
              </p>
            </Card>
            <Card>
              <CardTitle eyebrow={`last ${w}`}>Agent-signed money · per day</CardTitle>
              <DeskDaily series={desk.series} />
              <p className="text-[11px] text-[color:var(--muted-2)] mt-3">Guard-priced notional of every leg an agent completed, on the day it claimed it.</p>
            </Card>
          </div>
          <Card className="mt-3">
            <CardTitle eyebrow={`last ${w} · top ${desk.byAgent.length || 10}`}>Money moved · by agent</CardTitle>
            {desk.byAgent.length === 0 ? (
              <p className="text-xs text-[color:var(--muted-2)] py-2">No agent has opened an intent in this window.</p>
            ) : (
              <ul className="grid gap-2" data-desk-agents>
                {desk.byAgent.map((a) => {
                  const max = Math.max(1, ...desk.byAgent.map((x) => x.usd))
                  const who = a.handle ? (
                    <Link href={`/agents/${a.handle}`} className="mono text-white hover:text-[color:var(--accent,#34E0A1)] truncate" title={a.name ?? a.handle}>
                      {a.name ?? a.handle}
                    </Link>
                  ) : (
                    <span className="text-[color:var(--muted)] truncate">unidentified callers</span>
                  )
                  return (
                    <li key={a.handle ?? '-'} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
                      {who}
                      <span className="h-3 rounded-[4px] overflow-hidden bg-[var(--surf-2,rgba(255,255,255,0.04))] min-w-0">
                        <span className="block h-full rounded-[4px]" style={{ width: `${Math.max(a.usd > 0 ? 2 : 0, (a.usd / max) * 100)}%`, background: `var(${MK.seq[3]})` }} />
                      </span>
                      <span className="text-xs mono tabular-nums text-white whitespace-nowrap">
                        {usd(a.usd)}
                        <span className="text-[color:var(--muted-2)]">
                          {' '}
                          · {a.intents} {a.intents === 1 ? 'intent' : 'intents'} · {a.legs} {a.legs === 1 ? 'leg' : 'legs'}
                          {a.feeUsd > 0 ? ` · ${formatEarnedUsd(a.feeUsd)} fee` : ''}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </section>
  )
}
