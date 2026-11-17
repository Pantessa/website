// The command menus Telegram shows (setMyCommands), derived from the squad's
// one list (lib/community/spec BOT_COMMANDS). Pure; pinned; used by
// scripts/telegram-setup.ts.

import { BOT_COMMANDS } from '@/lib/community/spec'

export interface BotCommandEntry {
  command: string
  description: string
}

/** Commands that only mean something inside a group linked to a room. */
const GROUP_ONLY: readonly string[] = ['calls', 'top', 'invite', 'join', 'link']

const HELP: BotCommandEntry = { command: 'help', description: 'What this bot answers' }

/** A group's menu: every shared command, then help. */
export function groupCommands(): BotCommandEntry[] {
  return [...BOT_COMMANDS.map((c) => ({ command: c.name, description: c.does.slice(0, 256) })), HELP]
}

/** A private chat's menu: only what answers there. */
export function privateCommands(): BotCommandEntry[] {
  return [...BOT_COMMANDS.filter((c) => !GROUP_ONLY.includes(c.name)).map((c) => ({ command: c.name, description: c.does.slice(0, 256) })), HELP]
}

/** The update kinds the webhook reads. Anything else is never delivered. */
export const ALLOWED_UPDATES = ['message', 'my_chat_member', 'callback_query'] as const

export const webhookUrl = (site: string) => `${site}/api/telegram/webhook`
