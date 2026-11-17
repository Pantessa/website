'use client'

// The room's Discord settings (lane DISCORD). Mounted by GROUP on /g/<slug>.
// Everyone sees which Discord channels hear this room; a manager can paste a
// channel webhook (works with no bot) or, once the Pantessa app exists, invite
// the bot and run `/pantessa link <code>`. Errors are the API's own words.

import { useCallback, useEffect, useState } from 'react'
import './discord.css'

interface State {
  configured: { webhooks: boolean; app: boolean }
  channels: { title: string | null; webhook: boolean }[]
}

export default function DiscordPanel({ slug, canManage }: { slug: string; canManage: boolean }) {
  const base = `/api/communities/${encodeURIComponent(slug)}/discord`
  const [state, setState] = useState<State | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [code, setCode] = useState<{ command: string; inviteUrl: string; expiresAt: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(base, { cache: 'no-store' })
      if (r.ok) setState((await r.json()) as State)
    } catch {
      /* the panel stays on its last read */
    }
  }, [base])
  useEffect(() => {
    void load()
  }, [load])

  const send = async (method: 'POST' | 'DELETE', body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(base, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
      if (!r.ok) {
        setError(typeof j.error === 'string' ? j.error : `That did not work (${r.status}).`)
        return null
      }
      return j
    } catch {
      setError('Could not reach Pantessa. Check your connection.')
      return null
    } finally {
      setBusy(false)
    }
  }

  const connect = async () => {
    setDone(null)
    const j = await send('POST', { webhookUrl: url.trim() })
    if (j) {
      setUrl('')
      setDone(`Connected. New posts in this room will post as "${String(j.title ?? 'the webhook')}" in its Discord channel.`)
      void load()
    }
  }
  const unlink = async (title: string | null) => {
    setDone(null)
    const j = await send('DELETE', title ? { title } : {})
    if (j) {
      setDone('Unlinked. That channel will not hear new posts.')
      void load()
    }
  }
  const mint = async () => {
    const j = await send('POST', { mintCode: true })
    if (j && typeof j.command === 'string' && typeof j.inviteUrl === 'string') setCode({ command: j.command, inviteUrl: j.inviteUrl, expiresAt: Number(j.expiresAt) })
  }

  const channels = state?.channels ?? []
  if (!canManage && channels.length === 0) return null

  return (
    <section className="dcp" aria-label="Discord">
      <div className="dcp__head">
        <span className="dcp__eyebrow">Discord</span>
        {channels.length > 0 && <span className="dcp__count">{channels.length === 1 ? '1 channel' : `${channels.length} channels`}</span>}
      </div>

      {channels.length > 0 ? (
        <ul className="dcp__list">
          {channels.map((c, k) => (
            <li key={`${c.title ?? 'untitled'}-${k}`} className="dcp__row">
              <span className="dcp__title">{c.title ?? 'A Discord channel'}</span>
              <span className="dcp__how">{c.webhook ? 'webhook' : 'bot'}</span>
              {canManage && (
                <button type="button" className="dcp__ghost" disabled={busy} onClick={() => void unlink(c.title)}>
                  Unlink
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="dcp__note">No Discord channel hears this room yet.</p>
      )}

      {canManage && (
        <div className="dcp__manage">
          <ol className="dcp__steps">
            <li>In Discord, open the channel: Edit Channel, then Integrations, then Webhooks.</li>
            <li>New Webhook. Name it after the channel, then Copy Webhook URL.</li>
            <li>Paste it here. New posts in this room will appear there.</li>
          </ol>
          <div className="dcp__form">
            <input
              className="dcp__input"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://discord.com/api/webhooks/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label="Discord webhook URL"
            />
            <button type="button" className="dcp__cta" disabled={busy || !url.trim()} onClick={() => void connect()}>
              {busy ? 'Checking…' : 'Connect'}
            </button>
          </div>
          <p className="dcp__note">Pantessa checks the URL with Discord, keeps it private, and never shows it again.</p>

          {state?.configured.app && (
            <div className="dcp__bot">
              <p className="dcp__note">Or add the Pantessa bot. It also answers slash commands like /pantessa chart ETH.</p>
              {code ? (
                <>
                  <a className="dcp__ghost" href={code.inviteUrl} target="_blank" rel="noopener noreferrer">
                    Add the bot to your server
                  </a>
                  <p className="dcp__note">
                    Then run this in the channel within 15 minutes: <code className="dcp__code">{code.command}</code>
                  </p>
                </>
              ) : (
                <button type="button" className="dcp__ghost" disabled={busy} onClick={() => void mint()}>
                  Get a link code
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="dcp__err" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="dcp__ok" role="status">
          {done}
        </p>
      )}
    </section>
  )
}
