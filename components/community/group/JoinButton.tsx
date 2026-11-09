'use client'
// Lane GROUP owns this file. Props are the squad contract: the one-tap join.
//
//   · a proven identity (a wallet session, or a Telegram / Discord identity
//     the provider signed) joins on the tap, shown at once and corrected if
//     the server says no
//   · a stranger gets a small chooser: Telegram (the Telegram lane's own
//     door, through the seam in join-lanes.tsx, once it is in the tree and
//     a bot is configured) or the unified sign-in door. The join is HELD in this tab
//     (room-logic heldJoinRecord, 30 minutes) and runs by itself the moment
//     an identity lands, whichever lane brought it: the email lane in place,
//     the Google lane after its redirect, Telegram on the way back
//   · a member sees "Joined"; leaving is behind a menu, never one tap away
//   · the owner sees "Owner"
//
// Joining is never a signature and never needs a wallet. The door here is a
// door on a working page (rule 6): it names no destination, so the visitor
// stays on the room.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Send, X } from 'lucide-react'
import CreateAccountButton from '@/components/CreateAccountButton'
import { cdpEnabled } from '@/lib/cdp-embedded'
import type { MyMembership } from '@/lib/community/spec'
import { signInLandingHere, useSession } from '@/lib/session'
import { TelegramJoin } from './join-lanes'
import { HELD_JOIN_KEY, VIA_KEY, heldJoinRecord, readHeldJoin, readVia, telegramJoinHref, type TelegramDoor } from './room-logic'
import { useRoomStore, useStanding } from './room-store'
import './group.css'

export interface JoinButtonProps {
  slug: string
  name: string
  /** The invite code the page was opened with. */
  via?: string | null
  /** Called with the new state after a join or a leave. */
  onChange?: (member: boolean) => void
  size?: 'sm' | 'md'
  /** Offer a plain "Continue with Telegram" link in the chooser. Only used
   *  while the Telegram lane's own door (join-lanes.tsx) is not in the tree;
   *  off by default, needs `telegram` too. */
  telegramReady?: boolean
  /** The bot that joins people from Telegram (the room page reads it from env). */
  telegram?: TelegramDoor | null
}

