'use client'

// Dashboard · Embeds — the embed OWNER's view (a DEX watching its own site's
// agent): what visitors ask, what the agent did about it, the transactions
// it built (chain + explorer links), sign rate, per-site stats — and the
// DEAD-END sessions, because the visitor's goal is a transaction and every
// session that didn't reach one is the improvement backlog. The "Upgrade
// your MCP" card turns that backlog into a copy-paste Claude Code prompt —
// the manual precursor to the self-healing loop.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Check, Copy, Globe, TriangleAlert, Wrench } from 'lucide-react'
import { Card, CardTitle, Kpi, SkeletonCard, SkeletonKpi, timeAgo } from '@/lib/dashboard-ui'

interface TurnLite {
  prompt: string
  outcome: string
  detail: string | null
  at: string
}
interface SessionLite {
  origin: string
  startedAt: string
  endedAt: string
  turns: TurnLite[]
}
interface PathRow {
  path: string
  built: number
  signed: number
  builtUsd: number
  signedUsd: number
}
interface Insights {
  windowDays: number
  keys: { id: string; key: string; label: string; revoked: boolean }[]
  totals: {
    turns: number
    sessions: number
    answered: number
    clarify: number
    txBuilt: number
    signed: number
    refused: number
    errors: number
    creditGated: number
    signRate: number | null
    deadEndSessions: number
    builtUsd: number
    signedUsd: number
  }
  funnel: { sessions: number; withTxBuilt: number; withSigned: number }
  recentAsks: { prompt: string; outcome: string; origin: string; at: string }[]
  transactions: {
    outcome: string
    artifact: string | null
    chain: string | null
    txUrl: string | null
    detail: string | null
    prompt: string
    origin: string
    valueUsd: number | null
    buildPath: string | null
    at: string
  }[]
  /** Which build layer created each transaction (native-* | planner | manual). */
  perPath: PathRow[]
  deadEnds: SessionLite[]
  builtNotSigned: SessionLite[]
  perSite: { origin: string; pageUrl: string | null; turns: number; sessions: number; txBuilt: number; signed: number; signedUsd: number; friction: number; lastAt: string }[]
  sites: { origin: string; pageUrl: string | null; mountTurns: number; lastSeen: string }[]
  /** Platform-wide money flow — present only for admin viewers. */
  global?: {
    systemTotalUsd: number
    allTimeSignedUsd: number
    allTimeSignedCount: number
    windowSignedUsd: number
    windowSignedCount: number
    windowBuiltUsd: number
    windowBuiltCount: number
    chatSignedUsd: number
    chatSignedCount: number
    x402AllTimeUsd: number
    x402AllTimeCount: number
    x402WindowUsd: number
    x402WindowCount: number
    perPath: PathRow[]
  }
}

/** $1,234 above a grand, cents below — money reads at a glance either way. */
const fmtUsd = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`)

const OUTCOME_STYLE: Record<string, string> = {
  answered: 'border-[color:var(--line-2)] text-[color:var(--muted)]',
  clarify: 'border-amber-400/40 text-amber-400',
  // NOTE: never `var(--x)]/N` color modifiers — Tailwind can't opacity-modify
  // a CSS-var color and silently paints transparent (live bug: invisible bars).
  'tx-built': 'border-[color:var(--accent)] text-[color:var(--accent)]',
  signed: 'bg-[color:var(--accent)] text-black border-transparent font-semibold',
  refused: 'border-red-400/50 text-red-400',
  error: 'border-red-400/50 text-red-400',
  'credit-gate': 'border-amber-400/40 text-amber-400',
}
const ARTIFACT_LABEL: Record<string, string> = {
  'cow-order': 'CoW order',
  tx: 'Transaction',
  'tx-chain': 'Multi-step tx',
  vote: 'DAO vote',
}
/** Human names for embed_turns.build_path (lib/build-path.ts). */
const PATH_LABEL: Record<string, string> = {
  'native-aave-supply': 'Native · Aave supply',
  'native-aave-op': 'Native · Aave withdraw/borrow/repay',
  'native-swap-uniswap': 'Native · Uniswap swap',
  'native-swap-uniswap-v4': 'Native · Uniswap v4 swap',
  'native-swap-cow': 'Native · CoW swap',
  'native-cross-chain': 'Native · cross-chain swap',
  planner: 'Planner-routed tool',
  manual: 'Direct tool call',
  unattributed: 'Unattributed (pre-tracking)',
}

function OutcomeChip({ outcome }: { outcome: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10.5px] mono uppercase tracking-wide whitespace-nowrap ${OUTCOME_STYLE[outcome] ?? OUTCOME_STYLE.answered}`}>
      {outcome}
    </span>
  )
}

