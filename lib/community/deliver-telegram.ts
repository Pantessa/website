// Lane TELEGRAM owns this file: announce one post to one linked Telegram chat.
// Contract (lib/community/fanout): best-effort, resolves false (never throws)
// when the bot is unconfigured, the post cannot be linked to, or Telegram
// refuses. A chat the bot can no longer reach (removed, blocked, the chat is
// gone) is UNLINKED so the next post does not knock on a closed door.
//
// The message is lib/telegram/messages announcementMessage (pure, pinned):
// a kind line, the title, who and where, and buttons that are all OUR urls.
// "verified on-chain" is said only behind `post.proof.verification`.

import { SITE_URL } from '@/lib/site-url'
import { chatIsGone, telegramCaller, type TgCall } from '@/lib/telegram/client'
import { telegramConfig } from '@/lib/telegram/config'
import type { LinkCtx } from '@/lib/telegram/links'
import { announcementMessage, sendParams } from '@/lib/telegram/messages'
import type { Deliverer } from './fanout'

export interface DeliverTelegramDeps {
  links: LinkCtx | null
  call: TgCall | null
  unlink: (externalId: string) => Promise<unknown>
}

const CHAT_ID_RE = /^-?\d{1,20}$/

/** The deliverer over injected dependencies (the pins hand it a recording caller). */
export function deliverTelegramWith(deps: DeliverTelegramDeps): Deliverer {
  return async (channel, { post, community }) => {
    try {
      if (!deps.links || !deps.call || channel.platform !== 'telegram' || !CHAT_ID_RE.test(channel.externalId)) return false
      if (post.isInternal) return false
      const msg = announcementMessage(deps.links, community, post)
      if (!msg) return false
      const sent = await deps.call('sendMessage', sendParams(channel.externalId, msg))
      if (sent.ok) return true
      if (chatIsGone(sent)) await Promise.resolve(deps.unlink(channel.externalId)).catch(() => null)
      return false
    } catch {
      return false
    }
  }
}

export const deliverTelegram: Deliverer = async (channel, a) => {
  const cfg = telegramConfig()
  if (!cfg.token || !cfg.bot) return false
  // Imported here, not at the top: the store is server-only and the pure
  // half of this file is read by the pins with no database.
  const { unlinkChannel } = await import('./store')
  return deliverTelegramWith({
    links: { site: SITE_URL, bot: cfg.bot, app: cfg.app },
    call: telegramCaller(cfg.token),
    unlink: (externalId) => unlinkChannel('telegram', externalId),
  })(channel, a)
}
