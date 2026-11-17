'use client'

// THE PANTESSA WALLET on the apps page (squad apps-page, lane PORTFOLIO). The
// wallet MCP (`yeetful-tool-wallet`) builds the same multichain tiles as
// Uniswap (sources.ts buildMultichainTiles), so it wears the same section
// with words of its own. With both on the page the scan keeps ONE copy of
// those tiles (dedupe by id); the app that got none says where they are
// ("Your holdings are shown under Uniswap.") instead of an empty frame, and
// folds into the quiet line in the one-line posture.

import { holdingsShownUnder } from '@/lib/apps-portfolio'
import { makePortfolioSection, portfolioSentence, type PortfolioWords } from './uniswap'
import type { SectionModule } from './types'

const WALLET: PortfolioWords = {
  lead: 'Your wallet holds',
  totalLabel: 'Wallet',
  nothing: 'Nothing priced in this wallet on the chains it reads. Ask it about any token in the chat.',
}

const mod: SectionModule = {
  Section: makePortfolioSection(WALLET),
  headline: ({ tiles }) => portfolioSentence(tiles, WALLET),
  quiet: ({ server, tiles, page }) => !!holdingsShownUnder(server.slug, tiles, page.bySlug) || tiles.every((t) => t.render === 'empty'),
}
export default mod
