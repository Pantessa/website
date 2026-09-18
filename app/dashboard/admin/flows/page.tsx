'use client'

// Dashboard · Growth · User flows — one timeline per person (admin-only).
//
// Growth says how much money moved. This page says what each person DID, and
// where they stopped: the page they landed on, what they pressed, how long
// they stayed, what they asked, what we answered, what broke. It exists
// because the people we most need to understand leave before they have a
// wallet, and every other table we keep starts at the wallet.
//
// Reads /api/admin/flows (allowlist enforced server-side; mirrored here so a
// non-admin sees a clean panel). lib/user-flows.ts owns the vocabulary and
// every judgement; this file only draws it.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Ban,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  DoorClosed,
  DoorOpen,
  Eye,
  FileSignature,
  KeyRound,
  ListChecks,
  LogOut,
  MessageCircle,
  MessageSquare,
  MousePointerClick,
  RefreshCw,
  Search,
  ServerCrash,
  ShieldAlert,
  ShieldX,
  Sparkles,
  Star,
  UserCheck,
  UserPlus,
  Wallet,
  Workflow,
  XCircle,
} from 'lucide-react'
import { useSession } from '@/lib/session'
import { isAdminAddress } from '@/lib/admin'
import { Card, CardTitle, SkeletonCard, short, timeAgo } from '@/lib/dashboard-ui'
import {
  FLOW_WINDOWS,
  KIND_TONE,
  OUTCOME_LABEL,
  OUTCOME_TONE,
  SOURCE_LABEL,
  STAGE_LABEL,
  VISIT_GAP_MS,
  humanMs,
  type FlowFold,
  type FlowItem,
  type FlowKind,
  type FlowOutcome,
  type FlowSource,
  type FlowSummary,
  type FlowTone,
  type FlowWindow,
} from '@/lib/user-flows'

interface Flow extends FlowFold {
  id: string
  wallet: string | null
  wallets: string[]
  vids: string[]
  email: string | null
  method: string | null
  team: boolean
  teamWhy: string | null
  bot: boolean
  country: string | null
  device: string | null
  source: FlowSource
  sourceLabel: string
  firstAt: number
  lastAt: number
  live: boolean
  tracked: boolean
  rage: number
  items: FlowItem[]
  truncated: number
}
interface FlowsResponse {
  windowDays: number
  generatedAt: string
  trackingSince: string | null
  hidden: { team: number; silent: number }
  eventsCapped: boolean
  summary: FlowSummary
  flows: Flow[]
}

const REFRESH_MS = 30_000

// Status ink. Tone never rides on color alone: every toned thing on this page
// also carries an icon or its words.
const TONE_INK: Record<FlowTone, string> = {
  info: 'var(--muted)',
  act: 'var(--fg, #fff)',
  good: 'var(--done, #34d399)',
  warn: 'var(--gold, #f0b454)',
  bad: 'var(--fail, #f87171)',
}

const KIND_ICON: Record<FlowKind, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  view: Eye,
  leave: LogOut,
  click: MousePointerClick,
  door: DoorOpen,
  'door-error': DoorClosed,
  connect: Wallet,
  signin: KeyRound,
  account: UserPlus,
  ask: MessageSquare,
  'reply-answer': MessageCircle,
  'reply-connect': Wallet,
  'reply-offer': ListChecks,
  'reply-built': FileSignature,
  'reply-wall': Ban,
  built: FileSignature,
  signed: CheckCircle2,
  refused: ShieldX,
  withheld: ShieldAlert,
  job: Workflow,
  'job-failed': XCircle,
  made: Star,
  event: Sparkles,
  error: Bug,
  'api-error': ServerCrash,
}

const FROM_WORD: Record<FlowItem['from'], string> = { visitor: 'their browser', server: 'our API', db: 'our tables' }

function flag(country: string | null): string {
  if (!country || !/^[A-Z]{2}$/.test(country)) return ''
  return String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function dayWord(ms: number): string {
  return new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function ToneChip({ tone, children }: { tone: FlowTone; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] mono uppercase tracking-wide whitespace-nowrap border"
      style={{ color: TONE_INK[tone], borderColor: `color-mix(in srgb, ${TONE_INK[tone]} 35%, transparent)`, background: `color-mix(in srgb, ${TONE_INK[tone]} 9%, transparent)` }}
    >
      {children}
    </span>
  )
}

function Tag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="px-1.5 py-0.5 rounded text-[10px] mono uppercase tracking-wide whitespace-nowrap bg-[var(--surf-2)] text-[color:var(--muted)]">
      {children}
    </span>
  )
}

