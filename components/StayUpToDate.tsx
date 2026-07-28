'use client'

// The closing band — "stay up to date", but as the page's last statement
// rather than a grey box bolted to the bottom. It names what actually lands
// in the inbox (the same three things the old sub-line listed, now legible as
// a list) and carries the page's accent glow so the ending reads like an
// ending. Shared with /pricing, which gets the same treatment.
//
// Posts to /api/subscribe (double opt-in); reads ?subscribed=1|invalid from
// the confirm-link redirect to show a confirmation inline.

import { useEffect, useState } from 'react'

/** What you're actually signing up for. Vague newsletters get ignored;
 *  naming the three things is the whole pitch. */
const GETS: { k: string; d: string }[] = [
  { k: 'NEW DAPPS', d: 'when a protocol becomes one sentence away' },
  { k: 'STANDING WORK', d: 'schedules, guards and jobs that run between turns' },
  { k: 'NEW SIGNATURES', d: 'what the agent can build and sign that it couldn’t last month' },
]

type State = 'idle' | 'loading' | 'done' | 'error'

export default function StayUpToDate() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>('idle')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('subscribed')
    if (s === '1') {
      setState('done')
      setMsg("Email confirmed — you're on the list. 🎉")
    } else if (s === 'invalid') {
      setState('error')
      setMsg('That confirmation link is invalid or expired. Try signing up again.')
    }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (state === 'loading') return
    setState('loading')
    try {
      const r = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await r.json().catch(() => ({}) as Record<string, unknown>)
      if (!r.ok) {
        setState('error')
        setMsg(typeof data.error === 'string' ? data.error : 'Something went wrong — try again.')
        return
      }
      setState('done')
      setMsg(
        data.already
          ? "You're already subscribed. 👍"
          : data.emailSent
            ? 'Almost there — check your inbox to confirm. 📬'
            : "You're on the list.",
      )
    } catch {
      setState('error')
      setMsg('Network error — try again.')
    }
  }

  return (
    <section className="sud">
      <div className="sud__copy">
        <span className="sud__eyebrow mono">THE LIST</span>
        <h2 className="sud__h2">Stay up to date.</h2>
        <p className="sud__sub">
          The agent can sign things this month it couldn&rsquo;t sign last month. That&rsquo;s the
          only thing this list is for.
        </p>
        <dl className="sud__gets">
          {GETS.map((g) => (
            <div key={g.k}>
              <dt className="mono">{g.k}</dt>
              <dd>{g.d}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="sud__form">
        {state === 'done' ? (
          <p className="sud__done mono" role="status">
            {msg}
          </p>
        ) : (
          <>
            <form className="sud__row" onSubmit={submit}>
              <input
                type="email"
                required
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="sud__input mono"
                aria-label="Email address"
                disabled={state === 'loading'}
              />
              <button
                type="submit"
                className="btn btn--solid flex-shrink-0"
                disabled={state === 'loading' || !email}
              >
                {state === 'loading' ? 'Sending…' : 'Notify me'}
              </button>
            </form>
            <p className="sud__fine mono">
              Double opt-in · no spam · unsubscribe from any email
            </p>
          </>
        )}
        {state === 'error' && (
          <p className="sud__err mono" role="alert">
            {msg}
          </p>
        )}
      </div>
    </section>
  )
}
