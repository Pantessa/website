'use client'

// THE SEAM to the Telegram lane's join door (squad community).
//
// The Telegram lane owns components/community/telegram/TelegramJoin.tsx:
// "Continue with Telegram" for a room, props { slug, via, onSignedIn, size }.
// It reads its own status and renders nothing while no bot is configured.
// Lane GROUP creates nothing at that path, and a missing module fails the
// build, so the seat is empty until that lane's file is in the tree. It
// lives apart from channel-panels.tsx so a Join button in the directory
// never pulls the owner's settings panels into its bundle.
//
// COORDINATOR, WHEN THE TELEGRAM LANE MERGES (two lines, nothing else changes):
//
//   import TelegramJoinImpl from '@/components/community/telegram/TelegramJoin'
//   export const TelegramJoin: TelegramJoinSeat = TelegramJoinImpl
//
// The pin `group seam` in scripts/community-group-pins.ts goes red the moment
// the file exists and this seat is still empty.

import type { ComponentType } from 'react'

export interface TelegramJoinProps {
  slug: string
  /** The invite code the join carries. */
  via?: string | null
  /** Called after Telegram signed this tab in and the join went through. */
  onSignedIn?: () => void
  size?: 'sm' | 'md'
}

export type TelegramJoinSeat = ComponentType<TelegramJoinProps> | null

export const TelegramJoin: TelegramJoinSeat = null
