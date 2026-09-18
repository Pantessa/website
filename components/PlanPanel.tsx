'use client'

// Dashboard · Plan & usage (pricing v2). Where your house answers come from —
// the free daily ones, the Plus allowance, the bank you earned by trading or
// bought — and the "Your AI key" setting that makes all of it moot. Reads
// GET /api/billing/plan; purchases go through /pricing → Stripe Checkout,
// management through the Stripe Billing Portal, the key through
// /api/billing/ai-key (session only; the key is never sent back).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardTitle, Kpi, SkeletonCard, timeAgo } from '@/lib/dashboard-ui'
import type { PlanUsage } from '@/lib/billing'
import type { Plan } from '@/lib/plans'
import type { InferenceKeyMeta } from '@/lib/byok'

interface LedgerEntry {
  id: string
  delta: number
  reason: string
  pool: string | null
  createdAt: string
}
interface PlanResponse {
  usage: PlanUsage
  ledger: LedgerEntry[]
  plans: Plan[]
  pack: { answers: number; priceUsd: number }
  taste: { wallet: number; freshWallet: number; guest: number; ip: number }
  aiKey: { enabled: boolean; key: InferenceKeyMeta | null; models: { id: string; label: string }[] }
  stripeConfigured: boolean
}

function entryLabel(e: LedgerEntry): string {
  if (e.reason === 'earned-by-trading') return 'Earned by trading'
  if (e.reason === 'answer-pack') return 'Answer pack'
  const where = e.reason === 'embed-house-inference' ? ' · your embed' : ''
  if (e.pool === 'taste') return `Free answer${where}`
  if (e.pool === 'bank') return `Banked answer${where}`
  return `House answer${where}`
}

