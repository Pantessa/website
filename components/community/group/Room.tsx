'use client'

// THE ROOM — /g/<slug> (squad community, lane GROUP).
//
// One provider holds what the page knows about the room and the visitor:
// the room (server-rendered, refreshed here), the visitor's seat, the invite
// the page was opened with, and the two boards. The main column and the
// frame's side column both read it, so a join shows everywhere at once.
//
// The header answers four questions in one glance: what is this room, who is
// in it, is it alive, how do I get in.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import SpineLink from '@/components/SpineLink'
import Composer from '@/components/community/Composer'
import FeedList from '@/components/community/FeedList'
import ShareSheet from '@/components/community/ShareSheet'
import type { MyMembership, PublicCommunity, PublicMember } from '@/lib/community/spec'
import { communityPath } from '@/lib/community/spec'
import { useSession } from '@/lib/session'
import ChannelsPanel from './ChannelsPanel'
import InvitePanel from './InvitePanel'
import JoinButton from './JoinButton'
import MembersBoard from './MembersBoard'
import OwnerChecklist from './OwnerChecklist'
import { ROOM_DEFAULT_ABOUT, VIA_KEY, cleanVia, inviteLine, inviteUrl, plural, readVia, stripVia, viaRecord, type TelegramDoor } from './room-logic'
import { useRoomStore, useStanding } from './room-store'
import './group.css'

export type BoardSort = 'invites' | 'trades'
export const BOARD_LIMIT = 50

interface RoomState {
  slug: string
  /** null while the first read is out (the server could not hand one down). */
  room: PublicCommunity | null
  state: 'ok' | 'loading' | 'missing' | 'error'
  me: MyMembership | null
  member: boolean
  canManage: boolean
  /** The invite code this visit carries, if any. */
  via: string | null
  /** Who that code belongs to, when the API says. */
  invitedBy: string | null
  telegram: TelegramDoor | null
  boards: Partial<Record<BoardSort, PublicMember[] | 'error'>>
  loadBoard: (sort: BoardSort, force?: boolean) => void
  refresh: () => void
  /** A join or a leave the server just confirmed: the head count moves now, the re-read follows. */
  seatChanged: (member: boolean) => void
  /** Bumped when a post lands, so the feed re-reads. */
  feedKey: number
  bumpFeed: () => void
  /** Open and scroll to one of the page's own places (the checklist's buttons). */
  focus: (target: 'telegram' | 'discord' | 'compose' | 'invite') => void
  focused: string | null
}

const RoomContext = createContext<RoomState | null>(null)

export function useRoom(): RoomState {
  const ctx = useContext(RoomContext)
  if (!ctx) throw new Error('useRoom must be used inside <RoomProvider>.')
  return ctx
}

const storage = {
  get(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      window.sessionStorage.setItem(key, value)
    } catch {
      // storage blocked: the invite rides this page view only
    }
  },
}

