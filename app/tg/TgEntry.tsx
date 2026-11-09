'use client'

import { useEffect, useRef, useState } from 'react'
import { parseJoinPayload } from '@/lib/community/spec'
import { OUTSIDE_LINE } from '@/lib/telegram/copy'

// The Mini App entry's one job, in order:
//   1. load Telegram's own script (this route only) and read `initData`,
//      the launch data Telegram signed for this user and this bot
//   2. POST it to /api/telegram/auth, which VERIFIES the signature and sets
//      the identity cookie (the page never trusts initDataUnsafe for who
//      the user is; it reads only the room payload from it)
//   3. join the room the payload names (idempotent), then land on /g/<slug>
// Outside Telegram there is no initData: say so, offer the room and the bot.

const TG_SCRIPT = 'https://telegram.org/js/telegram-web-app.js'
const SCRIPT_WAIT_MS = 4_000

interface TelegramWebApp {
  initData?: string
  initDataUnsafe?: { start_param?: string }
  ready?: () => void
  expand?: () => void
}
type TgWindow = Window & { Telegram?: { WebApp?: TelegramWebApp } }

type State = { s: 'checking' } | { s: 'outside' } | { s: 'working'; line: string } | { s: 'error'; line: string }

function payloadFromUrl(): string | null {
  const q = new URLSearchParams(window.location.search)
  return q.get('startapp') ?? q.get('tgWebAppStartParam')
}

function loadTelegram(): Promise<TelegramWebApp | null> {
  const w = window as TgWindow
  if (w.Telegram?.WebApp) return Promise.resolve(w.Telegram.WebApp)
  return new Promise((resolve) => {
    const s = document.createElement('script')
    const timer = window.setTimeout(() => resolve(null), SCRIPT_WAIT_MS)
    s.src = TG_SCRIPT
    s.async = true
    s.onload = () => {
      window.clearTimeout(timer)
      resolve((window as TgWindow).Telegram?.WebApp ?? null)
    }
    s.onerror = () => {
      window.clearTimeout(timer)
      resolve(null)
    }
    document.head.appendChild(s)
  })
}

interface SignedIn {
  startParam?: unknown
  error?: unknown
}

/** Hand Telegram's signed launch data to the server. It verifies; the page believes only the answer. */
async function signIn(initData: string): Promise<{ status: number; signed: SignedIn | null }> {
  try {
    const res = await fetch('/api/telegram/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ initData }) })
    return { status: res.status, signed: (await res.json().catch(() => null)) as SignedIn | null }
  } catch {
    return { status: 0, signed: null }
  }
}

export default function TgEntry() {
  const [state, setState] = useState<State>({ s: 'checking' })
  const [target, setTarget] = useState<{ slug: string; invite: string | null } | null>(null)
  const [bot, setBot] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const urlTarget = parseJoinPayload(payloadFromUrl())
    setTarget(urlTarget)

    const outside = () => {
      setState({ s: 'outside' })
      fetch('/api/telegram/auth', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { bot?: unknown } | null) => setBot(typeof j?.bot === 'string' ? j.bot : null))
        .catch(() => {})
    }

    void (async () => {
      const app = await loadTelegram()
      const initData = app?.initData
      if (!app || !initData) return outside()
      try {
        app.ready?.()
        app.expand?.()
      } catch {
        // An old client without these is still a signed launch.
      }
      setState({ s: 'working', line: 'Signing you in with Telegram.' })
      const { status, signed } = await signIn(initData)
      if (status !== 200 || !signed) {
        return setState({ s: 'error', line: typeof signed?.error === 'string' ? signed.error : 'Could not reach Pantessa. Close this and tap the button again.' })
      }
      // The SIGNED start parameter first (a direct link), then our own button's query.
      const dest = parseJoinPayload(signed.startParam) ?? parseJoinPayload(app.initDataUnsafe?.start_param) ?? urlTarget
      if (!dest) return window.location.replace('/community')
      setTarget(dest)
      setState({ s: 'working', line: 'Joining the room.' })
      try {
        const res = await fetch(`/api/communities/${dest.slug}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ via: dest.invite }) })
        if (res.status === 404) return setState({ s: 'error', line: 'That room does not exist on Pantessa.' })
      } catch {
        // The room page has its own join button: land there either way.
      }
      window.location.replace(`/g/${dest.slug}`)
    })()
  }, [])

  const roomHref = target ? `/g/${target.slug}${target.invite ? `?via=${encodeURIComponent(target.invite)}` : ''}` : '/community'
  const botHref = bot ? `https://t.me/${bot}` : null

  return (
    <main className="tgentry" data-tg-state={state.s}>
      <div className="tgentry__card">
        <p className="tgentry__brand">pantessa</p>
        {state.s === 'checking' && <p className="tgentry__line" role="status">Opening Pantessa.</p>}
        {state.s === 'working' && <p className="tgentry__line" role="status">{state.line}</p>}
        {state.s === 'error' && <p className="tgentry__line tgentry__line--error" role="alert">{state.line}</p>}
        <div className="tgentry__outside" hidden={state.s !== 'outside' && state.s !== 'error'}>
          {state.s !== 'error' && <p className="tgentry__line">{OUTSIDE_LINE}</p>}
          <p className="tgentry__links">
            <a href={roomHref}>{target ? 'Open the room' : 'See the rooms'}</a>
            {botHref && (
              <a href={botHref} target="_blank" rel="noopener noreferrer">
                Open the bot in Telegram
              </a>
            )}
          </p>
        </div>
        <noscript>
          <p className="tgentry__line">{OUTSIDE_LINE}</p>
        </noscript>
      </div>
    </main>
  )
}