export default function PlanPanel() {
  const [data, setData] = useState<PlanResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [portalBusy, setPortalBusy] = useState(false)

  const load = useCallback(() => {
    void fetch('/api/billing/plan')
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Failed to load plan')
        return (await r.json()) as PlanResponse
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const openPortal = async () => {
    setPortalBusy(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (d.url) window.location.href = d.url
      else setError(d.error ?? 'Could not open the billing portal.')
    } finally {
      setPortalBusy(false)
    }
  }

  if (error) {
    return (
      <Card>
        <p className="text-sm text-[color:var(--muted)]">{error}</p>
      </Card>
    )
  }
  if (!data) return <SkeletonCard />

  const u = data.usage
  const planLeft = Math.max(0, u.allowance - u.used)
  const pct = u.allowance > 0 ? Math.min(100, Math.round((u.used / u.allowance) * 100)) : 0
  const daysLeft = Math.max(0, Math.ceil((new Date(u.periodEnd).getTime() - Date.now()) / 86_400_000))
  const isPaid = u.priceUsd > 0
  const onOwnKey = !!data.aiKey.key

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {/* current plan + actions */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle serif eyebrow="CURRENT PLAN">
              {u.planName}
              {isPaid && (
                <span className="mono text-[13px] text-[color:var(--muted)] ml-2">
                  ${u.priceUsd}/mo · {u.status}
                </span>
              )}
            </CardTitle>
            <p className="text-[13px] text-[color:var(--muted)] mt-1">
              {isPaid
                ? `${u.allowance.toLocaleString()} house answers each month${u.renewsAt ? ` · renews ${new Date(u.renewsAt).toLocaleDateString()}` : ` · resets in ${daysLeft}d`}`
                : 'Charts, watchlists, alerts, trades and automations are all free, with no limits.'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isPaid && data.stripeConfigured && (
              <button className="btn btn--ghost !h-10 !px-4 !text-[13.5px]" onClick={() => void openPortal()} disabled={portalBusy}>
                {portalBusy ? 'Opening…' : 'Manage billing'}
              </button>
            )}
            <Link href="/pricing" className="btn btn--solid !h-10 !px-4 !text-[13.5px]">
              {isPaid ? 'Pricing' : 'Get more answers'}
            </Link>
          </div>
        </div>
      </Card>

      {/* where your answers come from */}
      <Card>
        <CardTitle serif eyebrow="HOUSE ANSWERS">
          {onOwnKey ? 'Unlimited — running on your own key' : 'Where your answers come from'}
        </CardTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <Kpi label="free, every day" value={String(u.tasteDaily)} sub="resets midnight UTC" small />
          <Kpi label="banked" value={u.bank.toLocaleString()} sub="earned + bought · never expire" small />
          <Kpi label={isPaid ? 'plan, left this month' : 'plan'} value={isPaid ? planLeft.toLocaleString() : '—'} sub={isPaid ? `of ${u.allowance.toLocaleString()}` : `Plus adds ${(data.plans.find((p) => p.id === 'plus')?.credits ?? 0).toLocaleString()} a month`} small />
          <Kpi label="banked this month" value={u.granted > 0 ? `+${u.granted.toLocaleString()}` : '0'} small />
        </div>
        {isPaid && (
          <div className="planmeter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Plan answers used this month">
            <div className="planmeter__fill" style={{ width: `${pct}%` }} />
          </div>
        )}
        <p className="text-[13px] leading-relaxed text-[color:var(--muted)] mt-3">
          Free answers are spent first, then your plan, then the bank. Anything that builds a transaction — a swap, a
          stock buy, a DCA, a stop — never uses one. Every swap you sign through Uniswap banks answers from its fee;{' '}
          <Link href="/pricing" className="underline underline-offset-2">
            see the rates
          </Link>
          .
        </p>
      </Card>

      <AiKeyCard ai={data.aiKey} onChange={load} />

      {/* recent activity */}
      <Card className="min-w-0">
        <CardTitle serif eyebrow="RECENT">
          Answer activity
        </CardTitle>
        {data.ledger.length === 0 ? (
          <p className="text-[13px] text-[color:var(--muted-2)] mt-2">Nothing yet — your first house answer in chat shows up here.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {data.ledger.map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3 py-1.5 border-b border-[color:var(--line)] last:border-0 text-[13px]">
                <span className="text-[color:var(--muted)] truncate">{entryLabel(e)}</span>
                <span className="mono whitespace-nowrap">
                  <span className={e.delta > 0 ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted)]'}>
                    {e.delta > 0 ? `+${e.delta}` : e.delta === 0 ? 'free' : e.delta}
                  </span>{' '}
                  <span className="text-[color:var(--muted-2)]">{timeAgo(e.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

/** "Your AI key" — bring your own Anthropic key. The field is write-only:
 *  once saved the page only ever knows the last four characters. */
function AiKeyCard({ ai, onChange }: { ai: PlanResponse['aiKey']; onChange: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const call = async (method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>, ok?: string) => {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch('/api/billing/ai-key', {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setNote({ tone: 'bad', text: d.error ?? 'That didn’t work — try again.' })
        return
      }
      setValue('')
      if (ok) setNote({ tone: 'ok', text: ok })
      onChange()
    } finally {
      setBusy(false)
    }
  }

  const key = ai.key
  return (
    <Card>
      <div id="ai-key" className="scroll-mt-24" />
      <CardTitle serif eyebrow="YOUR AI KEY">
        {key ? `Connected · sk-ant-…${key.last4}` : 'Bring your own API key'}
      </CardTitle>
      <p className="text-[13.5px] leading-relaxed text-[color:var(--muted)] mt-2">
        Paste an Anthropic API key and every house answer and market brief runs on it — unlimited, billed to you by
        Anthropic, free here. It is checked before it is saved, encrypted at rest, and never shown again. Use a key from
        its own Console workspace with a spend limit.
      </p>

      {!ai.enabled ? (
        <p className="mono text-[11.5px] tracking-wider text-[color:var(--muted-2)] mt-3">NOT SWITCHED ON FOR THIS DEPLOYMENT YET</p>
      ) : key ? (
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] text-[color:var(--muted)]" htmlFor="ai-key-model">
            Model for written answers
            <select
              id="ai-key-model"
              className="h-10 rounded-lg border border-[color:var(--line)] bg-[color:var(--surf-2)] px-3 text-[13.5px] text-[color:var(--fg)] max-w-md"
              value={key.synthModel}
              disabled={busy}
              onChange={(e) => void call('PATCH', { synthModel: e.target.value }, 'Saved.')}
            >
              {ai.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2.5 text-[13px] text-[color:var(--muted)]" htmlFor="ai-key-embeds">
            <input
              id="ai-key-embeds"
              type="checkbox"
              className="mt-0.5"
              checked={key.useForEmbeds}
              disabled={busy}
              onChange={(e) => void call('PATCH', { useForEmbeds: e.target.checked }, 'Saved.')}
            />
            <span>
              Also use this key for visitors of my embedded chats. <span className="text-[color:var(--muted-2)]">Off by default: their answers would bill your key.</span>
            </span>
          </label>
          {key.lastError && <p className="text-[13px] text-[#ffb86b]">Last problem: {key.lastError}. Answers fall back to your free and banked ones until the key works again.</p>}
          <div className="flex items-center gap-3 flex-wrap">
            <button className="btn btn--ghost !h-10 !px-4 !text-[13.5px]" disabled={busy} onClick={() => void call('DELETE', undefined, 'Key removed.')}>
              Remove key
            </button>
            <span className="mono text-[11px] tracking-wider text-[color:var(--muted-2)]">
              {key.lastUsedAt ? `LAST USED ${timeAgo(key.lastUsedAt).toUpperCase()}` : 'NOT USED YET'}
            </span>
          </div>
        </div>
      ) : (
        <form
          className="mt-4 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) void call('POST', { key: value.trim() }, 'Key checked and saved. Your answers now run on it.')
          }}
        >
          <label className="sr-only" htmlFor="ai-key-input">
            Anthropic API key
          </label>
          <input
            id="ai-key-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-10 min-w-0 flex-1 basis-64 rounded-lg border border-[color:var(--line)] bg-[color:var(--surf-2)] px-3 mono text-[13px] text-[color:var(--fg)]"
          />
          <button type="submit" className="btn btn--solid !h-10 !px-4 !text-[13.5px]" disabled={busy || !value.trim()}>
            {busy ? 'Checking…' : 'Check and save'}
          </button>
        </form>
      )}
      {note && <p className={`text-[13px] mt-3 ${note.tone === 'ok' ? 'text-[color:var(--accent)]' : 'text-[#ffb86b]'}`}>{note.text}</p>}
    </Card>
  )
}
