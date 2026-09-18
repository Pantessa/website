'use client'

// The /pricing cards + checkout wiring (pricing v2). Two plans — Free and
// Plus (monthly or yearly) — and the three other ways to get house answers:
// trading (earned), your own API key (free), a one-time pack. Checkout is
// POST /api/billing/checkout → Stripe; a 401 opens the unified sign-in door
// and returns here to resume the exact purchase; a 503 (no Stripe key on
// this deployment) renders inline instead of dying.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useSession } from '@/lib/session'
import CreateAccountButton from '@/components/CreateAccountButton'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { ANSWER_PACK, LISTED_PLANS, planChargeUsd, type BillingInterval, type PlanId } from '@/lib/plans'
import { AI_KEY_HREF, EARN_PER_100_USD } from '@/lib/answer-gate-copy'

type Purchase = { kind: 'plan'; plan: PlanId; interval: BillingInterval } | { kind: 'pack' }

const resumeHref = (p: Purchase) =>
  p.kind === 'pack' ? '/pricing?checkout=pack' : `/pricing?checkout=${p.plan}&interval=${p.interval}`

export default function PricingPlans({ currentPlan }: { currentPlan?: PlanId }) {
  const router = useRouter()
  const { isConnected } = useAccount()
  const { address: sessionAddress, connectAndSignIn } = useSession()
  const [interval, setBillingInterval] = useState<BillingInterval>('month')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const signedIn = !!sessionAddress

  const checkout = async (p: Purchase) => {
    setBusy(p.kind === 'pack' ? 'pack' : p.plan)
    setNote(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p.kind === 'pack' ? { pack: true } : { plan: p.plan, interval: p.interval }),
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (res.status === 401) {
        // No account yet — the unified sign-in door, returning here to resume
        // this exact purchase.
        connectAndSignIn(resumeHref(p))
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

  // Resume after the sign-in door returns. The purchase rides in the URL so it
  // survives connect → sign → redirect (including the full-page OAuth bounce);
  // the param is stripped so a refresh can never re-fire it.
  const resumedRef = useRef(false)
  useEffect(() => {
    if (resumedRef.current || !signedIn) return
    const q = new URLSearchParams(window.location.search)
    const wanted = q.get('checkout')
    if (!wanted) return
    let purchase: Purchase | null = null
    if (wanted === 'pack') purchase = { kind: 'pack' }
    else {
      const plan = LISTED_PLANS.find((p) => p.id === wanted && p.priceUsd > 0)
      if (plan) purchase = { kind: 'plan', plan: plan.id, interval: q.get('interval') === 'year' ? 'year' : 'month' }
    }
    if (!purchase) return
    resumedRef.current = true
    router.replace('/pricing')
    void checkout(purchase)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  const buyButton = (p: Purchase, label: string, solid: boolean, busyKey: string) =>
    !signedIn && cdpEnabled ? (
      <CreateAccountButton className={`btn ${solid ? 'btn--solid' : 'btn--ghost'} pricing__cta`} label={label} redirectTo={resumeHref(p)} />
    ) : (
      <button className={`btn ${solid ? 'btn--solid' : 'btn--ghost'} pricing__cta`} disabled={busy !== null} onClick={() => void checkout(p)}>
        {busy === busyKey ? 'Opening checkout…' : label}
      </button>
    )

  return (
    <>
      <div className="pricing__grid pricing__grid--two">
        {LISTED_PLANS.map((p) => {
          const isCurrent = currentPlan === p.id
          const paid = p.priceUsd > 0
          const charge = planChargeUsd(p, interval)
          const yearly = paid && interval === 'year' && !!p.yearlyUsd
          return (
            <article className={`pricing__card${p.popular ? ' pricing__card--pop' : ''}`} key={p.id}>
              <div className="pricing__cardtop">
                <div>
                  <h3 className="pricing__name">{p.name}</h3>
                  <p className="pricing__tagline">{p.tagline}</p>
                </div>
                {paid && p.yearlyUsd ? (
                  <div className="pricing__toggle mono" role="group" aria-label="Billing interval">
                    {(['month', 'year'] as const).map((iv) => (
                      <button key={iv} type="button" aria-pressed={interval === iv} className={interval === iv ? 'is-on' : ''} onClick={() => setBillingInterval(iv)}>
                        {iv === 'month' ? 'Monthly' : 'Yearly'}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="pricing__price">
                <span className="pricing__amount">${charge}</span>
                <span className="pricing__per mono">{paid ? (yearly ? '/ year' : '/ month') : 'forever'}</span>
                {yearly ? <span className="pricing__save mono">saves ${p.priceUsd * 12 - charge}</span> : null}
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
              ) : !paid ? (
                <button className="btn btn--ghost pricing__cta" onClick={() => (isConnected ? router.push('/markets') : connectAndSignIn('/markets'))}>
                  Start free
                </button>
              ) : (
                buyButton({ kind: 'plan', plan: p.id, interval }, `Get ${p.name}`, true, p.id)
              )}
            </article>
          )
        })}
      </div>

      <h2 className="pricing__h2">Three more ways to keep asking</h2>
      <div className="pricing__more">
        <article className="pricing__way">
          <span className="pricing__waytag mono">EARNED · $0</span>
          <h3 className="pricing__wayname">Trade, and the chat refills</h3>
          <p className="pricing__waybody">
            Every swap you sign banks answers from the fee it paid — {EARN_PER_100_USD} for every $100. They never expire.
          </p>
          <Link href="/markets" className="btn btn--ghost pricing__cta">
            Open Markets
          </Link>
        </article>
        <article className="pricing__way">
          <span className="pricing__waytag mono">YOUR KEY · $0</span>
          <h3 className="pricing__wayname">Bring your own API key</h3>
          <p className="pricing__waybody">
            Paste an Anthropic key and every answer runs on it: unlimited, at your cost, with everything in Plus unlocked.
          </p>
          <Link href={AI_KEY_HREF} className="btn btn--ghost pricing__cta">
            Add your key
          </Link>
        </article>
        <article className="pricing__way">
          <span className="pricing__waytag mono">ONE-TIME · ${ANSWER_PACK.priceUsd}</span>
          <h3 className="pricing__wayname">{ANSWER_PACK.answers.toLocaleString('en-US')} answers</h3>
          <p className="pricing__waybody">No subscription. They sit in your account until you use them, however long that takes.</p>
          {buyButton({ kind: 'pack' }, `Buy for $${ANSWER_PACK.priceUsd}`, false, 'pack')}
        </article>
      </div>
      {note && <p className="pricing__note mono">{note}</p>}
    </>
  )
}
