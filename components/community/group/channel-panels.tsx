'use client'

// THE SEAM to the bot lanes' settings panels (squad community).
//
// The Telegram and Discord lanes own
//   components/community/telegram/TelegramPanel.tsx
//   components/community/discord/DiscordPanel.tsx
// (default exports, props { slug, canManage }). Lane GROUP creates nothing at
// those paths; this file is the one place the room page reaches them. Both
// panels are in the tree and wired (2026-11-09). A seat set to null renders
// ChannelsPanel's "lands with the lane" line instead, and the pin
// `group seam` in scripts/community-group-pins.ts goes red when a panel file
// exists and its seat is empty.

import type { ComponentType } from 'react'
import DiscordPanelImpl from '@/components/community/discord/DiscordPanel'
import TelegramPanelImpl from '@/components/community/telegram/TelegramPanel'

export interface ChannelPanelProps {
  slug: string
  canManage: boolean
}

export type PanelSeat = ComponentType<ChannelPanelProps> | null

export const TelegramPanel: PanelSeat = TelegramPanelImpl
export const DiscordPanel: PanelSeat = DiscordPanelImpl
