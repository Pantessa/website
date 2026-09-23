'use client'

// Dashboard · Growth · Desk log — one row per brokered intent (admin-only).
//
// Growth's Desk section says how much the agents moved. This page says what each intent DID,
// leg by leg: opened → chosen → consent → job compiled → built → CLAIMED (the agent's word) →
// VERIFIED (the runner read the chain) → settled → done | failed. Every hash links to its
// chain's explorer; every leg carries the guard-priced notional and the fee its artifact
// carried. Internal rows (our own drills) stay on the screen, greyed, and count nothing.
//
// Reads /api/admin/desk (allowlist enforced server-side; mirrored here so a non-admin sees a
// clean panel). lib/desk-activity.ts owns every judgement; this file draws it.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Ban,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  DoorOpen,
  ExternalLink,
  FileSignature,
  Hammer,
  KeyRound,
  ListChecks,
  PenLine,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Workflow,
  XCircle,
} from 'lucide-react'
import { useSession } from '@/lib/session'
import { isAdminAddress } from '@/lib/admin'
import { Card, SkeletonCard, short, timeAgo } from '@/lib/dashboard-ui'
import { formatEarnedUsd } from '@/lib/fees'
import {
  DESK_EVENT_TONE,
  DESK_STAGES,
  DESK_STAGE_LABEL,
  DESK_STAGE_TONE,
  DESK_WINDOWS,
  type DeskEventKind,
  type DeskGrowth,
  type DeskLogEvent,
  type DeskLogRow,
  type DeskStage,
  type DeskTone,
  type DeskVoice,
} from '@/lib/desk-activity'

interface DeskResponse {
  windowDays: number
  generatedAt: string
  external: boolean
  filters: { stage: DeskStage | null; agent: string | null }
  total: number
  truncated: boolean
  hidden: { internal: number; team: number }
  summary: DeskGrowth
  rows: DeskLogRow[]
  failed: string[]
}

/** Live while looked at: an agent may be driving a job right now. */
const REFRESH_MS = 10_000

// Tone never rides on color alone: every toned thing here also carries an icon or its words.
const TONE_INK: Record<DeskTone, string> = {
  info: 'var(--muted)',
  act: 'var(--fg, #fff)',
  good: 'var(--done, #34d399)',
  warn: 'var(--gold, #f0b454)',
  bad: 'var(--fail, #f87171)',
}

const KIND_ICON: Record<DeskEventKind, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  opened: DoorOpen,
  chosen: ListChecks,
  handoff: FileSignature,
  consent: KeyRound,
  compiled: Workflow,
  built: Hammer,
  claimed: PenLine,
  verified: ShieldCheck,
  settled: CheckCircle2,
  done: CheckCircle2,
  failed: XCircle,
  closed: Ban,
  refused: ShieldAlert,
}

const KIND_WORD: Record<DeskEventKind, string> = {
  opened: 'opened',
  chosen: 'chose',
  handoff: 'handed off',
  consent: 'consent',
  compiled: 'compiled',
  built: 'built',
  claimed: 'claimed',
  verified: 'verified',
  settled: 'settled',
  done: 'done',
  failed: 'failed',
  closed: 'closed',
  refused: 'refused',
}

/** Who said so. The claimed / verified split is the whole point (README gotcha #824). */
const VOICE_WORD: Record<DeskVoice, string> = { desk: 'desk', agent: 'agent', runner: 'runner', human: 'human' }

const usd = (n: number | null | undefined) => (n == null ? '—' : n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `$${n.toFixed(2)}`)

function clock(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`
}
function dayWord(iso: string): string {
  return new Date(iso).toUTCString().slice(5, 16)
}
function humanMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`
  return `${(ms / 86_400_000).toFixed(1)}d`
}

function StagePill({ stage }: { stage: DeskStage }) {
  const tone = DESK_STAGE_TONE[stage]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] mono uppercase tracking-[0.12em] whitespace-nowrap"
      style={{ color: TONE_INK[tone], borderColor: `color-mix(in srgb, ${TONE_INK[tone]} 45%, transparent)`, background: `color-mix(in srgb, ${TONE_INK[tone]} 8%, transparent)` }}
    >
      {DESK_STAGE_LABEL[stage]}
    </span>
  )
}

