'use client'

// THE SEAM to the bot lanes' settings panels (squad community).
//
// The Telegram and Discord lanes own
//   components/community/telegram/TelegramPanel.tsx
//   components/community/discord/DiscordPanel.tsx
// (default exports, props { slug, canManage }). Lane GROUP creates nothing at
// those paths, and a missing module fails the build, so a seat stays empty
// until its lane's panel is in the tree and ChannelsPanel says so by name.
// The Discord panel is in (merged 2026-11-09) and is wired below.
//
// COORDINATOR, WHEN THE TELEGRAM LANE MERGES (two lines, nothing else changes):
//
//   import TelegramPanelImpl from '@/components/community/telegram/TelegramPanel'
//   export const TelegramPanel: PanelSeat = TelegramPanelImpl
//
// The pin `group seam` in scripts/community-group-pins.ts goes red the moment
// a panel file exists and its seat is still empty.

import type { ComponentType } from 'react'
import DiscordPanelImpl from '@/components/community/discord/DiscordPanel'

export interface ChannelPanelProps {
  slug: string
  canManage: boolean
}

export type PanelSeat = ComponentType<ChannelPanelProps> | null

export const TelegramPanel: PanelSeat = null
export const DiscordPanel: PanelSeat = DiscordPanelImpl
