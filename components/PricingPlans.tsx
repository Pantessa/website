'use client'

// The /pricing plan cards + checkout wiring. Free tier: connect (or jump to
// the plan page when signed in). Paid tiers: POST /api/billing/checkout →
// Stripe. A 503 (no STRIPE_SECRET_KEY yet) renders inline instead of dying.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useSession } from '@/lib/session'
import { PLANS, type PlanId } from '@/lib/plans'

export default function PricingPlans({ currentPlan }: { currentPlan?: PlanId }) {
  const router = useRouter()
  const { isConnected } = useAccount()
  const { connectAndSignIn } = useSession()
  const [busy, setBusy] = useState<PlanId | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const checkout = async (plan: PlanId) => {
    setBusy(plan)
    setNote(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (res.status === 401) {
        connectAndSignIn('/pricing')
        return
      }
      if (!res.ok || !data.url) {
        setNote(data.error ?? 'Checkout failed — try again in a minute.')
        return
      }
      window.location.href = data.url
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="pricing__grid">
        {PLANS.map((p) => {
          const isCurrent = currentPlan === p.id
          return (
            <article className={`pricing__card${p.popular ? ' pricing__card--pop' : ''}`} key={p.id}>
              {p.popular && <span className="pricing__pop mono">MOST POPULAR</span>}
              <h3 className="pricing__name">{p.name}</h3>
              <p className="pricing__tagline">{p.tagline}</p>
              <div className="pricing__price">
                <span className="pricing__amount">${p.priceUsd}</span>
                <span className="pricing__per mono">/ month</span>
              </div>
              <div className="pricing__credits mono">
                {p.credits.toLocaleString()} <span>YEET credits / mo</span>
              </div>
              <ul className="pricing__feats">
                {p.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              {isCurrent ? (
                <Link href="/dashboard/plan" className="btn btn--ghost pricing__cta">
                  Your current plan
                </Link>
              ) : p.priceUsd === 0 ? (
                <button
                  className="btn btn--ghost pricing__cta"
                  onClick={() => (isConnected ? router.push('/dashboard/plan') : connectAndSignIn('/dashboard/plan'))}
                >
                  Start free
                </button>
              ) : (
                <button
                  className={`btn ${p.popular ? 'btn--solid' : 'btn--ghost'} pricing__cta`}
                  disabled={busy !== null}
                  onClick={() => void checkout(p.id)}
                >
                  {busy === p.id ? 'Opening checkout…' : `Upgrade to ${p.name}`}
                </button>
              )}
            </article>
          )
        })}
      </div>
      {note && <p className="pricing__note mono">{note}</p>}
    </>
  )
}
