'use client'

// Landing-page "stay up to date" signup. Posts to /api/subscribe (double
// opt-in); reads ?subscribed=1|invalid from the confirm-link redirect to show
// a confirmation inline.

import { useEffect, useState } from 'react'

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
    <section className="mt-3 rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-6 sm:p-8 text-center">
      <div className="max-w-md mx-auto">
        <h2 className="text-xl font-semibold text-white mb-1">Stay up to date</h2>
        <p className="text-sm text-[color:var(--muted)] mb-4">
          Occasional updates on agent expense accounts and new x402 services. No spam.
        </p>

        {state === 'done' ? (
          <p className="text-sm text-emerald-400 mono" role="status">
            {msg}
          </p>
        ) : (
          <form className="flex flex-col sm:flex-row sm:items-stretch gap-2.5 max-w-sm mx-auto" onSubmit={submit}>
            <input
              type="email"
              required
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 min-w-0 rounded-lg border border-[var(--line)] bg-black/30 px-4 py-3 text-sm text-white placeholder:text-[color:var(--muted-2)] outline-none focus:border-[var(--accent,#34E0A1)] mono"
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
        )}
        {state === 'error' && (
          <p className="text-xs text-amber-400 mono mt-2" role="alert">
            {msg}
          </p>
        )}
      </div>
    </section>
  )
}