const store = {
  get(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) window.sessionStorage.removeItem(key)
      else window.sessionStorage.setItem(key, value)
    } catch {
      // storage blocked: the join simply is not held across a reload
    }
  },
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export default function JoinButton({ slug, name, via = null, onChange, size = 'md', telegramReady = false, telegram = null }: JoinButtonProps) {
  const { status, address, signIn, signingIn, connectAndSignIn } = useSession()
  const standing = useStanding(slug)
  const setSeat = useRoomStore((s) => s.setSeat)
  const sessionAddress = status === 'authed' && address ? address : ''

  // What the button shows while a request is out (null = what the store says).
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chooser, setChooser] = useState<{ via: string | null } | null>(null)
  const [menu, setMenu] = useState(false)
  const menuId = useId()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  /** The invite this join carries, read when the visitor acts. */
  const viaNow = useCallback((): string | null => via ?? readVia(store.get(VIA_KEY), slug, Date.now()), [via, slug])

  const join = useCallback(
    async (code: string | null) => {
      setBusy(true)
      setError(null)
      setOptimistic(true)
      try {
        const res = await fetch(`/api/communities/${encodeURIComponent(slug)}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(code ? { via: code } : {}),
        })
        const data = (await res.json().catch(() => null)) as { me?: MyMembership; error?: string; needsIdentity?: boolean } | null
        if (res.status === 401) {
          // No proven identity after all: hold the join and offer the ways in.
          store.set(HELD_JOIN_KEY, heldJoinRecord(slug, code, Date.now()))
          setOptimistic(null)
          setChooser({ via: code })
          return
        }
        if (!res.ok || !data?.me) {
          setOptimistic(null)
          setError(data?.error ?? 'Could not join. Try again.')
          return
        }
        setSeat(slug, data.me, sessionAddress)
        store.set(HELD_JOIN_KEY, null)
        setOptimistic(null)
        setChooser(null)
        onChangeRef.current?.(true)
      } catch {
        setOptimistic(null)
        setError('Could not reach the room. Try again.')
      } finally {
        setBusy(false)
      }
    },
    [slug, sessionAddress, setSeat],
  )

  // An identity landed while a join was held for this room: run it, once.
  const autoRan = useRef(false)
  useEffect(() => {
    if (!standing.ready || !standing.proven) return
    const held = readHeldJoin(store.get(HELD_JOIN_KEY), Date.now())
    if (!held || held.slug !== slug) return
    store.set(HELD_JOIN_KEY, null)
    setChooser(null)
    if (standing.member || autoRan.current) return
    autoRan.current = true
    void join(held.via)
  }, [standing.ready, standing.proven, standing.member, slug, join])

  const onJoin = () => {
    const code = viaNow()
    if (standing.proven) {
      void join(code)
      return
    }
    store.set(HELD_JOIN_KEY, heldJoinRecord(slug, code, Date.now()))
    setChooser({ via: code })
  }

  // The Telegram lane's door signed this tab in and joined the room itself:
  // read who is acting again, drop the held join, tell the page.
  const loadIdentity = useRoomStore((s) => s.loadIdentity)
  const onTelegram = () => {
    store.set(HELD_JOIN_KEY, null)
    setChooser(null)
    void loadIdentity(sessionAddress, true).then(() => onChangeRef.current?.(true))
  }

  // Closing the chooser is a no: the held join goes with it.
  const closeChooser = () => {
    store.set(HELD_JOIN_KEY, null)
    setChooser(null)
  }

  const leave = async () => {
    setMenu(false)
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(slug)}/join`, { method: 'DELETE' })
      const data = (await res.json().catch(() => null)) as { left?: boolean; error?: string } | null
      if (!res.ok) {
        setError(data?.error ?? 'Could not leave. Try again.')
        return
      }
      setSeat(slug, null, sessionAddress)
      onChangeRef.current?.(false)
    } catch {
      setError('Could not reach the room. Try again.')
    } finally {
      setBusy(false)
    }
  }

  // The leave menu closes on an outside press or Escape.
  useEffect(() => {
    if (!menu) return
    const down = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenu(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false)
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [menu])

  useEffect(() => {
    if (!chooser) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        store.set(HELD_JOIN_KEY, null)
        setChooser(null)
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [chooser])

  const member = optimistic ?? standing.member
  const role = standing.me?.role ?? null
  const cls = `grp-join grp-join--${size}`

  let control
  if (member && role === 'owner') {
    control = (
      <span className={`${cls} is-owner`} data-join-state="owner">
        Owner
      </span>
    )
  } else if (member) {
    control = (
      <>
        <button type="button" className={`${cls} is-member`} aria-haspopup="menu" aria-expanded={menu} aria-controls={menu ? menuId : undefined} onClick={() => setMenu((m) => !m)} disabled={busy} data-join-state="member">
          <Check width={14} height={14} aria-hidden />
          Joined
          <ChevronDown width={13} height={13} aria-hidden />
        </button>
        {menu && (
          <span className="grp-join__menu" role="menu" id={menuId}>
            <button type="button" role="menuitem" className="grp-join__leave" onClick={leave} data-journey="Room: leave">
              Leave {name}
            </button>
          </span>
        )}
      </>
    )
  } else {
    control = (
      <button type="button" className={`${cls} is-join`} onClick={onJoin} disabled={busy} aria-label={`Join ${name}`} data-join-state="join" data-journey="Room: join">
        {busy ? 'Joining…' : 'Join'}
      </button>
    )
  }

  return (
    <span className="grp-join__wrap" ref={wrapRef} data-join={slug}>
      {control}
      {error && (
        <span className="grp-join__err" role="alert">
          {error}
        </span>
      )}
      {chooser &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="grp-choose" data-join-chooser={slug}>
            <button type="button" className="grp-choose__veil" aria-label="Close" onClick={closeChooser} />
            <div className="grp-choose__panel" role="dialog" aria-modal="true" aria-label={`Join ${name}`}>
              <button type="button" className="grp-choose__x" aria-label="Close" onClick={closeChooser}>
                <X width={16} height={16} />
              </button>
              <h2 className="grp-choose__title">Join {name}</h2>
              <p className="grp-choose__sub">Sign in once and you are in. Joining is free and never moves money.</p>
              <div className="grp-choose__lanes">
                {TelegramJoin ? (
                  <div className="grp-choose__seat" data-lane="telegram">
                    <TelegramJoin slug={slug} via={chooser.via} onSignedIn={onTelegram} />
                  </div>
                ) : telegramReady && telegram ? (
                  <a className="grp-choose__lane" href={telegramJoinHref(telegram, slug, chooser.via)} target="_blank" rel="noopener noreferrer" data-lane="telegram" data-journey="Room: join with Telegram">
                    <Send width={16} height={16} aria-hidden />
                    Continue with Telegram
                  </a>
                ) : null}
                {standing.walletWaiting ? (
                  <button type="button" className="grp-choose__lane is-lead" disabled={signingIn} onClick={() => void signIn(signInLandingHere())} data-lane="wallet-session" data-journey="Room: join, sign in with connected wallet">
                    {signingIn ? 'Check your wallet…' : `Sign in as ${short(standing.walletWaiting)}`}
                  </button>
                ) : cdpEnabled ? (
                  <CreateAccountButton className="grp-choose__lane is-lead" label="Continue with a wallet, Google or email" />
                ) : (
                  <button type="button" className="grp-choose__lane is-lead" onClick={() => connectAndSignIn(signInLandingHere())} data-lane="wallet" data-journey="Room: join, sign in">
                    Continue with a wallet
                  </button>
                )}
              </div>
              <p className="grp-choose__note">You come straight back to this room and the join finishes by itself.</p>
            </div>
          </div>,
          document.body,
        )}
    </span>
  )
}
