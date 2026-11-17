// THE TOUR's icons (squad landing, 2026-11-10; lane STAGE). A side wears the
// icon the app's spine already wears on the seat that side's door opens
// (components/AppSpine: markets, chats, links, jobs, community, wallet, docs),
// so the tour teaches the same marks a visitor meets in the app. Earn has no
// seat on the spine: it wears the rate sign.
import { BookOpen, CandlestickChart, Flame, Link2, ListChecks, MessageSquare, Percent, Wallet, type LucideIcon } from 'lucide-react'
import type { TourId } from '@/lib/home-tour'

export const TOUR_ICONS: Record<TourId, LucideIcon> = {
  charts: CandlestickChart,
  ask: MessageSquare,
  links: Link2,
  autopilots: ListChecks,
  community: Flame,
  earn: Percent,
  wallet: Wallet,
  build: BookOpen,
}
