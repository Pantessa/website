'use client'

// LINKED CHATS — the room's Telegram group and Discord channel (squad
// community, lane GROUP). Everyone sees which chats are linked, by platform
// and title only. An owner or a mod also gets the two settings panels the
// bot lanes own, mounted through the seam in channel-panels.tsx; until a
// lane's panel exists its seat says so by name.

import { MessageCircle, Send } from 'lucide-react'
import { DiscordPanel, TelegramPanel } from './channel-panels'
import { useRoom } from './Room'

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
          <div id="room-telegram" className={`grp-chan__seat${focused === 'telegram' ? ' is-focused' : ''}`} data-seat="telegram" data-linked={telegram.length > 0 ? '' : undefined}>
            <h3 className="grp-chan__k">
              <Send width={13} height={13} aria-hidden />
              Telegram{telegram[0]?.title ? `: ${telegram[0].title}` : ''}
            </h3>
            {TelegramPanel ? <TelegramPanel slug={slug} canManage={canManage} /> : <p className="grp-chan__wait">Telegram: lands with the squad&rsquo;s Telegram lane.</p>}
          </div>
          <div id="room-discord" className={`grp-chan__seat${focused === 'discord' ? ' is-focused' : ''}`} data-seat="discord" data-linked={discord.length > 0 ? '' : undefined}>
            <h3 className="grp-chan__k">
              <MessageCircle width={13} height={13} aria-hidden />
              Discord{discord[0]?.title ? `: ${discord[0].title}` : ''}
            </h3>
            {DiscordPanel ? <DiscordPanel slug={slug} canManage={canManage} /> : <p className="grp-chan__wait">Discord: lands with the squad&rsquo;s Discord lane.</p>}
          </div>
        </>
      )}
    </section>
  )
}
