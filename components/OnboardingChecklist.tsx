'use client'

// First-run "Get started" checklist on the dashboard Overview — the
// links-first flow: mint a link → share it → watch the funnel → first
// conversion → claim your earnings. Each step's done-state comes from
// /api/dashboard/onboarding, which reads what the wallet has actually done
// (live links, funnel events, server-truth signed turns, claims), so it
// ticks off on its own. Hides once everything's done or the user dismisses.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, X } from 'lucide-react'
import { Card } from '@/lib/dashboard-ui'
import { dismissOnboarding, onboardingDismissed, useOnboardingStatus } from '@/lib/onboarding'

export default function OnboardingChecklist() {
  const { status } = useOnboardingStatus()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(onboardingDismissed())
  }, [])

  // Hold until the live state arrives — painting five unchecked steps and
  // ticking them a beat later reads as flicker.
  if (dismissed || !status) return null

  const steps = [
    {
      label: 'Mint your first link',
      hint: 'One sentence — "Buy $5 of AAPL", "DCA $25 into ETH weekly" — becomes a link anyone can act on. We\'ll prefill an ask.',
      done: status.minted,
      href: `/dashboard/links?ask=${encodeURIComponent('Buy $5 of AAPL')}`,
      cta: 'Mint a link',
    },
    {
      label: 'Share it',
      hint: 'Post it, DM it, drop it in your community. The moment someone opens it, this ticks.',
      done: status.opened,
      href: '/dashboard/links',
      cta: 'Copy your link',
    },
    {
      label: 'Watch the funnel',
      hint: 'Opens → connects → built → signed, per link, live on your links page. Ticks when a visitor connects a wallet.',
      done: status.connected,
      href: '/dashboard/links',
      cta: 'Open the funnel',
    },
    {
      label: 'First conversion',
      hint: 'Someone signs through your link — guarded, priced, their own wallet. That conversion also starts your earnings.',
      done: status.converted,
      href: '/links',
      cta: 'See the board',
    },
    {
      label: 'Claim your earnings',
      hint: 'You keep half of Pantessa\'s 0.20% fee on your links\' conversions. Claims open at $10, paid in USDC on Base.',
      done: status.claimed,
      href: '/dashboard/links',
      cta: 'Claim',
    },
  ]

  const completed = steps.filter((s) => s.done).length
  const allDone = completed === steps.length
  if (allDone) return null

  const next = steps.find((s) => !s.done)

  const dismiss = () => {
    dismissOnboarding()
    setDismissed(true)
  }

  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Get started</p>
          <p className="text-xs text-[color:var(--muted-2)] mt-0.5">
            {completed} of {steps.length} done — from your first link to your first payout.
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
