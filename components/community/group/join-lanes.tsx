'use client'

// THE SEAM to the Telegram lane's join door (squad community).
//
// The Telegram lane owns components/community/telegram/TelegramJoin.tsx:
// "Continue with Telegram" for a room, props { slug, via, onSignedIn, size }.
// It reads its own status and renders nothing while no bot is configured.
// Lane GROUP creates nothing at that path; this file is the one place the
// chooser reaches it. It lives apart from channel-panels.tsx so a Join
// button in the directory never pulls the owner's settings panels into its
// bundle. Wired 2026-11-09 (the Telegram lane merged). A seat set to null
// falls back to the chooser's plain link, and the pin `group seam` in
// scripts/community-group-pins.ts goes red when the file exists and the seat
// is empty.

import type { ComponentType } from 'react'
import TelegramJoinImpl from '@/components/community/telegram/TelegramJoin'

export interface TelegramJoinProps {
  slug: string
  /** The invite code the join carries. */
  via?: string | null
  /** Called after Telegram signed this tab in and the join went through. */
  onSignedIn?: () => void
  size?: 'sm' | 'md'
}

export type TelegramJoinSeat = ComponentType<TelegramJoinProps> | null

export const TelegramJoin: TelegramJoinSeat = TelegramJoinImpl
