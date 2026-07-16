'use client'

// First-run "Get started" checklist on the dashboard Overview — the pivot
// flow: ask → sign a guarded transaction → run a fund-then-act job → embed.
// Each step's done-state comes from /api/dashboard/onboarding, which reads
// what the wallet has actually done (chats, durable signed-tx records,
// completed wait-step jobs, embed keys), so it ticks off on its own. Hides
// once everything's done or the user dismisses it.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, X } from 'lucide-react'
import { Card } from '@/lib/dashboard-ui'

// v2: the x402-era checklist (approve/mint-key/paid-call/earn) was retired
// 2026-07-16 — a fresh key so everyone sees the new flow once, even if they
// dismissed the old one.
const DISMISS_KEY = 'yf_onboarding_dismissed_v2'

interface OnboardingStatus {
  chatted: boolean
  signedTx: boolean
  fundedJob: boolean
  embedKey: boolean
}

export default function OnboardingChecklist() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      /* storage blocked — just show it */
    }
  }, [])

  useEffect(() => {
    fetch('/api/dashboard/onboarding', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d ?? { chatted: false, signedTx: false, fundedJob: false, embedKey: false }))
      .catch(() => setStatus({ chatted: false, signedTx: false, fundedJob: false, embedKey: false }))
  }, [])

  // Hold until the live state arrives — painting four unchecked steps and
  // ticking them a beat later reads as flicker.
  if (dismissed || !status) return null

  const steps = [
    {
      label: 'Ask your agents anything',
      hint: 'Open the chat and ask — "what\'s in my wallet?", "ETH price?". Your MCPs answer, every call receipted.',
      done: status.chatted,
      href: '/chat',
      cta: 'Open chat',
    },
    {
      label: 'Sign a guarded transaction',
      hint: 'Try "swap $1 of ETH to USDC" or "stake $2 of ETH in Lido" — built, guard-checked, and priced before your wallet ever sees it.',
      done: status.signedTx,
      href: '/chat',
      cta: 'Build one',
    },
    {
      label: 'Run a fund-then-act job',
      hint: 'Ask for something your funds aren\'t in place for — "buy $2 of AAPL" with only Base USDC. Yeetful compiles the bridge, the wait, and the buy into one job.',
      done: status.fundedJob,
      href: '/chat?mcps=robinhood-free,near-intents-mcp-yeetful,yeetful-tool-wallet',
      cta: 'Try it',
    },
    {
      label: 'Embed the chat on your site',
      hint: 'Five lines put this chat on any page, signing with your visitors\' wallets. Mint a publishable embed key to start.',
      done: status.embedKey,
      href: '/dashboard/keys',
      cta: 'Mint embed key',
    },
  ]

  const completed = steps.filter((s) => s.done).length
  const allDone = completed === steps.length
  if (allDone) return null

  const next = steps.find((s) => !s.done)

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setDismissed(true)
  }

  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Get started</p>
          <p className="text-xs text-[color:var(--muted-2)] mt-0.5">
            {completed} of {steps.length} done — from first ask to money moved, then the chat on
            your own site.
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss the getting-started checklist"
          className="flex-shrink-0 -mr-1 -mt-1 p-1 rounded-md text-[color:var(--muted-2)] hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-400 transition-all"
          style={{ width: `${(completed / steps.length) * 100}%` }}
        />
      </div>

      <ul className="mt-3 divide-y divide-white/5">
        {steps.map((s) => {
          const isNext = next === s
          return (
            <li key={s.label} className="flex items-center gap-2.5 py-2 min-h-11">
              {s.done ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-[color:var(--muted-2)] flex-shrink-0" />
              )}
              <span className="min-w-0">
                <span className={s.done ? 'text-xs text-[color:var(--muted-2)] line-through' : 'text-xs text-white'}>
                  {s.label}
                </span>
                {isNext && <span className="block text-[11px] text-[color:var(--muted-2)] mt-0.5">{s.hint}</span>}
              </span>
              {isNext && (
                <Link
                  href={s.href}
                  className="ml-auto flex-shrink-0 inline-flex items-center text-xs font-medium px-3 py-1.5 max-lg:min-h-11 rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                >
                  {s.cta} →
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
