'use client'

import { useEffect, useRef, useState } from 'react'
import { TELEGRAM_PROMISE } from '@/lib/telegram/copy'
import './telegram.css'

// "Continue with Telegram" for a room page (squad community, lane TELEGRAM).
// Two doors, the same proof (Telegram's own signature):
//
//   · the link (always, once a bot is configured): opens the room's join
//     door in Telegram. Telegram proves the account; the visitor is joined
//     there and opens the room inside Telegram. Zero setup beyond the bot.
//   · the Login Widget (only when the deployment says the owner ran
//     BotFather's /setdomain): signs THIS browser tab in, then joins.
//
// Renders nothing while no bot is configured.

export interface TelegramJoinProps {
  slug: string
  /** The invite code the page was opened with. */
  via?: string | null
  /** Called after the widget signed this tab in and the join went through. Default: reload. */
  onSignedIn?: () => void
  size?: 'sm' | 'md'
}

interface Status {
  configured: boolean
  bot: string | null
  miniApp: boolean
  loginWidget: boolean
}

let statusOnce: Promise<Status | null> | null = null
/** One status read per page load, shared by every door on the page. */
export function readTelegramStatus(): Promise<Status | null> {
  statusOnce ??= fetch('/api/telegram/auth', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
    .catch(() => null)
  return statusOnce
}

type WidgetWindow = Window & { __ptTelegramAuth?: (user: Record<string, unknown>) => void }

function Plane() {
  // A plain paper plane: a glyph on our own button, not anybody's product dress.
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M3 11.5 21 4l-3.2 16-5.6-4.4L9 19v-4.6L18 7 7.4 13.3 3 11.5Z" fill="currentColor" />
    </svg>
  )
}

export default function TelegramJoin({ slug, via, onSignedIn, size = 'md' }: TelegramJoinProps) {
  const [status, setStatus] = useState<Status | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const slot = useRef<HTMLDivElement | null>(null)
  const done = useRef(onSignedIn)
  done.current = onSignedIn

  useEffect(() => {
    let alive = true
    void readTelegramStatus().then((s) => alive && setStatus(s))
    return () => {
      alive = false
    }
  }, [])

  const widget = !!status?.configured && status.loginWidget && !!status.bot
  const bot = status?.bot ?? null

  useEffect(() => {
    const host = slot.current
    if (!widget || !bot || !host) return
    const w = window as WidgetWindow
    w.__ptTelegramAuth = (user) => {
      void (async () => {
        try {
          // Telegram's signed fields, posted exactly as given. The server verifies them; this page trusts none of it.
          const res = await fetch('/api/telegram/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(user) })
          if (!res.ok) {
            const j = (await res.json().catch(() => null)) as { error?: string } | null
            return setNote(j?.error ?? 'Telegram sign-in did not go through. Try again.')
          }
          await fetch(`/api/communities/${slug}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ via: via ?? null }) }).catch(() => null)
          if (done.current) done.current()
          else window.location.reload()
        } catch {
          setNote('Telegram sign-in did not go through. Try again.')
        }
      })()
    }
    const s = document.createElement('script')
    s.src = 'https://telegram.org/js/telegram-widget.js?22'
    s.async = true
    s.setAttribute('data-telegram-login', bot)
    s.setAttribute('data-size', size === 'sm' ? 'medium' : 'large')
    s.setAttribute('data-radius', '10')
    s.setAttribute('data-onauth', '__ptTelegramAuth(user)')
    host.replaceChildren(s)
    return () => {
      host.replaceChildren()
      delete w.__ptTelegramAuth
    }
  }, [widget, bot, slug, via, size])

  if (!status?.configured) return null
  const href = `/api/telegram/auth?start=${encodeURIComponent(slug)}${via ? `&via=${encodeURIComponent(via)}` : ''}`

  return (
    <div className={`tgjoin tgjoin--${size}`}>
      {widget && <div ref={slot} className="tgjoin__widget" />}
      <a className="tgjoin__btn" href={href} target="_blank" rel="noopener noreferrer">
        <Plane />
        <span>{widget ? 'Or open it in Telegram' : 'Continue with Telegram'}</span>
      </a>
      <p className="tgjoin__hint">{TELEGRAM_PROMISE}</p>
      {note && (
        <p className="tgjoin__note" role="alert">
          {note}
        </p>
      )}
    </div>
  )
}
