// The section contract (squad apps-page, 2026-11-17). ONE module per app
// family lives in this folder; components/apps/sections/index.ts maps a
// family to its module. A lane owns its family files and nothing else here.

import type { ComponentType } from 'react'
import type { McpServer } from '@/lib/store'
import type { AppFamily, PageTiles, SectionDensity } from '@/lib/apps-page'
import type { MoneyMap, SplashTile } from '@/lib/splash/types'

export interface AppSectionProps {
  server: McpServer
  family: AppFamily
  /** This app's tiles from the scan. Empty while `pending` (just toggled on). */
  tiles: SplashTile[]
  pending: boolean
  /** 'full' = the only app on the page (a page of its own: use the room);
   *  'side' = one of two or three columns (the essentials, ~380 to 560px
   *  wide); 'line' = one of four or more (ONE row: a sentence and a button). */
  density: SectionDensity
  /** The whole page's tiles: the wallet briefing, the recurring buys and
   *  every other app's group, for a section that wants wallet context. */
  page: PageTiles
  map: MoneyMap | null
  address: string
  /** Hand an ask to the chat docked beside the page. Runs it by default (a
   *  button on the page IS the ask); `send: false` only fills the composer.
   *  A money ask comes back in the chat as a card the wallet signs — a
   *  section never builds or signs anything itself. */
  onAsk: (text: string, opts?: { send?: boolean }) => void
  /** Re-run the whole scan (an error tile's Retry). */
  onRetry: () => void
}

export interface SectionModule {
  Section: ComponentType<AppSectionProps>
  /** The page's headline when this app is the ONLY one open, composed from
   *  its own data ("$6,306 in 35 positions on five chains."). One sentence,
   *  plain words, ends with a full stop. null → the page's default. */
  headline?: (p: Pick<AppSectionProps, 'server' | 'tiles' | 'page' | 'map'>) => string | null
  /** In the one-line posture: true when this app has nothing to report, so
   *  the page folds it into the single "Nothing new from …" line instead of
   *  giving it a row. Absent → lib/apps-page lineFor(tiles).quiet decides. */
  quiet?: (p: Pick<AppSectionProps, 'server' | 'tiles' | 'page' | 'map'>) => boolean
}
