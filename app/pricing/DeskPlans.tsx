'use client'

// /pricing · THE DESK (squad five-million, 2026-11-03) — the four desk tiers
// and their checkout. The page (a server component) computes every number
// from lib/plans + lib/tenant/spec and hands it down; this island owns only
// the month/year switch and the checkout door, which is the same one Plus
// uses: POST /api/billing/checkout → Stripe; a 401 opens the unified sign-in
// door and comes back here to resume the exact purchase; a 409 (this wallet
// already holds a plan) or a 503 (no Stripe on this deployment) prints under
// the cards instead of dying.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/session'
import CreateAccountButton from '@/components/CreateAccountButton'
import { cdpEnabled } from '@/lib/cdp-embedded'
import type { BillingInterval } from '@/lib/plans'
import './desk-pricing.css'

export interface DeskTierView {
  id: 'free' | 'agent' | 'desk' | 'enterprise'
  name: string
  tagline: string
  /** "Everything in <inherits>, plus" — null on the first tier. */
  inherits: string | null
  /** The lines this tier adds over the one below. */
  adds: { text: string; soon?: boolean }[]
  /** Agent/Desk: whole USD per month and per year. */
  price: { month: number; year: number | null } | null
}
export interface EnterpriseView {
  platformUsd: string
  tiers: string[]
  partner: string
  example: string
}

type Buyable = 'agent' | 'desk'
const resumeHref = (plan: Buyable, interval: BillingInterval) => `/pricing?checkout=${plan}&interval=${interval}`

export default function DeskPlans({ tiers, enterprise }: { tiers: DeskTierView[]; enterprise: EnterpriseView }) {
  const router = useRouter()
  const { address: sessionAddress, connectAndSignIn } = useSession()
  const [interval, setBillingInterval] = useState<BillingInterval>('month')
  const [busy, setBusy] = useState<Buyable | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const signedIn = !!sessionAddress

  const checkout = async (plan: Buyable, iv: BillingInterval) => {
    setBusy(plan)
    setNote(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval: iv }),
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (res.status === 401) {
        connectAndSignIn(resumeHref(plan, iv))
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

  // Resume after the sign-in door returns (the purchase rides in the URL so it
  // survives the full-page OAuth bounce); the param is stripped so a refresh
  // can never re-fire it. PricingPlans resumes Plus and the pack; this one
  // resumes only the desk plans, so the two never both fire.
  const resumedRef = useRef(false)
  useEffect(() => {
    if (resumedRef.current || !signedIn) return
    const q = new URLSearchParams(window.location.search)
    const wanted = q.get('checkout')
    if (wanted !== 'agent' && wanted !== 'desk') return
    if (!tiers.some((t) => t.id === wanted && t.price)) return
    resumedRef.current = true
    const iv: BillingInterval = q.get('interval') === 'year' ? 'year' : 'month'
    setBillingInterval(iv)
    router.replace('/pricing#desk')
    void checkout(wanted, iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  const buyButton = (plan: Buyable, label: string) =>
    !signedIn && cdpEnabled ? (
      <CreateAccountButton className="btn btn--solid pricing__cta" label={label} redirectTo={resumeHref(plan, interval)} />
    ) : (
      <button className="btn btn--solid pricing__cta" disabled={busy !== null} onClick={() => void checkout(plan, interval)}>
        {busy === plan ? 'Opening checkout…' : label}
      </button>
    )

  return (
    <>
      <div className="deskprice__bar">
        <div className="pricing__toggle mono" role="group" aria-label="Desk plan billing interval">
          {(['month', 'year'] as const).map((iv) => (
            <button key={iv} type="button" aria-pressed={interval === iv} className={interval === iv ? 'is-on' : ''} onClick={() => setBillingInterval(iv)}>
              {iv === 'month' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
      </div>
      <div className="deskprice__grid">
        {tiers.map((t) => {
          const yearly = interval === 'year' && !!t.price?.year
          const charge = t.price ? (yearly ? (t.price.year as number) : t.price.month) : 0
          return (
            <article className="pricing__card deskprice__card" key={t.id} data-desk-tier={t.id}>
              <h3 className="pricing__name">{t.name}</h3>
              <p className="pricing__tagline">{t.tagline}</p>
              <div className="pricing__price deskprice__price">
                {t.id === 'enterprise' ? (
                  <>
                    <span className="pricing__amount">{enterprise.platformUsd}</span>
                    <span className="pricing__per mono">/ month</span>
                  </>
                ) : t.price ? (
                  <>
                    <span className="pricing__amount">{`$${charge.toLocaleString('en-US')}`}</span>
                    <span className="pricing__per mono">{yearly ? '/ year' : '/ month'}</span>
                    {yearly ? <span className="pricing__save mono">{`saves $${(t.price.month * 12 - charge).toLocaleString('en-US')}`}</span> : null}
                  </>
                ) : (
                  <>
                    <span className="pricing__amount">$0</span>
                    <span className="pricing__per mono">sandbox</span>
                  </>
                )}
              </div>
              {t.id === 'enterprise' && (
                <div className="deskprice__terms">
                  <p className="deskprice__termshead">Plus execution, per month, on receipt-verified notional</p>
                  <ul className="deskprice__tiers mono">
                    {enterprise.tiers.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className="deskprice__partner">{enterprise.partner}</p>
                </div>
              )}
              {t.inherits ? <p className="deskprice__inherits">{`Everything in ${t.inherits}, plus:`}</p> : null}
              <ul className="pricing__feats">
                {t.adds.map((f) => (
                  <li key={f.text} className={f.soon ? 'deskprice__soon' : undefined}>
                    {f.text}
                    {f.soon ? <span className="deskprice__soontag mono">coming</span> : null}
                  </li>
                ))}
              </ul>
              {t.id === 'agent' || t.id === 'desk' ? (
                buyButton(t.id, `Get ${t.name}`)
              ) : t.id === 'enterprise' ? (
                <Link href="/desk" className="btn btn--ghost pricing__cta">
                  Request a pilot
                </Link>
              ) : (
                <Link href="/docs/desk" className="btn btn--ghost pricing__cta">
                  Start in the sandbox
                </Link>
              )}
            </article>
          )
        })}
      </div>
      {note && <p className="pricing__note mono">{note}</p>}
      <p className="pricing__fine deskprice__fine">{enterprise.example}</p>
    </>
  )
}
