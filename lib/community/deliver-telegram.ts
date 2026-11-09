// Lane TELEGRAM owns this file: announce one post to one linked Telegram chat.
// Contract: best-effort, resolves false (never throws) when the bot is
// unconfigured or Telegram refuses.
import type { Deliverer } from './fanout'

export const deliverTelegram: Deliverer = async () => false
