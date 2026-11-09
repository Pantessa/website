'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import './telegram.css'

// The room's Telegram settings (squad community, lane TELEGRAM). Lane GROUP
// mounts it on the room page: <TelegramPanel slug canManage />.
//
// For the owner / a mod it is the whole "bring my group in" flow:
//   Connect Telegram → Add to your group (Telegram's own group picker) → done.
// The bot checks with Telegram that whoever adds it administers the group,
// links the chat, posts the join button and pins it. The panel watches for
// the link and flips to "Linked" on its own.
//
// Anyone else sees nothing: a linked chat is already listed on the room
// (PublicCommunity.channels), and the join door is the room's own button.
// With no bot configured the owner reads one honest line and nobody else
// reads anything.

export interface TelegramPanelProps {
  slug: string
  canManage: boolean
}

interface RoomTelegram {
  configured: boolean
  bot: string | null
  miniApp: boolean
  joinUrl: string | null
  channels: { title: string | null }[]
}

interface Minted {
  code: string
  expiresAt: number
  addToGroupUrl: string
  addAsAdminUrl: string
  linkCommand: string
}

const POLL_MS = 4_000

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

export default function TelegramPanel({ slug, canManage }: TelegramPanelProps) {
  const [room, setRoom] = useState<RoomTelegram | null>(null)
  const [minted, setMinted] = useState<Minted | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const alive = useRef(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/communities/${slug}/telegram`, { cache: 'no-store' })
      const j = res.ok ? await readJson<RoomTelegram>(res) : null
      if (alive.current && j) setRoom(j)
    } catch {
      // The panel keeps what it last knew.
    }
  }, [slug])

  useEffect(() => {
    alive.current = true
    if (canManage) void load()
    return () => {
      alive.current = false
    }
  }, [canManage, load])

  const linked = (room?.channels.length ?? 0) > 0

  // While a code is out, watch for the group to appear. Stops when it does, when the code dies, or when the tab hides.
  useEffect(() => {
    if (!minted || linked) return
    const timer = window.setInterval(() => {
      if (Date.now() > minted.expiresAt) {
        setMinted(null)
        setNote('That code expired. Press Connect Telegram for a fresh one.')
        return
      }
      if (!document.hidden) void load()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [minted, linked, load])

  useEffect(() => {
    if (linked && minted) {
      setMinted(null)
      setNote(null)
    }
  }, [linked, minted])

  if (!canManage || !room) return null

  const connect = async () => {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch(`/api/communities/${slug}/telegram`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await readJson<Minted & { error?: string }>(res)
      if (res.ok && j?.code) setMinted(j)
      else setNote(j?.error ?? 'Could not start the link. Try again.')
    } catch {
      setNote('Could not start the link. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const unlink = async () => {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch(`/api/communities/${slug}/telegram`, { method: 'DELETE' })
      if (!res.ok) setNote((await readJson<{ error?: string }>(res))?.error ?? 'Could not unlink. Try again.')
      setConfirmUnlink(false)
      await load()
    } catch {
      setNote('Could not unlink. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (what: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(what)
      window.setTimeout(() => alive.current && setCopied(null), 1600)
    } catch {
      setNote('Copy did not work here. Select the text and copy it by hand.')
    }
  }

  return (
    <section className="tgpanel" aria-label="Telegram">
      <header className="tgpanel__head">
        <h3 className="tgpanel__title">Telegram</h3>
        {linked && <span className="tgpanel__state">Linked</span>}
      </header>

      {!room.configured && <p className="tgpanel__muted">Telegram is not set up on this deployment yet. Nothing to connect.</p>}

      {room.configured && linked && (
        <>
          <ul className="tgpanel__chats">
            {room.channels.map((c, i) => (
              <li key={i}>{c.title ?? 'A Telegram group'}</li>
            ))}
          </ul>
          <p className="tgpanel__muted">New posts are announced there. Members join from the pinned button in one tap.</p>
          {room.joinUrl && (
            <p className="tgpanel__row">
              <code className="tgpanel__code">{room.joinUrl}</code>
              <button type="button" className="tgpanel__btn" onClick={() => copy('join', room.joinUrl ?? '')}>
                {copied === 'join' ? 'Copied' : 'Copy join link'}
              </button>
            </p>
          )}
          {confirmUnlink ? (
            <p className="tgpanel__row">
              <span className="tgpanel__muted">Unlink this group? Posts stop being announced there.</span>
              <button type="button" className="tgpanel__btn tgpanel__btn--danger" disabled={busy} onClick={unlink}>
                Unlink
              </button>
              <button type="button" className="tgpanel__btn" disabled={busy} onClick={() => setConfirmUnlink(false)}>
                Keep it
              </button>
            </p>
          ) : (
            <button type="button" className="tgpanel__link" onClick={() => setConfirmUnlink(true)}>
              Unlink the group
            </button>
          )}
        </>
      )}

      {room.configured && !linked && !minted && (
        <>
          <p className="tgpanel__muted">Bring your Telegram group in. The bot posts a join button, every member is one tap from joined, and new posts are announced in the group.</p>
          <button type="button" className="tgpanel__btn tgpanel__btn--primary" disabled={busy} onClick={connect}>
            Connect Telegram
          </button>
        </>
      )}

      {room.configured && !linked && minted && (
        <ol className="tgpanel__steps">
          <li>
            <a className="tgpanel__btn tgpanel__btn--primary" href={minted.addAsAdminUrl} target="_blank" rel="noopener noreferrer">
              Add the bot to your group
            </a>
            <p className="tgpanel__muted">
              Telegram asks which group and shows one admin right: pinning, so the bot can pin the join button. You must be an admin there.{' '}
              <a className="tgpanel__link" href={minted.addToGroupUrl} target="_blank" rel="noopener noreferrer">
                Add it without the right
              </a>
            </p>
          </li>
          <li>
            <p className="tgpanel__muted">Bot already in the group? An admin sends this there:</p>
            <p className="tgpanel__row">
              <code className="tgpanel__code">{minted.linkCommand}</code>
              <button type="button" className="tgpanel__btn" onClick={() => copy('cmd', minted.linkCommand)}>
                {copied === 'cmd' ? 'Copied' : 'Copy'}
              </button>
            </p>
          </li>
          <li className="tgpanel__muted" role="status">
            Waiting for the group. The code works once and lasts 15 minutes.
          </li>
        </ol>
      )}

      {note && (
        <p className="tgpanel__note" role="alert">
          {note}
        </p>
      )}
    </section>
  )
}
