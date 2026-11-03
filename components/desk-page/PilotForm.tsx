'use client'

import { useState, type FormEvent } from 'react'

// The pilot-request door on /desk (squad five-million, DESKPAGE lane,
// 2026-11-03). Six fields, one POST to /api/desk/pilot, one sentence back:
// "We answer within a day." No wallet, no cookie, nothing stored in the
// browser. The `website` field is a honeypot: hidden from people, filled by
// bots, and the route drops a filled one silently.

export const CUSTODY_OPTIONS = [
  { v: 'fireblocks', label: 'Fireblocks' },
  { v: 'copper', label: 'Copper' },
  { v: 'fordefi', label: 'Fordefi' },
  { v: 'safe', label: 'Safe' },
  { v: 'other', label: 'Other / in-house' },
] as const

export const PILOT_DONE_LINE = 'Thank you. We answer within a day.'

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done' } | { kind: 'error'; message: string }

export default function PilotForm() {
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (state.kind === 'sending') return
    const form = e.currentTarget
    const fd = new FormData(form)
    const body = {
      name: String(fd.get('name') ?? ''),
      firm: String(fd.get('firm') ?? ''),
      email: String(fd.get('email') ?? ''),
      custody: String(fd.get('custody') ?? ''),
      venues: String(fd.get('venues') ?? ''),
      trades: String(fd.get('trades') ?? ''),
      website: String(fd.get('website') ?? ''),
    }
    setState({ kind: 'sending' })
    try {
      const r = await fetch('/api/desk/pilot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (r.ok && j.ok) {
        setState({ kind: 'done' })
        form.reset()
      } else {
        setState({ kind: 'error', message: j.error ?? `That did not go through (${r.status}). Try again, or write to hello@pantessa.com.` })
      }
    } catch {
      setState({ kind: 'error', message: 'That did not go through. Try again, or write to hello@pantessa.com.' })
    }
  }

  if (state.kind === 'done') {
    return (
      <div className="dk__form" data-pilot="done">
        <p className="dk__done dk__field--wide" role="status">
          {PILOT_DONE_LINE} A person reads every request; the first reply names a day for a working session against your custody on a testnet.
        </p>
      </div>
    )
  }

  return (
    <form className="dk__form" onSubmit={submit} data-pilot="form" noValidate>
      <label className="dk__field">
        <span className="dk__label">Your name</span>
        <input className="dk__input" name="name" type="text" autoComplete="name" maxLength={120} required placeholder="Jordan Lee" />
      </label>
      <label className="dk__field">
        <span className="dk__label">Firm</span>
        <input className="dk__input" name="firm" type="text" autoComplete="organization" maxLength={160} required placeholder="Example Capital" />
      </label>
      <label className="dk__field">
        <span className="dk__label">Work email</span>
        <input className="dk__input" name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} required placeholder="jordan@example.com" />
      </label>
      <label className="dk__field">
        <span className="dk__label">Custody</span>
        <select className="dk__input" name="custody" defaultValue="" required>
          <option value="" disabled>
            Choose one
          </option>
          {CUSTODY_OPTIONS.map((o) => (
            <option key={o.v} value={o.v}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="dk__field dk__field--wide">
        <span className="dk__label">Venues you need</span>
        <input className="dk__input" name="venues" type="text" maxLength={500} placeholder="CoW + Uniswap v3 on Ethereum and Base, Aave v4 supply" />
      </label>
      <label className="dk__field dk__field--wide">
        <span className="dk__label">What you trade</span>
        <textarea className="dk__input" name="trades" maxLength={2000} placeholder="Spot majors against USDC, some wstETH; sizes to $5M an order; two approvers over $1M." />
      </label>
      {/* Honeypot — not for people. */}
      <label className="dk__hp" aria-hidden="true">
        Website
        <input name="website" type="text" tabIndex={-1} autoComplete="off" />
      </label>
      <div className="dk__submit">
        <button className="dk__btn dk__btn--solid" type="submit" disabled={state.kind === 'sending'}>
          {state.kind === 'sending' ? 'Sending…' : 'Request a pilot'}
        </button>
        {state.kind === 'error' && (
          <span className="dk__err" role="alert">
            {state.message}
          </span>
        )}
      </div>
      <p className="dk__formnote">
        Lands with a person at hello@pantessa.com. Nothing here touches a wallet; we keep your name, firm and email to answer you, and nothing else.
      </p>
    </form>
  )
}