function SessionTrail({ s }: { s: SessionLite }) {
  return (
    <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] p-3.5 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <span className="mono text-[11px] text-[color:var(--muted-2)] inline-flex items-center gap-1.5">
          <Globe className="w-3 h-3" /> {s.origin.replace(/^https?:\/\//, '')}
        </span>
        <span className="mono text-[11px] text-[color:var(--muted-2)]">
          {s.turns.length} turn{s.turns.length === 1 ? '' : 's'} · {timeAgo(s.endedAt)}
        </span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {s.turns.slice(-4).map((t, i) => (
          <li key={i} className="flex items-start justify-between gap-3 text-[13px] min-w-0">
            <span className="text-[color:var(--muted)] truncate" title={t.detail ?? t.prompt}>
              {t.prompt || <em className="text-[color:var(--muted-2)]">{t.detail ?? '(follow-up)'}</em>}
            </span>
            <OutcomeChip outcome={t.outcome} />
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The "upgrade your MCP" Claude Code prompt — real friction, verbatim, plus
 * the repair playbook. Deterministic template over live data. */
function upgradePrompt(d: Insights): string {
  const deadAsks = d.deadEnds
    .map((s) => s.turns.find((t) => t.prompt)?.prompt)
    .filter(Boolean)
    .slice(0, 10)
  const frictions = d.deadEnds
    .flatMap((s) => s.turns.filter((t) => t.outcome === 'refused' || t.outcome === 'error').map((t) => t.detail))
    .filter(Boolean)
    .slice(0, 8)
  const abandoned = d.builtNotSigned.length
  return `My site embeds the Yeetful agent chat (yeetful/embed). Over the last ${d.windowDays} days: ${d.totals.sessions} sessions, ${d.totals.txBuilt} transactions built, ${d.totals.signed} signed, ${d.totals.deadEndSessions} DEAD-END sessions (visitor hit friction and never got a transaction built). Help me fix the dead ends.

Real visitor asks that dead-ended (verbatim):
${deadAsks.length ? deadAsks.map((a) => `- "${a}"`).join('\n') : '- (none recorded yet)'}

Refusals/errors the agent hit:
${frictions.length ? frictions.map((f) => `- ${f}`).join('\n') : '- (none recorded)'}
${abandoned > 0 ? `\nAlso: ${abandoned} sessions built a transaction the visitor never signed — check whether the summaries/guardrail cards explain the transaction clearly enough.\n` : ''}
Do this:
1. Group the dead-end asks: which are MISSING TOOLS on my MCP (an ask my API could answer but no tool exposes), which are missing PARAMS/schemas, which are docs questions my corpus doesn't cover, and which need an MCP I haven't added to my set.
2. For missing tools/params: implement them on my MCP server. Every tool needs a machine-readable input schema and a one-line description a router can rank — run \`npm run mcp:lint\` from the Yeetful website repo against my MCP and fix everything it flags below an A.
3. For docs gaps: add the missing pages to my docs corpus and rebuild it.
4. For set gaps: tell me which Yeetful directory MCPs (https://www.yeetful.com/servers) to add to my embed's mcps=[...] list.
5. Re-run mcp:lint and give me a before/after routability score.`
}

export default function EmbedInsights() {
  const [data, setData] = useState<Insights | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void fetch('/api/embeds/insights', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Failed to load insights')
        return (await r.json()) as Insights
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error)
    return (
      <Card>
        <p className="text-sm text-[color:var(--muted)]">{error}</p>
      </Card>
    )
  if (!data)
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonKpi key={i} />
          ))}
        </div>
        <SkeletonCard bodyClassName="h-40" />
      </>
    )

  const t = data.totals
  const noData = t.turns === 0
  const g = data.global

  // Money moved — THE progress number. For admins the big number is the whole
  // system's flow, all time: transaction notional signed (chat + every embed,
  // guardrail-priced) PLUS x402 call fees settled through the router. Everyone
  // else sees their own embeds' flow.
  const moneyMoved = (
    <Card>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <CardTitle serif eyebrow={g ? 'THE NUMBER · WHOLE SYSTEM' : 'THE NUMBER'}>
            Money moved
          </CardTitle>
          <div className="mt-2 font-serif text-[42px] leading-none text-white tabular-nums">
            {fmtUsd(g ? g.systemTotalUsd : t.signedUsd)}
          </div>
          <p className="mono text-[11.5px] text-[color:var(--muted-2)] mt-2">
            {g
              ? `everything, all time — ${g.allTimeSignedCount} signed transaction${g.allTimeSignedCount === 1 ? '' : 's'} + ${g.x402AllTimeCount} settled x402 call${g.x402AllTimeCount === 1 ? '' : 's'}`
              : `signed through your embeds · last ${data.windowDays}d · ${t.signed} transaction${t.signed === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 text-[12.5px] text-[color:var(--muted)] mono">
          {g ? (
            <>
              <span>
                {fmtUsd(g.allTimeSignedUsd)} <span className="text-[color:var(--muted-2)]">tx signed · all time ({g.allTimeSignedCount})</span>
              </span>
              <span>
                {fmtUsd(g.x402AllTimeUsd)} <span className="text-[color:var(--muted-2)]">x402 fees settled · all time ({g.x402AllTimeCount})</span>
              </span>
              <span>
                {fmtUsd(g.windowSignedUsd)} <span className="text-[color:var(--muted-2)]">tx signed · {data.windowDays}d</span> ·{' '}
                {fmtUsd(g.x402WindowUsd)} <span className="text-[color:var(--muted-2)]">x402 · {data.windowDays}d</span>
              </span>
              <span>
                {fmtUsd(g.windowBuiltUsd)} <span className="text-[color:var(--muted-2)]">built awaiting signature · {data.windowDays}d ({g.windowBuiltCount})</span>
              </span>
              <span>
                {fmtUsd(g.chatSignedUsd)} <span className="text-[color:var(--muted-2)]">via yeetful.com chat ({g.chatSignedCount})</span>
              </span>
              {t.signedUsd > 0 && (
                <span>
                  {fmtUsd(t.signedUsd)} <span className="text-[color:var(--muted-2)]">via your embeds · {data.windowDays}d</span>
                </span>
              )}
            </>
          ) : (
            <span>
              {fmtUsd(t.builtUsd)} <span className="text-[color:var(--muted-2)]">built, awaiting signature ({t.txBuilt})</span>
            </span>
          )}
        </div>
      </div>
      <p className="text-[12.5px] text-[color:var(--muted-2)] mt-3 max-w-[80ch]">
        {g ? (
          <>
            Every dollar the system moved: notional USD of transactions built &amp; signed (chat +
            every embed — swaps count at quoted value even on free MCPs) plus x402 call fees actually
            settled through the router. Priced by the guardrail layer at build time; transactions it
            can&rsquo;t price are counted but add $0.
          </>
        ) : (
          <>
            Notional USD of the transactions the agent built that actually got signed — swaps count at
            their quoted value even on free MCPs ($0 fees still move real money). Priced by the guardrail
            layer at build time; transactions it can&rsquo;t price are counted but add $0.
          </>
        )}
      </p>
    </Card>
  )

  if (noData) {
    return (
      <div className="flex flex-col gap-4 min-w-0">
        {g && moneyMoved}
        <Card>
          <CardTitle serif eyebrow="NO TURNS YET">
            Waiting for the first embedded conversation
          </CardTitle>
          <p className="text-[13.5px] text-[color:var(--muted)] mt-2 max-w-[70ch] leading-relaxed">
            {data.sites.length > 0
              ? `${data.sites.length} site${data.sites.length === 1 ? ' has' : 's have'} mounted your embed — analytics fill in the moment a visitor sends a prompt.`
              : 'No sites are running your embed yet. Grab your key + the install prompt from the Keys page.'}{' '}
            <Link href="/dashboard/keys#embed-keys" className="underline underline-offset-2 decoration-dotted hover:text-white">
              Embed setup →
            </Link>
          </p>
        </Card>
      </div>
    )
  }

  const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {/* money moved — the headline */}
      {moneyMoved}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Kpi label={`Turns · ${data.windowDays}d`} value={String(t.turns)} small />
        <Kpi label="Sessions" value={String(t.sessions)} small />
        <Kpi label="Tx built" value={String(t.txBuilt)} small />
        <Kpi label="Signed" value={String(t.signed)} sub={t.signRate != null ? `${Math.round(t.signRate * 100)}% of built` : undefined} small />
        <Kpi label="Refused / errors" value={String(t.refused + t.errors)} small />
        <Kpi label="Dead-end sessions" value={String(t.deadEndSessions)} small />
      </div>

      {/* funnel — the one number that matters: ask → built → signed */}
      <Card>
        <CardTitle serif eyebrow="THE FUNNEL">
          Session → transaction built → signed
        </CardTitle>
        <div className="mt-3 flex flex-col gap-2">
          {[
            { label: 'Sessions', n: data.funnel.sessions, base: data.funnel.sessions },
            { label: 'Built a transaction', n: data.funnel.withTxBuilt, base: data.funnel.sessions },
            { label: 'Signed one', n: data.funnel.withSigned, base: data.funnel.sessions },
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-3 min-w-0">
              <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] w-44 flex-shrink-0">
                {row.label}
              </span>
              <div className="flex-1 h-5 rounded-md bg-white/[0.04] overflow-hidden min-w-0">
                <div className="h-full rounded-md bg-[color:var(--accent)] opacity-80" style={{ width: `${Math.max(2, pct(row.n, row.base))}%` }} />
              </div>
              <span className="mono text-[12px] w-16 text-right flex-shrink-0">
                {row.n} <span className="text-[color:var(--muted-2)]">· {pct(row.n, row.base)}%</span>
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* build layers — which layer creates transactions, which layer's builds
          die unsigned. Admins see the whole system (every embed + first-party
          chat); owners see their own embeds. Per-turn detail: route_trace_lines. */}
      {(() => {
        const rows = g?.perPath?.length ? g.perPath : data.perPath
        if (!rows?.length) return null
        const maxBuilt = Math.max(...rows.map((r) => Math.max(r.built, r.signed)), 1)
        return (
          <Card>
            <CardTitle serif eyebrow={g?.perPath?.length ? 'BUILD LAYERS · WHOLE SYSTEM' : 'BUILD LAYERS'}>
              Where transactions come from
            </CardTitle>
            <p className="text-[12.5px] text-[color:var(--muted-2)] mt-1 max-w-[80ch]">
              Each built transaction names the layer that constructed it — the native guardrailed
              builders, a planner-routed tool, or a direct tool call. A layer that builds plenty but
              rarely gets signed is where transactions are dying.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {rows.map((r) => {
                const signRate = r.built > 0 ? Math.round((r.signed / r.built) * 100) : null
                return (
                  <div key={r.path} className="flex items-center gap-3 min-w-0">
                    <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] w-56 flex-shrink-0 truncate" title={r.path}>
                      {PATH_LABEL[r.path] ?? r.path}
                    </span>
                    <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                      <div className="h-2.5 rounded bg-white/[0.04] overflow-hidden">
                        <div className="h-full rounded bg-[color:var(--accent)] opacity-40" style={{ width: `${Math.max(2, Math.round((r.built / maxBuilt) * 100))}%` }} />
                      </div>
                      <div className="h-2.5 rounded bg-white/[0.04] overflow-hidden">
                        <div className="h-full rounded bg-[color:var(--accent)]" style={{ width: `${Math.max(r.signed > 0 ? 2 : 0, Math.round((r.signed / maxBuilt) * 100))}%` }} />
                      </div>
                    </div>
                    <span className="mono text-[11.5px] w-40 text-right flex-shrink-0 tabular-nums">
                      {r.built} built → {r.signed} signed
                      <span className="text-[color:var(--muted-2)]"> {signRate != null ? `· ${signRate}%` : ''}</span>
                    </span>
                    <span className="mono text-[11.5px] w-20 text-right flex-shrink-0 text-[color:var(--muted-2)] tabular-nums">
                      {r.signedUsd > 0 ? fmtUsd(r.signedUsd) : r.builtUsd > 0 ? `(${fmtUsd(r.builtUsd)})` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="mono text-[10.5px] text-[color:var(--muted-2)] mt-2">
              faint bar = built · solid bar = signed · $ = signed notional (built in parens)
            </p>
          </Card>
        )
      })()}

      {/* asks + transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0">
        <Card className="min-w-0">
          <CardTitle serif eyebrow="LIVE FROM YOUR SITES">
            What people are asking
          </CardTitle>
          <ul className="mt-2 flex flex-col max-h-96 overflow-y-auto">
            {data.recentAsks.map((a, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2 border-b border-[color:var(--line)] last:border-0 text-[13px] min-w-0">
                <span className="min-w-0">
                  <span className="text-white block truncate" title={a.prompt}>
                    {a.prompt}
                  </span>
                  <span className="mono text-[10.5px] text-[color:var(--muted-2)]">
                    {a.origin.replace(/^https?:\/\//, '')} · {timeAgo(a.at)}
                  </span>
                </span>
                <OutcomeChip outcome={a.outcome} />
              </li>
            ))}
          </ul>
        </Card>

        <Card className="min-w-0">
          <CardTitle serif eyebrow="THE POINT OF ALL THIS">
            Transactions built &amp; signed
          </CardTitle>
          {data.transactions.length === 0 ? (
            <p className="text-[13px] text-[color:var(--muted-2)] mt-2">No transactions built in this window yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col max-h-96 overflow-y-auto">
              {data.transactions.map((x, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-2 border-b border-[color:var(--line)] last:border-0 text-[13px] min-w-0">
                  <span className="min-w-0">
                    <span className="text-white block truncate">
                      {ARTIFACT_LABEL[x.artifact ?? ''] ?? 'Transaction'}
                      {x.valueUsd != null && x.valueUsd > 0 && (
                        <span className="mono text-[11px] text-[color:var(--accent)]"> · {fmtUsd(x.valueUsd)}</span>
                      )}
                      {x.chain && <span className="mono text-[10.5px] text-[color:var(--muted-2)]"> · {x.chain}</span>}
                      {x.buildPath && <span className="mono text-[10.5px] text-[color:var(--muted-2)]"> · {PATH_LABEL[x.buildPath] ?? x.buildPath}</span>}
                    </span>
                    <span className="text-[color:var(--muted-2)] text-[12px] block truncate" title={x.prompt}>
                      “{x.prompt || '…'}”
                    </span>
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    {x.txUrl && (
                      <a href={x.txUrl} target="_blank" rel="noreferrer" className="mono text-[11px] text-[color:var(--accent)] inline-flex items-center gap-0.5 hover:underline">
                        tx <ArrowUpRight className="w-3 h-3" />
                      </a>
                    )}
                    <OutcomeChip outcome={x.outcome} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* dead ends — the improvement backlog */}
      <Card>
        <div className="flex items-center gap-2">
          <TriangleAlert className="w-4 h-4 text-amber-400" />
          <CardTitle serif eyebrow="THE IMPROVEMENT BACKLOG">
            Dead-end conversations
          </CardTitle>
        </div>
        <p className="text-[12.5px] text-[color:var(--muted-2)] mt-1 max-w-[80ch]">
          Sessions that hit friction (clarify / refusal / error) and never reached a built or signed
          transaction — the visitor came to transact and couldn&rsquo;t. Fix what&rsquo;s here and the
          funnel moves.
        </p>
        {data.deadEnds.length === 0 ? (
          <p className="text-[13px] text-[color:var(--muted-2)] mt-3">None in this window. 🎉</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
            {data.deadEnds.slice(0, 8).map((s, i) => (
              <SessionTrail s={s} key={i} />
            ))}
          </div>
        )}
        {data.builtNotSigned.length > 0 && (
          <p className="mono text-[11.5px] text-[color:var(--muted-2)] mt-3">
            + {data.builtNotSigned.length} session{data.builtNotSigned.length === 1 ? '' : 's'} built a transaction the
            visitor never signed (abandonment — usually a clarity or trust problem, not a tooling one).
          </p>
        )}
      </Card>

      {/* upgrade your MCP */}
      <Card>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-[color:var(--accent)]" />
            <CardTitle serif eyebrow="CLOSE THE LOOP">
              Upgrade your MCP
            </CardTitle>
          </div>
          <button
            className="btn btn--solid !h-9 !px-4 !text-[13px]"
            onClick={() => {
              void navigator.clipboard.writeText(upgradePrompt(data)).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              })
            }}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Copy Claude prompt
              </>
            )}
          </button>
        </div>
        <p className="text-[12.5px] text-[color:var(--muted-2)] mt-1 max-w-[80ch]">
          Your dead ends, as a work order: paste this into Claude Code in your MCP&rsquo;s repo. It
          carries the verbatim failed asks + errors and the repair playbook (missing tools → schemas
          → docs → set changes → <span className="mono">mcp:lint</span> before/after).
        </p>
        <pre className="mt-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 mono text-[12px] leading-relaxed text-[color:var(--muted)] overflow-x-auto max-h-56">
          {upgradePrompt(data)}
        </pre>
      </Card>

      {/* per-site */}
      <Card>
        <CardTitle serif eyebrow="PER SITE">
          Your embeds, compared
        </CardTitle>
        <div className="overflow-x-auto -mx-1 px-1 mt-2">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mono">
                <th className="py-2 pr-3 font-medium">Site</th>
                <th className="py-2 pr-3 font-medium text-right">Turns</th>
                <th className="py-2 pr-3 font-medium text-right">Sessions</th>
                <th className="py-2 pr-3 font-medium text-right">Built</th>
                <th className="py-2 pr-3 font-medium text-right">Signed</th>
                <th className="py-2 pr-3 font-medium text-right">Signed $</th>
                <th className="py-2 pr-3 font-medium text-right">Friction</th>
                <th className="py-2 pr-3 font-medium text-right">Last</th>
              </tr>
            </thead>
            <tbody className="text-[color:var(--muted)]">
              {data.perSite.map((s) => (
                <tr key={s.origin} className="border-t border-[var(--line)]">
                  <td className="py-2 pr-3 text-white">
                    <a href={s.pageUrl ?? s.origin} target="_blank" rel="noreferrer" className="hover:text-[color:var(--accent)] transition-colors">
                      {s.origin.replace(/^https?:\/\//, '')}
                    </a>
                  </td>
                  <td className="py-2 pr-3 text-right mono">{s.turns}</td>
                  <td className="py-2 pr-3 text-right mono">{s.sessions}</td>
                  <td className="py-2 pr-3 text-right mono">{s.txBuilt}</td>
                  <td className="py-2 pr-3 text-right mono text-[color:var(--accent)]">{s.signed}</td>
                  <td className="py-2 pr-3 text-right mono text-[color:var(--accent)]">{s.signedUsd > 0 ? fmtUsd(s.signedUsd) : '—'}</td>
                  <td className="py-2 pr-3 text-right mono">{s.friction}</td>
                  <td className="py-2 pr-3 text-right text-xs text-[color:var(--muted-2)]">{timeAgo(s.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
