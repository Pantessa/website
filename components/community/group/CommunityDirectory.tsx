'use client'
// Lane GROUP owns this file. Props are the squad contract: the list of rooms
// (/community mounts it beside the feed; the symbol page may mount it with a
// symbol to show the rooms that follow it; /g is the full list).
//
// One read: GET /api/communities?sort=&symbol=&limit=. A row answers what a
// stranger asks first: what the room is called, how many are in it, whether
// it is alive this week, and a Join that is one tap.

import { useCallback, useEffect, useState } from 'react'
import SpineLink from '@/components/SpineLink'
import { communityPath, type PublicCommunity } from '@/lib/community/spec'
import JoinButton from './JoinButton'
import { plural } from './room-logic'
import './group.css'

export type DirectorySort = 'members' | 'new' | 'active'

export interface CommunityDirectoryProps {
  symbol?: string
  limit?: number
  /** A tight rail (the feed's side column) or the full list. */
  variant?: 'rail' | 'full'
  /** How the list is ordered. Default: most members. */
  sort?: DirectorySort
}

type Load = PublicCommunity[] | 'loading' | 'error'

export default function CommunityDirectory({ symbol, limit, variant = 'rail', sort = 'members' }: CommunityDirectoryProps) {
  const cap = limit ?? (variant === 'rail' ? 6 : 48)
  const [rooms, setRooms] = useState<Load>('loading')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let dead = false
    const q = new URLSearchParams({ sort, limit: String(cap) })
    if (symbol) q.set('symbol', symbol)
    fetch(`/api/communities?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { communities?: PublicCommunity[] } | null) => {
        if (!dead) setRooms(Array.isArray(d?.communities) ? d.communities.slice(0, cap) : 'error')
      })
      .catch(() => {
        if (!dead) setRooms('error')
      })
    return () => {
      dead = true
    }
  }, [sort, symbol, cap, tick])

  // A join or a leave moves that room's count in place: no re-read, no jump.
  const onMember = useCallback((slug: string, member: boolean) => {
    setRooms((cur) => (Array.isArray(cur) ? cur.map((c) => (c.slug === slug ? { ...c, members: Math.max(0, c.members + (member ? 1 : -1)) } : c)) : cur))
  }, [])

  const rail = variant === 'rail'
  const base = `grp-dir grp-dir--${variant}`

  if (rooms === 'loading') {
    return (
      <div className={base} data-community-directory={variant} aria-busy="true">
        {rail && <h2 className="grp-card__title">Rooms</h2>}
        <div className="grp-skel grp-skel--rows" aria-label="Loading rooms">
          <span />
          <span />
          <span />
        </div>
      </div>
    )
  }
  if (rooms === 'error') {
    return (
      <div className={base} data-community-directory={variant} data-directory-state="error">
        {rail && <h2 className="grp-card__title">Rooms</h2>}
        <p className="grp-dir__note">
          The rooms could not be loaded.{' '}
          <button type="button" className="grp-link" onClick={() => { setRooms('loading'); setTick((t) => t + 1) }}>
            Try again
          </button>
        </p>
      </div>
    )
  }
  if (rooms.length === 0) {
    return (
      <div className={base} data-community-directory={variant} data-directory-state="empty">
        {rail && <h2 className="grp-card__title">Rooms</h2>}
        <div className="grp-dir__empty">
          <p>{symbol ? `No room follows ${symbol} yet.` : 'There are no rooms yet.'}</p>
          <SpineLink href="/g/new" className="grp-btn grp-btn--accent" data-journey="Rooms: start the first room">
            Start the first room
          </SpineLink>
        </div>
      </div>
    )
  }

  if (rail) {
    return (
      <div className={base} data-community-directory="rail">
        <h2 className="grp-card__title">{symbol ? `Rooms that follow ${symbol}` : 'Rooms'}</h2>
        <ul className="grp-dir__rows">
          {rooms.map((c) => (
            <li key={c.slug} className="grp-dir__row" data-room-row={c.slug}>
              <SpineLink href={communityPath(c.slug)} className="grp-dir__rowlink" prefetch={false}>
                <span className="grp-dir__name">{c.name}</span>
                <span className="grp-dir__sub">{plural(c.members, 'member')}</span>
              </SpineLink>
              <JoinButton slug={c.slug} name={c.name} size="sm" onChange={(m) => onMember(c.slug, m)} />
            </li>
          ))}
        </ul>
        <div className="grp-dir__foot">
          <SpineLink href="/g" className="grp-link" data-journey="Rooms: see all">
            See all rooms
          </SpineLink>
          <SpineLink href="/g/new" className="grp-link" data-journey="Rooms: start a room">
            Start a room
          </SpineLink>
        </div>
      </div>
    )
  }

  return (
    <div className={base} data-community-directory="full">
      <ul className="grp-dir__cards">
        {rooms.map((c) => (
          <li key={c.slug} className="grp-dir__card" data-room-row={c.slug}>
            <div className="grp-dir__cardhead">
              <SpineLink href={communityPath(c.slug)} className="grp-dir__cardname" prefetch={false}>
                {c.name}
              </SpineLink>
              <JoinButton slug={c.slug} name={c.name} size="sm" onChange={(m) => onMember(c.slug, m)} />
            </div>
            <p className="grp-dir__about">{c.about || 'Chart ideas, links, videos and trades with proof.'}</p>
            <div className="grp-dir__meta">
              <span>
                <strong>{c.members.toLocaleString('en-US')}</strong> {c.members === 1 ? 'member' : 'members'}
              </span>
              <span>
                <strong>{c.postsWeek.toLocaleString('en-US')}</strong> {c.postsWeek === 1 ? 'post' : 'posts'} this week
              </span>
              {c.channels.some((ch) => ch.platform === 'telegram') && <span>On Telegram</span>}
              {c.channels.some((ch) => ch.platform === 'discord') && <span>On Discord</span>}
            </div>
            {c.symbols.length > 0 && (
              <div className="grp-chips" aria-label="Markets this room follows">
                {c.symbols.slice(0, 6).map((s) => (
                  <SpineLink key={s} href={`/t/${encodeURIComponent(s)}`} className="grp-chip" prefetch={false}>
                    {s}
                  </SpineLink>
                ))}
                {c.symbols.length > 6 && <span className="grp-chip grp-chip--more">+{c.symbols.length - 6}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
