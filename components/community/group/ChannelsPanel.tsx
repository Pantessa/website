'use client'

// LINKED CHATS — the room's Telegram group and Discord channel (squad
// community, lane GROUP). Everyone sees which chats are linked, by platform
// and title only. An owner or a mod also gets the two settings panels the
// bot lanes own, mounted through the seam in channel-panels.tsx; until a
// lane's panel exists its seat says so by name.

import type { ReactNode } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import { DiscordPanel, TelegramPanel } from './channel-panels'
import { useRoom } from './Room'

/** One platform's seat. A lane's own panel brings its own frame and heading,
 *  so the seat is bare around it; an empty seat says which lane it waits for. */
function Seat({ id, title, linked, focused, children }: { id: 'telegram' | 'discord'; title: string | null; linked: boolean; focused: boolean; children: ReactNode }) {
  const name = id === 'telegram' ? 'Telegram' : 'Discord'
  const Icon = id === 'telegram' ? Send : MessageCircle
  if (children) {
    return (
      <div id={`room-${id}`} className={`grp-chan__seat grp-chan__seat--bare${focused ? ' is-focused' : ''}`} data-seat={id} data-linked={linked ? '' : undefined}>
        {children}
      </div>
    )
  }
  return (
    <div id={`room-${id}`} className={`grp-chan__seat${focused ? ' is-focused' : ''}`} data-seat={id} data-linked={linked ? '' : undefined} data-seat-empty>
      <h3 className="grp-chan__k">
        <Icon width={13} height={13} aria-hidden />
        {name}
        {title ? `: ${title}` : ''}
      </h3>
      <p className="grp-chan__wait">
        {name}: lands with the squad&rsquo;s {name} lane.
      </p>
    </div>
  )
}

export default function ChannelsPanel() {
  const { slug, room, canManage, focused } = useRoom()
  if (!room) return null
  const telegram = room.channels.filter((c) => c.platform === 'telegram')
  const discord = room.channels.filter((c) => c.platform === 'discord')
  if (!canManage && room.channels.length === 0) return null

  return (
    <section className="grp-chan" aria-labelledby="room-chan-h" data-channels-panel>
      <h2 id="room-chan-h" className="grp-card__title">
        Linked chats
      </h2>
      {!canManage && (
        <ul className="grp-chan__list">
          {room.channels.map((c, i) => (
            <li key={`${c.platform}-${i}`} className="grp-chan__item">
              {c.platform === 'telegram' ? <Send width={13} height={13} aria-hidden /> : <MessageCircle width={13} height={13} aria-hidden />}
              <span>
                {c.platform === 'telegram' ? 'Telegram' : 'Discord'}
                {c.title ? `: ${c.title}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <>
          <p className="grp-chan__lead">New posts are announced in a linked chat, and the chat can join the room in one tap.</p>
          <Seat id="telegram" title={telegram[0]?.title ?? null} linked={telegram.length > 0} focused={focused === 'telegram'}>
            {TelegramPanel ? <TelegramPanel slug={slug} canManage={canManage} /> : null}
          </Seat>
          <Seat id="discord" title={discord[0]?.title ?? null} linked={discord.length > 0} focused={focused === 'discord'}>
            {DiscordPanel ? <DiscordPanel slug={slug} canManage={canManage} /> : null}
          </Seat>
        </>
      )}
    </section>
  )
}