export function RoomProvider({
  slug,
  initial,
  via: viaFromServer,
  invitedBy: invitedByFromServer = null,
  telegram,
  children,
}: {
  slug: string
  /** The room as the server read it. null = the server could not read it; the page asks the API. */
  initial: PublicCommunity | null
  /** The `via` the request carried, already shape-checked by the server. */
  via: string | null
  /** The inviter's label for that code, as the server read it. */
  invitedBy?: string | null
  telegram: TelegramDoor | null
  children: ReactNode
}) {
  const { status, address } = useSession()
  const sessionAddress = status === 'authed' && address ? address : ''
  const settled = status !== 'loading'
  const standing = useStanding(slug)
  const setSeat = useRoomStore((s) => s.setSeat)
  const loadIdentity = useRoomStore((s) => s.loadIdentity)

  const [room, setRoom] = useState<PublicCommunity | null>(initial)
  const [state, setState] = useState<RoomState['state']>(initial ? 'ok' : 'loading')
  const [via, setVia] = useState<string | null>(viaFromServer)
  const [invitedBy, setInvitedBy] = useState<string | null>(invitedByFromServer)
  const [boards, setBoards] = useState<RoomState['boards']>({})
  const [feedKey, setFeedKey] = useState(0)
  const [focused, setFocused] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  // The invite: out of the address bar, into this tab. Read from the live
  // URL on arrival (this page's own address, in an effect, never at render).
  useEffect(() => {
    const here = cleanVia(new URLSearchParams(window.location.search).get('via')) ?? viaFromServer
    if (here) {
      const rec = viaRecord(slug, here, Date.now())
      if (rec) storage.set(VIA_KEY, rec)
      setVia(here)
    } else {
      setVia(readVia(storage.get(VIA_KEY), slug, Date.now()))
    }
    if (new URLSearchParams(window.location.search).has('via')) {
      // The address bar goes back to the bare room. history.replaceState, not
      // a router navigation: nothing re-renders and no route is cached under
      // an address that carries a query.
      window.history.replaceState(window.history.state, '', stripVia(window.location.pathname + window.location.search + window.location.hash))
    }
  }, [slug, viaFromServer])

  // A page view always re-reads who is acting: a Telegram or Discord sign-in
  // lands here with a cookie this tab has not seen.
  useEffect(() => {
    if (settled) void loadIdentity(sessionAddress, true)
  }, [settled, sessionAddress, loadIdentity])

  // The room and the visitor's seat. Waits for the session when the server
  // already handed the room down; asks at once when it did not.
  const viaRef = useRef(via)
  useEffect(() => {
    viaRef.current = via
  })
  useEffect(() => {
    if (!settled && initial) return
    let dead = false
    const q = viaRef.current ? `?via=${encodeURIComponent(viaRef.current)}` : ''
    fetch(`/api/communities/${encodeURIComponent(slug)}${q}`, { cache: 'no-store' })
      .then(async (r) => {
        if (dead) return
        if (r.status === 404) {
          if (!initial) setState('missing')
          return
        }
        const d = r.ok ? ((await r.json().catch(() => null)) as { community?: PublicCommunity; me?: MyMembership | null; invitedBy?: string | null } | null) : null
        if (dead) return
        if (!d?.community) {
          if (!initial) setState('error')
          return
        }
        setRoom(d.community)
        setState('ok')
        if (settled) setSeat(slug, d.me ?? null, sessionAddress)
        // Only a read that carried the code can name the inviter; one that
        // did not leaves the server's answer standing.
        if (q) setInvitedBy(typeof d.invitedBy === 'string' && d.invitedBy.trim() ? d.invitedBy.trim().slice(0, 64) : null)
      })
      .catch(() => {
        if (!dead && !initial) setState('error')
      })
    return () => {
      dead = true
    }
  }, [slug, initial, settled, sessionAddress, setSeat, tick])

  const refresh = useCallback(() => setTick((t) => t + 1), [])
  const seatChanged = useCallback((member: boolean) => {
    setRoom((r) => (r ? { ...r, members: Math.max(0, r.members + (member ? 1 : -1)) } : r))
    setTick((t) => t + 1)
  }, [])

  // Back from another tab or app (the owner just added the bot to a group):
  // read the room again, at most every ten seconds.
  useEffect(() => {
    let last = Date.now()
    const onShow = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 10_000) return
      last = Date.now()
      setTick((t) => t + 1)
    }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [])

  const loading = useRef<Partial<Record<BoardSort, boolean>>>({})
  const asked = useRef(new Set<BoardSort>())
  const loadBoard = useCallback(
    (sort: BoardSort, force = false) => {
      if (loading.current[sort] || (!force && asked.current.has(sort))) return
      asked.current.add(sort)
      loading.current[sort] = true
      fetch(`/api/communities/${encodeURIComponent(slug)}/members?sort=${sort}&limit=${BOARD_LIMIT}`, { cache: force ? 'no-store' : 'default' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { members?: PublicMember[] } | null) => {
          setBoards((b) => ({ ...b, [sort]: Array.isArray(d?.members) ? d.members : 'error' }))
        })
        .catch(() => setBoards((b) => ({ ...b, [sort]: 'error' })))
        .finally(() => {
          loading.current[sort] = false
        })
    },
    [slug],
  )

  // The boards follow the head count: a join re-reads what is on screen.
  const members = room?.members ?? 0
  const seen = useRef(members)
  useEffect(() => {
    if (seen.current === members) return
    seen.current = members
    for (const sort of asked.current) loadBoard(sort, true)
  }, [members, loadBoard])

  const focus = useCallback<RoomState['focus']>((target) => {
    setFocused(target)
    // After the target opened (one paint), bring it into view and into focus.
    window.setTimeout(() => {
      const el = document.getElementById(`room-${target}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const first = el.querySelector<HTMLElement>('input, textarea, button, a[href]')
      first?.focus({ preventScroll: true })
    }, 60)
  }, [])

  const me = standing.me
  const value = useMemo<RoomState>(
    () => ({
      slug,
      room,
      state,
      me,
      member: standing.member,
      canManage: me?.role === 'owner' || me?.role === 'mod',
      via,
      invitedBy,
      telegram,
      boards,
      loadBoard,
      refresh,
      seatChanged,
      feedKey,
      bumpFeed: () => setFeedKey((k) => k + 1),
      focus,
      focused,
    }),
    [slug, room, state, me, standing.member, via, invitedBy, telegram, boards, loadBoard, refresh, seatChanged, feedKey, focus, focused],
  )
  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>
}

// ── the main column ────────────────────────────────────────────────────────

/** The API stamps rooms in unix seconds (as posts are); a millisecond stamp reads the same. */
const since = (at: number) => new Date(at < 1e12 ? at * 1000 : at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function RoomMain() {
  const { slug, room, state, me, member, via, invitedBy, telegram, refresh, seatChanged, feedKey, bumpFeed } = useRoom()
  // The absolute link is built after mount: the origin is the browser's.
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])

  if (!room) {
    return (
      <div className="grp-room" data-room={slug} data-room-state={state}>
        {state === 'loading' ? (
          <div className="grp-skel" aria-busy="true" aria-label="Loading the room">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <div className="grp-gone">
            <h1 className="grp-head__name">{state === 'missing' ? 'There is no room at this address' : 'The room could not be loaded'}</h1>
            <p className="grp-head__about">
              {state === 'missing' ? 'The link may be missing a character, or the room was never started.' : 'Nothing is wrong with the link. Try again in a moment.'}
            </p>
            <div className="grp-gone__act">
              {state === 'error' && (
                <button type="button" className="grp-btn" onClick={refresh}>
                  Try again
                </button>
              )}
              <SpineLink href="/g" className="grp-btn">
                See all rooms
              </SpineLink>
            </div>
          </div>
        )}
      </div>
    )
  }

  const telegramChat = room.channels.find((c) => c.platform === 'telegram')
  const discordChat = room.channels.find((c) => c.platform === 'discord')
  const shareUrl = member && me ? inviteUrl(slug, me.invite, origin) : `${origin}${communityPath(slug)}`

  return (
    <div className="grp-room" data-room={slug} data-room-state="ok">
      {via && !member && (
        <p className="grp-invited" role="status" data-invited>
          {invitedBy ? (
            <>
              You were invited by <strong>{invitedBy}</strong>.
            </>
          ) : (
            <>
              You were invited to <strong>{room.name}</strong>.
            </>
          )}{' '}
          Joining takes one tap.
        </p>
      )}

      <header className="grp-head">
        <div className="grp-head__id">
          <div className="grp-eyebrow">Room</div>
          <h1 className="grp-head__name">{room.name}</h1>
          <p className="grp-head__about">{room.about || ROOM_DEFAULT_ABOUT}</p>
        </div>
        <div className="grp-head__act">
          <JoinButton slug={slug} name={room.name} via={via} onChange={seatChanged} telegram={telegram} telegramReady={!!telegram} />
          <span className="grp-head__share">
            <ShareSheet url={shareUrl} text={inviteLine(room.name)} what={member ? 'invite' : 'room'} label={member ? 'Share your invite' : 'Share'} />
          </span>
        </div>
        <dl className="grp-stats" data-room-stats>
          <div>
            <dt>Members</dt>
            <dd data-room-members>{room.members.toLocaleString('en-US')}</dd>
          </div>
          <div>
            <dt>Posts this week</dt>
            <dd data-room-posts>{room.postsWeek.toLocaleString('en-US')}</dd>
          </div>
          <div>
            <dt>Started by</dt>
            <dd className="is-text">{room.ownerLabel}</dd>
          </div>
          <div>
            <dt>Since</dt>
            <dd className="is-text" suppressHydrationWarning>
              {since(room.createdAt)}
            </dd>
          </div>
        </dl>
        {(room.symbols.length > 0 || telegramChat || discordChat) && (
          <div className="grp-head__tags">
            {room.symbols.length > 0 && (
              <div className="grp-chips" aria-label="Markets this room follows">
                <span className="grp-chips__k">Follows</span>
                {room.symbols.map((s) => (
                  <SpineLink key={s} href={`/t/${encodeURIComponent(s)}`} className="grp-chip" prefetch={false} data-journey={`Room market ${s}`}>
                    {s}
                  </SpineLink>
                ))}
              </div>
            )}
            {(telegramChat || discordChat) && (
              <div className="grp-chats" aria-label="Linked chats">
                {telegramChat && (
                  <span className="grp-chat" data-chat="telegram">
                    <Send width={12} height={12} aria-hidden />
                    On Telegram{telegramChat.title ? `: ${telegramChat.title}` : ''}
                  </span>
                )}
                {discordChat && (
                  <span className="grp-chat" data-chat="discord">
                    <MessageCircle width={12} height={12} aria-hidden />
                    On Discord{discordChat.title ? `: ${discordChat.title}` : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {me?.role === 'owner' && <OwnerChecklist />}
      {member && me && <InvitePanel />}

      <section className="grp-feed" aria-label={`Posts in ${room.name}`}>
        {member ? (
          <div id="room-compose" className="grp-feed__compose">
            <Composer community={slug} onPosted={() => { bumpFeed(); refresh() }} />
          </div>
        ) : (
          <div className="grp-feed__door" data-join-to-post>
            <span>
              <strong>Join to post.</strong> Members share chart ideas, links, videos and trades with proof.
            </span>
            <JoinButton slug={slug} name={room.name} via={via} onChange={seatChanged} size="sm" telegram={telegram} telegramReady={!!telegram} />
          </div>
        )}
        <FeedList community={slug} refreshKey={feedKey} emptyLine={`No posts in ${room.name} yet. ${member ? 'Post the first idea.' : 'Join and post the first idea.'}`} />
      </section>
    </div>
  )
}

// ── the side column (the frame's rail; under the feed on a phone) ──────────

export function RoomSide() {
  const { room } = useRoom()
  if (!room) return <div className="grp-side" />
  return (
    <div className="grp-side" data-room-side>
      <MembersBoard />
      <ChannelsPanel />
      <p className="grp-side__foot">
        {plural(room.members, 'member')}. A member is a signed-in wallet, or a Telegram or Discord account the platform itself vouched for.
      </p>
    </div>
  )
}