function Pill({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] mono uppercase tracking-[0.12em] text-[color:var(--muted-2)] whitespace-nowrap">
      {children}
    </span>
  )
}

function Timeline({ row }: { row: DeskLogRow }) {
  const start = row.events[0]?.at ?? row.openedAt
  return (
    <ol className="mt-3 border-l border-[var(--line)] ml-2" data-desk-timeline>
      {row.events.map((e: DeskLogEvent, i) => {
        const prev = row.events[i - 1]
        const newDay = !prev || dayWord(prev.at) !== dayWord(e.at)
        const Icon = KIND_ICON[e.kind]
        const tone = DESK_EVENT_TONE[e.kind]
        const loud = tone === 'bad' || tone === 'warn'
        return (
          <li key={`${e.at}-${e.kind}-${e.seq ?? ''}-${i}`} data-event={e.kind} data-who={e.who}>
            {newDay && <div className="pl-4 pt-2 pb-1.5 text-[10px] mono uppercase tracking-[0.14em] text-[color:var(--muted-2)]">{dayWord(e.at)}</div>}
            <div className={`relative pl-4 py-1.5 ${loud ? 'rounded-r-md' : ''}`} style={loud ? { background: `color-mix(in srgb, ${TONE_INK[tone]} 7%, transparent)` } : undefined}>
              <span className="absolute -left-[7px] top-[9px] grid place-items-center w-3.5 h-3.5 rounded-full bg-[var(--surf-1)]">
                <Icon className="w-3 h-3" style={{ color: TONE_INK[tone] }} />
              </span>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[11px] mono tabular-nums text-[color:var(--muted-2)] whitespace-nowrap" title={e.at}>
                  {clock(e.at)}
                </span>
                <span className="text-[13px] min-w-0 break-words" style={{ color: tone === 'info' ? 'var(--muted)' : tone === 'act' ? undefined : TONE_INK[tone] }}>
                  <span className={tone === 'act' ? 'text-white' : ''}>
                    {e.seq != null && <span className="mono text-[11px] text-[color:var(--muted-2)] mr-1.5">leg {e.seq}</span>}
                    {KIND_WORD[e.kind]}
                  </span>
                </span>
                <Pill title={`This event is ${VOICE_WORD[e.who]}'s word${e.who === 'agent' || e.who === 'human' ? ' — a claim, checked by the next wait leg' : ''}`}>
                  {VOICE_WORD[e.who]}
                </Pill>
                {e.valueUsd != null && e.valueUsd > 0 && (
                  <span className="text-[11px] mono tabular-nums text-white whitespace-nowrap">
                    {usd(e.valueUsd)}
                    {e.feeUsd != null && e.feeUsd > 0 && <span className="text-[color:var(--muted-2)]"> · fee {formatEarnedUsd(e.feeUsd)}</span>}
                  </span>
                )}
                {e.venue && <span className="text-[10px] mono uppercase tracking-wider text-[color:var(--muted-2)] whitespace-nowrap">{e.venue}</span>}
                <span className="text-[10px] mono text-[color:var(--muted-2)] whitespace-nowrap">+{humanMs(new Date(e.at).getTime() - new Date(start).getTime())}</span>
              </div>
              {e.detail && <p className="text-xs text-[color:var(--muted)] mt-0.5 break-words">{e.detail}</p>}
              {e.txHash && (
                <p className="text-[11px] mono mt-0.5 break-all">
                  {e.txUrl ? (
                    <a href={e.txUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[color:var(--accent,#34E0A1)] hover:underline" data-tx={e.txHash}>
                      {e.txHash.slice(0, 10)}…{e.txHash.slice(-6)} <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="text-[color:var(--muted-2)]" data-tx={e.txHash} title="no explorer for this chain in the registry">
                      {e.txHash.slice(0, 10)}…{e.txHash.slice(-6)}
                      {e.chainId ? ` · chain ${e.chainId}` : ''}
                    </span>
                  )}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function DeskRow({ row, open, onToggle }: { row: DeskLogRow; open: boolean; onToggle: () => void }) {
  const [copied, setCopied] = useState(false)
  const who = row.agentName ?? (row.agentHandle ? `agent ${row.agentHandle.slice(0, 8)}` : 'unidentified caller')
  const dim = row.isInternal
  return (
    <li className={`border-t border-[var(--line)] first:border-t-0 ${dim ? 'opacity-55' : ''}`} data-intent={row.intentId} data-internal={dim ? '1' : undefined} data-stage={row.stage}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left px-1 py-3 hover:bg-[var(--surf-2)] rounded-lg transition-colors">
        <div className="flex items-center gap-2 flex-wrap">
          {open ? <ChevronDown className="w-4 h-4 shrink-0 text-[color:var(--muted-2)]" /> : <ChevronRight className="w-4 h-4 shrink-0 text-[color:var(--muted-2)]" />}
          <StagePill stage={row.stage} />
          {dim && <Pill title="Our own harness or drill intent — shown, never counted">internal</Pill>}
          {row.team && !dim && <Pill title="One of our wallets (TEST_WALLETS)">team</Pill>}
          <Pill title={row.path === 'agent' ? 'The agent signs with its own key (broker_execute)' : row.path === 'human' ? 'A sign link for the agent’s human (broker_handoff)' : 'No path chosen yet'}>
            {row.path === 'agent' ? 'agent-signed' : row.path === 'human' ? 'human-signed' : 'negotiating'}
          </Pill>
          <span className="inline-flex items-center gap-1 text-sm text-white min-w-0 truncate" title={row.agentHandle ?? undefined}>
            <Bot className="w-3.5 h-3.5 shrink-0 text-[color:var(--muted-2)]" /> {who}
          </span>
          <span className="ml-auto text-[11px] mono text-[color:var(--muted-2)] whitespace-nowrap" title={row.lastAt}>
            {timeAgo(row.lastAt)}
          </span>
        </div>
        <p className="mt-1.5 text-[13px] text-white break-words pl-6">{row.ask}</p>
        <p className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] mono text-[color:var(--muted-2)] pl-6">
          {row.wallet && <span title={row.wallet}>{short(row.wallet)}</span>}
          {row.legs.total > 0 && (
            <span title="legs signed / total · verified by the runner · failed">
              {row.legs.signed}/{row.legs.total} signed · {row.legs.verified} verified{row.legs.failed > 0 ? ` · ${row.legs.failed} failed` : ''}
            </span>
          )}
          {row.valueUsd != null && (
            <span className="text-white" title="guard-priced notional of the legs the agent claims to have signed">
              {usd(row.valueUsd)} claimed
            </span>
          )}
          {row.feeUsd > 0 && <span title="Pantessa's net fee those legs' artifacts carried">fee {formatEarnedUsd(row.feeUsd)}</span>}
          {row.valueUsd != null && row.valueUsd > 0 && (
            <span className={row.countedUsd + 0.005 < row.valueUsd ? 'text-[color:var(--gold,#f0b454)]' : ''} title="what the receipt-counted books saw for this wallet during the intent">
              {usd(row.countedUsd)} receipt-counted
            </span>
          )}
          {row.jobId && <span title={`job ${row.jobId} · ${row.jobStatus ?? ''}`}>job {row.jobId.slice(0, 10)}…</span>}
          {row.linkSlug && (
            <Link href={`/i/${row.linkSlug}`} className="hover:text-white" onClick={(ev) => ev.stopPropagation()}>
              /i/{row.linkSlug}
            </Link>
          )}
        </p>
      </button>
      {open && (
        <div className="px-1 pb-4 pl-7">
          <div className="flex items-center gap-2 flex-wrap text-[11px] mono text-[color:var(--muted-2)]">
            <span>intent {row.intentId}</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-white"
              onClick={() => {
                void navigator.clipboard?.writeText(row.intentId).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                })
              }}
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'copied' : 'copy'}
            </button>
            {row.agentHandle && (
              <Link href={`/agents/${row.agentHandle}`} className="hover:text-white">
                track record ↗
              </Link>
            )}
            <span>state {row.status}</span>
          </div>
          <Timeline row={row} />
        </div>
      )}
    </li>
  )
}

function DeskPage() {
  const { address } = useSession()
  const params = useSearchParams()
  const focusIntent = params.get('intent')
  const [days, setDays] = useState<(typeof DESK_WINDOWS)[number]>(() => {
    const d = Number(params.get('days'))
    return (DESK_WINDOWS as readonly number[]).includes(d) ? (d as (typeof DESK_WINDOWS)[number]) : 30
  })
  const [stage, setStage] = useState<DeskStage | ''>(() => {
    const s = params.get('stage')
    return s && (DESK_STAGES as readonly string[]).includes(s) ? (s as DeskStage) : ''
  })
  const [agent, setAgent] = useState(() => params.get('agent') ?? '')
  const [external, setExternal] = useState(false)
  const [data, setData] = useState<DeskResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const focused = useRef(false)

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      try {
        const q = new URLSearchParams({ days: String(days) })
        if (stage) q.set('stage', stage)
        if (agent.trim()) q.set('agent', agent.trim())
        if (external) q.set('external', '1')
        const res = await fetch(`/api/admin/desk?${q}`, { cache: 'no-store' })
        if (res.ok) {
          setData(await res.json())
          setError(null)
        } else if (!quiet) {
          setData(null)
          setError(res.status === 403 ? 'This wallet is not an admin.' : `The desk API returned ${res.status}. Check the server logs.`)
        }
      } catch {
        if (!quiet) {
          setData(null)
          setError('Could not reach the desk API.')
        }
      } finally {
        setLoading(false)
      }
    },
    [days, stage, agent, external],
  )

  useEffect(() => {
    if (isAdminAddress(address)) void load()
    else setLoading(false)
  }, [address, load])

  // An agent may be driving a job right now: keep the log current while it is the tab being
  // looked at (the headless pane reads hidden — drives override visibilityState).
  useEffect(() => {
    if (!isAdminAddress(address)) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, REFRESH_MS)
    return () => clearInterval(t)
  }, [address, load])

  // A link from Growth names an intent: open it once the data lands.
  useEffect(() => {
    if (!focusIntent || !data || focused.current) return
    if (!data.rows.some((r) => r.intentId === focusIntent)) return
    focused.current = true
    setOpen(new Set([focusIntent]))
    requestAnimationFrame(() => document.querySelector(`[data-intent="${CSS.escape(focusIntent)}"]`)?.scrollIntoView({ block: 'center' }))
  }, [focusIntent, data])

  const toggle = useCallback((id: string) => {
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const s = data?.summary
  const counts = useMemo(() => {
    const by = new Map<DeskStage, number>()
    for (const r of data?.rows ?? []) by.set(r.stage, (by.get(r.stage) ?? 0) + 1)
    return by
  }, [data])

  if (!isAdminAddress(address)) {
    return (
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold text-white mb-2">Not authorized</h1>
        <p className="text-sm text-[color:var(--muted)]">This page is for the Pantessa team.</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold text-white mb-2">Couldn&rsquo;t load the desk log</h1>
        <p className="text-sm text-[color:var(--muted)]">{error}</p>
      </div>
    )
  }

  return (
    <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'} data-desk-page>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard/admin" className="inline-flex items-center gap-1 text-xs text-[color:var(--muted)] hover:text-white whitespace-nowrap">
            <ArrowLeft className="w-3.5 h-3.5" /> Growth
          </Link>
          <h1 className="dash__h1">Desk log</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
            {DESK_WINDOWS.map((d) => (
              <button key={d} onClick={() => setDays(d)} aria-pressed={days === d} className={`px-3 py-1.5 text-xs mono transition-colors ${days === d ? 'bg-[var(--surf-1)] text-white' : 'text-[color:var(--muted)] hover:text-white'}`}>
                {d}d
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-[color:var(--muted)] cursor-pointer select-none">
            <input type="checkbox" checked={external} onChange={(ev) => setExternal(ev.target.checked)} className="accent-[var(--accent,#34E0A1)]" />
            Strangers only
          </label>
          <button type="button" onClick={() => void load(true)} className="inline-flex items-center gap-1 text-xs text-[color:var(--muted)] hover:text-white" title="Polls every 10s while this tab is visible">
            <RefreshCw className="w-3.5 h-3.5" /> live
          </button>
        </div>
      </div>
      <p className="text-sm text-[color:var(--muted)] mb-4">
        Every intent another agent brought to the desk, newest activity first. <em>Claimed</em> is the agent&rsquo;s word; <em>verified</em> is the runner&rsquo;s read of the chain.
        Internal rows are our own drills — shown greyed, counted nowhere.
      </p>

      {!data ? (
        <>
          <SkeletonCard bodyClassName="h-16" />
          <SkeletonCard className="mt-3" bodyClassName="h-64" />
          <span className="sr-only" role="status">Loading the desk log…</span>
        </>
      ) : (
        <>
          {s && (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3" data-desk-tiles>
              {[
                ['Agents', String(s.agents), `${s.agentsAllTime} ever`],
                ['Opened', String(s.funnel.opened), `was ${s.funnelPrev.opened}`],
                ['Executed', String(s.funnel.executed), `${s.funnel.signed} signed · ${s.funnel.settled} settled`],
                ['Claimed', usd(s.moneyUsd), `${s.legs} legs · fee ${formatEarnedUsd(s.feeUsd)}`],
                ['Receipt-counted', usd(s.countedUsd), s.countedUsd + 0.005 < s.moneyUsd ? `${usd(s.moneyUsd - s.countedUsd)} not on the books` : 'matches the books'],
              ].map(([label, value, sub]) => (
                <div key={label} className="rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] px-3 py-2.5 min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-[color:var(--muted-2)] mono">{label}</p>
                  <p className="text-lg font-semibold text-white tabular-nums">{value}</p>
                  <p className={`text-[11px] truncate ${label === 'Receipt-counted' && s.countedUsd + 0.005 < s.moneyUsd ? 'text-[color:var(--gold,#f0b454)]' : 'text-[color:var(--muted-2)]'}`}>{sub}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap mb-3">
            <label className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[color:var(--muted-2)]" />
              <input
                value={agent}
                onChange={(ev) => setAgent(ev.target.value)}
                placeholder="agent name or handle"
                className="pl-7 pr-2 py-1.5 text-xs rounded-lg border border-[var(--line)] bg-[var(--surf-1)] text-white placeholder:text-[color:var(--muted-2)] w-56 max-w-full"
              />
            </label>
            <select value={stage} onChange={(ev) => setStage(ev.target.value as DeskStage | '')} className="py-1.5 px-2 text-xs rounded-lg border border-[var(--line)] bg-[var(--surf-1)] text-white" aria-label="Stage">
              <option value="">every stage</option>
              {DESK_STAGES.map((st) => (
                <option key={st} value={st}>
                  {DESK_STAGE_LABEL[st]}
                  {counts.get(st) ? ` · ${counts.get(st)}` : ''}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-[color:var(--muted-2)] mono">
              {data.rows.length} of {data.total}
              {data.hidden.internal > 0 && !external ? ` · ${data.hidden.internal} internal` : ''}
              {external && data.hidden.internal + data.hidden.team > 0 ? ` · ${data.hidden.internal + data.hidden.team} hidden` : ''}
              {data.truncated ? ' · capped at the newest 400' : ''}
            </span>
            {data.failed.length > 0 && <span className="text-[11px] text-[color:var(--gold,#f0b454)]">did not answer: {data.failed.join(', ')}</span>}
          </div>

          <Card>
            {data.rows.length === 0 ? (
              <p className="text-xs text-[color:var(--muted-2)] py-4">
                No intent {stage ? `at “${DESK_STAGE_LABEL[stage]}” ` : ''}
                {agent.trim() ? `from “${agent.trim()}” ` : ''}in the last {days} days.
              </p>
            ) : (
              <ul data-desk-rows>
                {data.rows.map((r) => (
                  <DeskRow key={r.intentId} row={r} open={open.has(r.intentId)} onToggle={() => toggle(r.intentId)} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<SkeletonCard bodyClassName="h-64" />}>
      <DeskPage />
    </Suspense>
  )
}
