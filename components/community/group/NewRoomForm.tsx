'use client'

// START A ROOM — /g/new (squad community, lane GROUP).
//
// Name the room and it suggests its own address; say what it is about and
// which markets it follows; POST /api/communities. The owner of a room is a
// wallet, so sending needs a wallet session. A signed-out visitor still gets
// the whole form: the button becomes the unified sign-in door (rule 6, no
// destination of its own, so they stay here) and the draft is kept in this
// tab, through the Google lane's reload too.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import CreateAccountButton from '@/components/CreateAccountButton'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { COMMUNITY_ABOUT_MAX, COMMUNITY_NAME_MAX, COMMUNITY_SYMBOLS_MAX, communityPath, type PublicCommunity } from '@/lib/community/spec'
import { signInLandingHere, useSession } from '@/lib/session'
import { EMPTY_DRAFT, ROOM_DRAFT_KEY, cleanSlugInput, draftProblem, parseSymbols, readDraft, slugProblem, suggestSlug, type RoomDraft } from './room-logic'
import './group.css'

type Taken = 'unknown' | 'checking' | 'free' | 'taken'

export default function NewRoomForm() {
  const router = useRouter()
  const { status, address, walletAddress, signIn, signingIn, connectAndSignIn } = useSession()
  const authed = status === 'authed' && !!address
  const [draft, setDraft] = useState<RoomDraft>(EMPTY_DRAFT)
  const [restored, setRestored] = useState(false)
  const [taken, setTaken] = useState<Taken>('unknown')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  // The draft comes back from this tab's storage, then follows every edit.
  useEffect(() => {
    try {
      setDraft(readDraft(window.sessionStorage.getItem(ROOM_DRAFT_KEY)))
    } catch {
      // storage blocked: an empty form
    }
    setRestored(true)
  }, [])
  useEffect(() => {
    if (!restored) return
    try {
      window.sessionStorage.setItem(ROOM_DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // storage blocked: the draft lives as long as the page
    }
  }, [draft, restored])

  const setName = (name: string) => setDraft((d) => ({ ...d, name: name.slice(0, COMMUNITY_NAME_MAX), slug: d.slugTouched ? d.slug : suggestSlug(name) }))
  const setSlug = (raw: string) => {
    const slug = cleanSlugInput(raw)
    setDraft((d) => ({ ...d, slug, slugTouched: slug !== '' }))
  }

  // Is the address free? Asked of the room's own public read, a beat after
  // the typing stops. A read that fails says nothing either way.
  const slug = draft.slug
  const slugBad = slugProblem(slug)
  useEffect(() => {
    if (slugBad) {
      setTaken('unknown')
      return
    }
    setTaken('checking')
    let dead = false
    const t = window.setTimeout(() => {
      fetch(`/api/communities/${encodeURIComponent(slug)}`, { cache: 'no-store' })
        .then((r) => {
          if (dead) return
          const json = (r.headers.get('content-type') ?? '').includes('json')
          setTaken(r.ok ? 'taken' : r.status === 404 && json ? 'free' : 'unknown')
        })
        .catch(() => {
          if (!dead) setTaken('unknown')
        })
    }, 350)
    return () => {
      dead = true
      window.clearTimeout(t)
    }
  }, [slug, slugBad])

  const symbols = parseSymbols(draft.symbols)
  const problem = draftProblem(draft)
  const nameRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setError(null)
    if (problem || !authed || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/communities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: draft.slug, name: draft.name.trim(), about: draft.about.trim(), symbols }),
      })
      const data = (await res.json().catch(() => null)) as { community?: PublicCommunity; error?: string } | null
      if (res.status === 409) {
        setTaken('taken')
        setError('That address is taken. Pick another.')
        return
      }
      if (!res.ok || !data?.community) {
        setError(data?.error ?? (res.status === 401 ? 'Sign in with a wallet to start a room.' : 'The room could not be started. Try again.'))
        return
      }
      try {
        window.sessionStorage.removeItem(ROOM_DRAFT_KEY)
      } catch {
        // storage blocked: nothing was kept
      }
      router.push(communityPath(data.community.slug))
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setSending(false)
    }
  }

  const slugNote =
    slug === ''
      ? 'Lowercase letters, numbers and hyphens.'
      : slugBad
        ? slugBad
        : taken === 'taken'
          ? 'That address is taken. Pick another.'
          : taken === 'free'
            ? 'This address is free.'
            : 'Lowercase letters, numbers and hyphens.'
  const slugTone = slug !== '' && (slugBad || taken === 'taken') ? 'bad' : taken === 'free' && !slugBad ? 'good' : 'plain'

  return (
    <form className="grp-new" onSubmit={submit} noValidate data-new-room data-authed={authed ? '' : undefined}>
      <label className="grp-field">
        <span className="grp-field__k">Name</span>
        <input ref={nameRef} className="grp-input" value={draft.name} onChange={(e) => setName(e.target.value)} placeholder="ETH swing traders" maxLength={COMMUNITY_NAME_MAX} autoComplete="off" required data-field="name" />
      </label>

      <label className="grp-field">
        <span className="grp-field__k">Address</span>
        <span className="grp-slug">
          <span className="grp-slug__pre" aria-hidden>
            pantessa.com/g/
          </span>
          <input className="grp-input grp-slug__in" value={draft.slug} onChange={(e) => setSlug(e.target.value)} placeholder="eth-swing-traders" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" aria-describedby="new-room-slug-note" required data-field="slug" />
        </span>
        <span id="new-room-slug-note" className={`grp-field__note is-${slugTone}`} data-slug-state={slugBad ? 'bad' : taken}>
          {slugNote}
        </span>
      </label>

      <label className="grp-field">
        <span className="grp-field__k">
          What it is about <small>optional</small>
        </span>
        <textarea className="grp-input grp-input--area" value={draft.about} onChange={(e) => setDraft((d) => ({ ...d, about: e.target.value.slice(0, COMMUNITY_ABOUT_MAX) }))} placeholder="Daily levels on ETH and the majors. Calls are stamped, trades are shown with proof." maxLength={COMMUNITY_ABOUT_MAX} rows={3} data-field="about" />
      </label>

      <label className="grp-field">
        <span className="grp-field__k">
          Markets it follows <small>optional, up to {COMMUNITY_SYMBOLS_MAX}</small>
        </span>
        <input className="grp-input" value={draft.symbols} onChange={(e) => setDraft((d) => ({ ...d, symbols: e.target.value.slice(0, 200) }))} placeholder="ETH, BTC, HYPE" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" data-field="symbols" />
        {symbols.length > 0 && (
          <span className="grp-chips" aria-label="Markets read from what you typed">
            {symbols.map((s) => (
              <span key={s} className="grp-chip grp-chip--static">
                {s}
              </span>
            ))}
          </span>
        )}
      </label>

      {(error || (touched && problem)) && (
        <p className="grp-new__err" role="alert">
          {error ?? problem}
        </p>
      )}

      <div className="grp-new__act">
        {authed ? (
          <button type="submit" className="grp-btn grp-btn--accent grp-btn--lg" disabled={sending} data-journey="Rooms: start the room" data-new-submit>
            {sending ? 'Starting…' : 'Start the room'}
          </button>
        ) : status === 'loading' ? (
          <button type="button" className="grp-btn grp-btn--accent grp-btn--lg" disabled>
            Start the room
          </button>
        ) : walletAddress ? (
          <button type="button" className="grp-btn grp-btn--accent grp-btn--lg" disabled={signingIn} onClick={() => void signIn(signInLandingHere())} data-new-door="wallet-session" data-journey="Rooms: sign in to start a room">
            {signingIn ? 'Check your wallet…' : 'Sign in to start the room'}
          </button>
        ) : cdpEnabled ? (
          <span data-new-door="unified">
            <CreateAccountButton className="grp-btn grp-btn--accent grp-btn--lg" label="Sign in to start the room" />
          </span>
        ) : (
          <button type="button" className="grp-btn grp-btn--accent grp-btn--lg" onClick={() => connectAndSignIn(signInLandingHere())} data-new-door="wallet" data-journey="Rooms: sign in to start a room">
            Sign in to start the room
          </button>
        )}
        <p className="grp-new__fine">
          {authed
            ? 'You own the room. Your wallet is its owner on record, and you are its first member.'
            : 'A room is owned by a wallet. What you typed stays here while you sign in.'}
        </p>
      </div>
    </form>
  )
}