/** The funnel: ordered rungs, one hue, the number at the tip in text ink. */
function Funnel({ summary }: { summary: FlowSummary }) {
  const top = summary.funnel[0]?.n ?? 0
  return (
    <div className="space-y-2">
      {summary.funnel.map(({ stage, n }, i) => {
        const pct = top ? (n / top) * 100 : 0
        const prev = i > 0 ? summary.funnel[i - 1].n : n
        const lost = prev - n
        return (
          <div key={stage} title={`${n} of ${top} reached “${STAGE_LABEL[stage]}”${i > 0 && lost > 0 ? ` · ${lost} stopped before it` : ''}`}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-[color:var(--muted)]">{STAGE_LABEL[stage]}</span>
              <span className="tabular-nums text-white">
                {n}
                <span className="text-[color:var(--muted-2)]"> · {top ? Math.round(pct) : 0}%</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-r-[4px] bg-[var(--surf-2)] overflow-hidden">
              <div className="h-full rounded-r-[4px] bg-[var(--accent,#34E0A1)]" style={{ width: `${Math.max(pct, n > 0 ? 1.5 : 0)}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Timeline({ flow }: { flow: Flow }) {
  const start = flow.items[0]?.at ?? flow.firstAt
  return (
    <ol className="mt-3 border-l border-[var(--line)] ml-2">
      {flow.truncated > 0 && <li className="pl-4 pb-2 text-[11px] text-[color:var(--muted-2)]">{flow.truncated} earlier events not shown.</li>}
      {flow.items.map((it, i) => {
        const prev = flow.items[i - 1]
        const gap = prev ? it.at - prev.at : 0
        const newVisit = !prev || gap > VISIT_GAP_MS
        const newDay = !prev || dayWord(prev.at) !== dayWord(it.at)
        const Icon = KIND_ICON[it.kind] ?? Sparkles
        const tone = KIND_TONE[it.kind] ?? 'info'
        const loud = tone === 'bad' || tone === 'warn'
        return (
          <li key={`${it.at}-${i}`}>
            {newVisit && (
              <div className="pl-4 pt-2 pb-1.5 text-[10px] mono uppercase tracking-[0.14em] text-[color:var(--muted-2)]">
                {prev ? `came back after ${humanMs(gap)} · ` : ''}
                {newDay || !prev ? dayWord(it.at) : 'same day'}
              </div>
            )}
            <div className={`relative pl-4 py-1.5 ${loud ? 'rounded-r-md' : ''}`} style={loud ? { background: `color-mix(in srgb, ${TONE_INK[tone]} 7%, transparent)` } : undefined}>
              <span className="absolute -left-[7px] top-[9px] grid place-items-center w-3.5 h-3.5 rounded-full bg-[var(--surf-1)]">
                <Icon className="w-3 h-3" style={{ color: TONE_INK[tone] }} />
              </span>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[11px] mono tabular-nums text-[color:var(--muted-2)] whitespace-nowrap" title={new Date(it.at).toISOString()}>
                  {clock(it.at)}
                </span>
                <span className="text-[13px] break-words min-w-0" style={{ color: tone === 'info' ? 'var(--muted)' : tone === 'act' ? undefined : TONE_INK[tone] }}>
                  <span className={tone === 'act' ? 'text-white' : ''}>{String(it.title ?? '')}</span>
                </span>
                <span className="text-[10px] mono text-[color:var(--muted-2)] whitespace-nowrap" title={`Recorded by ${FROM_WORD[it.from]}`}>
                  +{humanMs(it.at - start)}
                </span>
              </div>
              {it.detail && it.detail !== 'chat_message_sent' && <p className="text-xs text-[color:var(--muted)] mt-0.5 break-words">{String(it.detail)}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function FlowRow({ flow, open, onToggle, onMark }: { flow: Flow; open: boolean; onToggle: () => void; onMark: (key: string, on: boolean) => Promise<void> }) {
  const [copied, setCopied] = useState(false)
  const [marking, setMarking] = useState(false)
  const tone = OUTCOME_TONE[flow.outcome]
  const who = flow.email ?? (flow.wallet ? short(flow.wallet) : `Visitor ${flow.vids[0]?.slice(0, 6) ?? '?'}`)
  const path = flow.pages.length ? flow.pages : flow.landing ? [flow.landing] : []
  const markKey = flow.wallet ?? (flow.vids[0] ? `v:${flow.vids[0]}` : null)
  return (
    <li className="border-t border-[var(--line)] first:border-t-0" data-flow={flow.id}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left px-1 py-3 hover:bg-[var(--surf-2)] rounded-lg transition-colors" data-journey-skip>
        <div className="flex items-center gap-2 flex-wrap">
          {open ? <ChevronDown className="w-4 h-4 shrink-0 text-[color:var(--muted-2)]" /> : <ChevronRight className="w-4 h-4 shrink-0 text-[color:var(--muted-2)]" />}
          {flow.live && (
            <span className="inline-flex items-center gap-1 text-[10px] mono uppercase tracking-wide" style={{ color: TONE_INK.good }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: TONE_INK.good }} /> on the site now
            </span>
          )}
          <span className="text-sm text-white font-medium break-all">{who}</span>
          {flow.email && flow.wallet && <span className="text-xs mono text-[color:var(--muted-2)]">{short(flow.wallet)}</span>}
          <Tag title={flow.sourceLabel}>{flow.source === 'other' ? flow.sourceLabel : SOURCE_LABEL[flow.source]}</Tag>
          {flow.country && (
            <span className="text-xs text-[color:var(--muted)] whitespace-nowrap">
              {flag(flow.country)} {flow.country}
            </span>
          )}
          {flow.device && <span className="text-xs text-[color:var(--muted-2)] whitespace-nowrap">{flow.device}</span>}
          {flow.team && <ToneChip tone="warn">team · {flow.teamWhy}</ToneChip>}
          {(flow.bot || !flow.human) && <Tag title="No pointer, touch, scroll or key input was ever seen.">{flow.bot ? 'bot' : 'silent'}</Tag>}
          {!flow.tracked && <Tag title="From before the journey log, or a browser that blocks it: only what our tables kept.">no page record</Tag>}
          <span className="ml-auto text-xs text-[color:var(--muted-2)] whitespace-nowrap" title={new Date(flow.lastAt).toLocaleString()}>
            {timeAgo(new Date(flow.lastAt).toISOString())}
          </span>
        </div>
        <div className="mt-1.5 pl-6 flex items-center gap-2 flex-wrap">
          <ToneChip tone={tone}>
            {tone === 'good' ? <Check className="w-3 h-3" /> : tone === 'bad' ? <XCircle className="w-3 h-3" /> : null}
            {OUTCOME_LABEL[flow.outcome]}
          </ToneChip>
          {flow.hadError && (
            <ToneChip tone="bad">
              <Bug className="w-3 h-3" /> saw an error
            </ToneChip>
          )}
          {flow.rage > 0 && (
            <ToneChip tone="bad">
              <MousePointerClick className="w-3 h-3" /> pressed something {flow.rage > 1 ? `${flow.rage}×` : ''} repeatedly
            </ToneChip>
          )}
          {path.length > 0 && (
            <span className="text-xs mono text-[color:var(--muted)] break-all">
              {path.slice(0, 6).join(' → ')}
              {path.length > 6 ? ` → +${path.length - 6}` : ''}
            </span>
          )}
        </div>
        <p className="mt-1.5 pl-6 text-[13px] text-[color:var(--muted)]">{flow.stoppedAt}</p>
      </button>

      {open && (
        <div className="pl-6 pr-1 pb-4">
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-[color:var(--muted-2)]">
            <span>
              {flow.visits} visit{flow.visits === 1 ? '' : 's'} · {flow.views} page view{flow.views === 1 ? '' : 's'} · {flow.clicks} click{flow.clicks === 1 ? '' : 's'} · {flow.asks} ask{flow.asks === 1 ? '' : 's'}
            </span>
            {flow.activeMs > 0 && <span>{humanMs(flow.activeMs)} on pages</span>}
            <span>first seen {new Date(flow.firstAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            {flow.usd > 0 && <span className="text-white">${flow.usd.toFixed(2)} signed</span>}
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {flow.wallet && (
              <>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--line)] text-[11px] text-[color:var(--muted)] hover:text-white"
                  onClick={() => {
                    void navigator.clipboard?.writeText(flow.wallet!).then(() => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1400)
                    })
                  }}
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy wallet'}
                </button>
                <Link href={`/w/${flow.wallet}`} className="px-2 py-1 rounded-md border border-[var(--line)] text-[11px] text-[color:var(--muted)] hover:text-white">
                  Their wallet briefing
                </Link>
              </>
            )}
            {markKey && (
              <button
                type="button"
                disabled={marking}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--line)] text-[11px] text-[color:var(--muted)] hover:text-white disabled:opacity-50"
                onClick={async () => {
                  setMarking(true)
                  await onMark(markKey, !(flow.team && flow.teamWhy === 'marked by hand'))
                  setMarking(false)
                }}
                title="Team traffic is hidden from this page by default. This changes nothing else."
              >
                <UserCheck className="w-3 h-3" /> {flow.team && flow.teamWhy === 'marked by hand' ? 'Not me after all' : 'That was me'}
              </button>
            )}
          </div>
          <Timeline flow={flow} />
        </div>
      )}
    </li>
  )
}

type Pick = 'all' | 'walls' | 'errors' | 'live' | 'wallet'
const PICKS: { id: Pick; label: string }[] = [
  { id: 'all', label: 'Everyone' },
  { id: 'walls', label: 'Hit a wall' },
  { id: 'errors', label: 'Saw an error' },
  { id: 'wallet', label: 'Has a wallet' },
  { id: 'live', label: 'On the site now' },
]
const WALL_OUTCOMES = new Set<FlowOutcome>(['wallet-refused', 'withheld', 'job-failed', 'built-unsigned', 'offer-unanswered', 'ask-walled', 'ask-needs-wallet', 'connected-idle', 'door-error', 'door-abandoned'])

function FlowsPage() {
  const { address } = useSession()
  const params = useSearchParams()
  const focusWallet = params.get('wallet')?.toLowerCase() ?? null
  // Local development only: a localhost visit is stamped internal (it has no
  // platform IP), so seeing your own clicks on a dev build takes ?internal=1.
  const internal = params.get('internal') === '1'
  const daysParam = Number(params.get('days'))
  const [days, setDays] = useState<FlowWindow>((FLOW_WINDOWS as readonly number[]).includes(daysParam) ? (daysParam as FlowWindow) : 3)
  const [team, setTeam] = useState(false)
  const [silent, setSilent] = useState(false)
  const [data, setData] = useState<FlowsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState<Pick>('all')
  const [outcome, setOutcome] = useState<FlowOutcome | null>(null)
  const [source, setSource] = useState<FlowSource | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const focused = useRef(false)

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      try {
        const res = await fetch(`/api/admin/flows?days=${days}${team ? '&team=1' : ''}${silent ? '&silent=1' : ''}${internal ? '&internal=1' : ''}`, { cache: 'no-store' })
        if (res.ok) {
          setData(await res.json())
          setError(null)
        } else if (!quiet) {
          setData(null)
          setError(res.status === 403 ? 'This wallet is not an admin.' : `The flows API returned ${res.status}. Check the server logs.`)
        }
      } catch {
        if (!quiet) {
          setData(null)
          setError('Could not reach the flows API.')
        }
      } finally {
        setLoading(false)
      }
    },
    [days, team, silent, internal],
  )

  useEffect(() => {
    if (isAdminAddress(address)) void load()
    else setLoading(false)
  }, [address, load])

  // Someone may be on the site right now: keep the page current while it is
  // the tab being looked at.
  useEffect(() => {
    if (!isAdminAddress(address)) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, REFRESH_MS)
    return () => clearInterval(t)
  }, [address, load])

  // A link from Growth names a wallet: open that person once the data lands.
  useEffect(() => {
    if (!focusWallet || !data || focused.current) return
    const hit = data.flows.find((f) => f.wallets.includes(focusWallet))
    if (!hit) return
    focused.current = true
    setOpen(new Set([hit.id]))
    requestAnimationFrame(() => document.querySelector(`[data-flow="${CSS.escape(hit.id)}"]`)?.scrollIntoView({ block: 'center' }))
  }, [focusWallet, data])

  const mark = useCallback(
    async (key: string, on: boolean) => {
      await fetch('/api/admin/flows/mark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, on }) }).catch(() => {})
      await load(true)
    },
    [load],
  )

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.flows ?? []).filter((f) => {
      if (pick === 'walls' && !WALL_OUTCOMES.has(f.outcome)) return false
      if (pick === 'errors' && !f.hadError && f.rage === 0) return false
      if (pick === 'live' && !f.live) return false
      if (pick === 'wallet' && !f.wallet) return false
      if (outcome && f.outcome !== outcome) return false
      if (source && f.source !== source) return false
      if (!q) return true
      return (
        f.wallets.some((w) => w.includes(q)) ||
        (f.email ?? '').includes(q) ||
        f.vids.some((v) => v.includes(q)) ||
        f.pages.some((p) => p.toLowerCase().includes(q)) ||
        f.items.some((i) => String(i.title ?? '').toLowerCase().includes(q) || String(i.detail ?? '').toLowerCase().includes(q))
      )
    })
  }, [data, pick, outcome, source, query])

  if (address && !isAdminAddress(address)) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] grid place-items-center text-[color:var(--muted)] mb-5">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Not authorized</h1>
        <p className="text-sm text-[color:var(--muted)]">User flows are limited to Pantessa admins.</p>
      </div>
    )
  }

  const head = (
    <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
      <div>
        <Link href="/dashboard/admin" className="inline-flex items-center gap-1 text-xs text-[color:var(--muted)] hover:text-white mono uppercase tracking-wide">
          <ArrowLeft className="w-3 h-3" /> Growth
        </Link>
        <h1 className="dash__h1">User flows</h1>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
          {FLOW_WINDOWS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs mono transition-colors ${days === d ? 'bg-[var(--surf-1)] text-white' : 'text-[color:var(--muted)] hover:text-white'}`}
              aria-pressed={days === d}
            >
              {d === 1 ? '24h' : `${d}d`}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-[color:var(--muted)] cursor-pointer select-none">
          <input type="checkbox" checked={team} onChange={(e) => setTeam(e.target.checked)} className="accent-[var(--accent,#34E0A1)]" />
          Show team
        </label>
        <label className="flex items-center gap-2 text-xs text-[color:var(--muted)] cursor-pointer select-none" title="Visits where no pointer, touch, scroll or key input was ever seen: bots, and people who hit back at once.">
          <input type="checkbox" checked={silent} onChange={(e) => setSilent(e.target.checked)} className="accent-[var(--accent,#34E0A1)]" />
          Show silent visits
        </label>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 text-xs text-[color:var(--muted)] hover:text-white" aria-label="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
    </div>
  )

  if (error && !data) {
    return (
      <>
        {head}
        <Card className="mt-4">
          <p className="text-sm text-[color:var(--muted)]">{error}</p>
          <button className="btn btn--solid mt-3" onClick={() => void load()}>
            Retry
          </button>
        </Card>
      </>
    )
  }
  if (!data) {
    return (
      <>
        {head}
        <div className="grid lg:grid-cols-3 gap-3 mt-4">
          <SkeletonCard bodyClassName="h-48" />
          <SkeletonCard bodyClassName="h-48" />
          <SkeletonCard bodyClassName="h-48" />
        </div>
        <SkeletonCard className="mt-3" bodyClassName="h-72" />
        <span className="sr-only" role="status">
          Loading user flows…
        </span>
      </>
    )
  }

  const s = data.summary
  const since = data.trackingSince ? new Date(data.trackingSince) : null
  return (
    <div className={loading ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
      {head}
      <p className="text-sm text-[color:var(--muted)] mb-4">
        {s.people} {s.people === 1 ? 'person' : 'people'} in the last {days === 1 ? '24 hours' : `${days} days`}.{' '}
        {!team && data.hidden.team > 0 && `${data.hidden.team} of ours hidden. `}
        {!silent && data.hidden.silent > 0 && `${data.hidden.silent} silent visits hidden (bots and instant backs). `}
        {since
          ? `Pages and clicks are on record since ${since.toLocaleDateString([], { month: 'short', day: 'numeric' })}; before that a timeline shows only what our tables kept.`
          : 'No page has been recorded yet: timelines below come from our tables alone until the first visit after this ships.'}
        {data.eventsCapped && ' The window holds more events than one load reads; narrow it to see the oldest.'}
      </p>

      <div className="grid lg:grid-cols-3 gap-3">
        <Card>
          <CardTitle eyebrow="how far they got">The climb</CardTitle>
          <Funnel summary={s} />
        </Card>

        <Card>
          <CardTitle eyebrow="click a row to filter">Where they stopped</CardTitle>
          {s.outcomes.length === 0 ? (
            <p className="text-sm text-[color:var(--muted-2)]">Nobody yet.</p>
          ) : (
            <ul className="space-y-1">
              {s.outcomes.map(({ outcome: o, n }) => {
                const tone = OUTCOME_TONE[o]
                const on = outcome === o
                return (
                  <li key={o}>
                    <button
                      type="button"
                      onClick={() => setOutcome(on ? null : o)}
                      aria-pressed={on}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left text-[13px] transition-colors ${on ? 'bg-[var(--surf-2)]' : 'hover:bg-[var(--surf-2)]'}`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: TONE_INK[tone] }} />
                        <span className="text-[color:var(--muted)] truncate">{OUTCOME_LABEL[o]}</span>
                      </span>
                      <span className="tabular-nums text-white">{n}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {(s.withErrors > 0 || s.exits.length > 0) && (
            <div className="mt-3 pt-3 border-t border-[var(--line)] text-xs text-[color:var(--muted)] space-y-1">
              {s.withErrors > 0 && (
                <p>
                  <span className="text-white tabular-nums">{s.withErrors}</span> saw a script error or a failing endpoint.
                </p>
              )}
              {s.exits.length > 0 && (
                <p className="break-words">
                  Left without acting, from:{' '}
                  {s.exits.slice(0, 5).map((e, i) => (
                    <span key={e.path}>
                      {i > 0 && ' · '}
                      <span className="mono text-white">{e.path}</span> {e.n}
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle eyebrow="click a row to filter">Where they came from</CardTitle>
          {s.sources.length === 0 ? (
            <p className="text-sm text-[color:var(--muted-2)]">Nobody yet.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-[color:var(--muted-2)] mono">
                  <th className="py-1 pr-2 font-medium">Source</th>
                  <th className="py-1 px-2 font-medium text-right">People</th>
                  <th className="py-1 px-2 font-medium text-right">Looked</th>
                  <th className="py-1 px-2 font-medium text-right">Asked</th>
                  <th className="py-1 pl-2 font-medium text-right">Signed</th>
                </tr>
              </thead>
              <tbody>
                {s.sources.map((r) => {
                  const on = source === r.source
                  return (
                    <tr key={r.source} onClick={() => setSource(on ? null : r.source)} className={`cursor-pointer border-t border-[var(--line)] ${on ? 'bg-[var(--surf-2)]' : 'hover:bg-[var(--surf-2)]'}`} aria-selected={on}>
                      <td className="py-1.5 pr-2 text-[color:var(--muted)]">{SOURCE_LABEL[r.source]}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-white">{r.n}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[color:var(--muted)]">{r.engaged}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[color:var(--muted)]">{r.asked}</td>
                      <td className="py-1.5 pl-2 text-right tabular-nums text-[color:var(--muted)]">{r.signed}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card className="mt-3">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div className="flex items-center gap-1 flex-wrap">
            {PICKS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPick(p.id)}
                aria-pressed={pick === p.id}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${pick === p.id ? 'bg-[var(--surf-2)] text-white' : 'text-[color:var(--muted)] hover:text-white'}`}
              >
                {p.label}
              </button>
            ))}
            {(outcome || source) && (
              <button type="button" onClick={() => (setOutcome(null), setSource(null))} className="px-2.5 py-1 rounded-md text-xs text-[color:var(--accent,#34E0A1)] hover:underline">
                Clear {outcome ? `“${OUTCOME_LABEL[outcome]}”` : ''} {source ? `“${SOURCE_LABEL[source]}”` : ''}
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--line)] text-xs text-[color:var(--muted)] min-w-0">
            <Search className="w-3.5 h-3.5 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="wallet, email, page, or words they saw"
              className="bg-transparent outline-none text-white placeholder:text-[color:var(--muted-2)] w-56 max-w-full"
              aria-label="Search flows"
            />
          </label>
        </div>
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-[color:var(--muted-2)]">
            {data.flows.length === 0 ? 'Nobody in this window yet.' : 'Nobody matches these filters.'}
          </p>
        ) : (
          <ul>
            {shown.map((f) => (
              <FlowRow
                key={f.id}
                flow={f}
                open={open.has(f.id)}
                onToggle={() =>
                  setOpen((cur) => {
                    const next = new Set(cur)
                    if (next.has(f.id)) next.delete(f.id)
                    else next.add(f.id)
                    return next
                  })
                }
                onMark={mark}
              />
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-[11px] text-[color:var(--muted-2)]">
        No cookie and no stored id: a visitor is a hash of the day’s salt, their IP and their browser family, and the salt is deleted after two days. Browsers that send Global Privacy Control or Do Not Track are not
        recorded at all, and neither is the chat embedded on other sites.
      </p>
    </div>
  )
}

export default function Page() {
  // useSearchParams needs a boundary so the dashboard shell can prerender.
  return (
    <Suspense fallback={null}>
      <FlowsPage />
    </Suspense>
  )
}
