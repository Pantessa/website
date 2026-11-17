'use client'

// The rooms that follow this market, as ONE line above the symbol page's
// feed (squad community, lane SHARE, 2026-11-09).
//
// One read (feed-rules symbolRoomsHref → GET /api/communities?symbol=&limit=3):
// each room is its name, its member count and a link to the room. No join
// button here: the room page is where joining is one tap. No room → one quiet
// line with the door to start one. The line keeps the same height in every
// state (loading, rooms, none), at most 56px on a phone, so the first post
// never jumps or drops below the fold. A read that fails shows nothing: the
// line never claims "no room" on a guess.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { communityPath, type PublicCommunity } from '@/lib/community/spec'
import { SYMBOL_ROOMS_LIMIT, noRoomLine, symbolRoomsHref } from '@/components/community/feed-rules'

export default function RoomsStrip({ symbol }: { symbol: string }) {
  const [rooms, setRooms] = useState<PublicCommunity[] | 'loading' | 'error'>('loading')

  useEffect(() => {
    let dead = false
    setRooms('loading')
    fetch(symbolRoomsHref(symbol))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { communities?: PublicCommunity[] } | null) => {
        if (!dead) setRooms(Array.isArray(d?.communities) ? d.communities.slice(0, SYMBOL_ROOMS_LIMIT) : 'error')
      })
      .catch(() => {
        if (!dead) setRooms('error')
      })
    return () => {
      dead = true
    }
  }, [symbol])

  if (rooms === 'error') return null
  return (
    <nav className="mkc__rooms" aria-label={`Rooms that follow ${symbol}`} data-symbol-rooms={rooms === 'loading' ? 'loading' : String(rooms.length)}>
      <span className="mkc__eyebrow mkc__rooms-label">Rooms on {symbol}</span>
      {rooms === 'loading' ? null : rooms.length === 0 ? (
        <span className="mkc__rooms-none">
          {noRoomLine(symbol)}{' '}
          <Link href="/g/new" data-door="start-room">
            Start one.
          </Link>
        </span>
      ) : (
        <>
          {rooms.map((r) => (
            <Link key={r.slug} href={communityPath(r.slug)} className="mkc__room">
              {r.name} <small>{r.members.toLocaleString('en-US')}</small>
            </Link>
          ))}
          <Link href="/g" className="mkc__rooms-all">
            All rooms
          </Link>
        </>
      )}
    </nav>
  )
}
