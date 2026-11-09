'use client'

// THE SEAM to the bot lanes' settings panels (squad community).
//
// The Telegram and Discord lanes own
//   components/community/telegram/TelegramPanel.tsx
//   components/community/discord/DiscordPanel.tsx
// (default exports, props { slug, canManage }). Lane GROUP creates nothing at
// those paths, and a missing module fails the build, so until those lanes
// merge the two seats are empty and ChannelsPanel says so by name.
//
// COORDINATOR, AT MERGE (two lines, nothing else changes):
//
//   import dynamic from 'next/dynamic'
//   export const TelegramPanel: PanelSeat = dynamic(() => import('@/components/community/telegram/TelegramPanel'), { ssr: false, loading: PanelLoading })
//   export const DiscordPanel: PanelSeat = dynamic(() => import('@/components/community/discord/DiscordPanel'), { ssr: false, loading: PanelLoading })

import type { ComponentType } from 'react'

export interface ChannelPanelProps {
  slug: string
  canManage: boolean
}

export type PanelSeat = ComponentType<ChannelPanelProps> | null

export function PanelLoading() {
  return <p className="grp-chan__wait">Loading…</p>
}

export const TelegramPanel: PanelSeat = null
export const DiscordPanel: PanelSeat = null
