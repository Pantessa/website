import type { MetadataRoute } from 'next'
import { THEME_COLORS } from '@/lib/phone-shell'
import { MARKETS_HREF } from '@/lib/markets'

// Add to Home Screen opens a real standalone app (squad mobile-native,
// 2026-09-24; SHELL owns this). Icons are the Cut P app icon from the
// brand kit (public/brand/cut-p/png): the 192 and 512 are the kit's
// rounded-square icon (purpose `any`); the maskable one is the same mark on a
// full-bleed square of its own background, inside the 80% safe circle, so
// Android's masks keep the letter whole. start_url is the app's front door — the markets splash at
// `/` (lib/markets MARKETS_HREF), the first seat of the tab bar; a returning
// wallet acts on connect there and the spine takes it anywhere else.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Pantessa',
    short_name: 'Pantessa',
    description: 'You have an intent. We do the rest. Every dapp, one chat — swaps, stocks, perps and protections your wallet signs.',
    start_url: MARKETS_HREF,
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: THEME_COLORS.dark,
    theme_color: THEME_COLORS.dark,
    categories: ['finance'],
    icons: [
      { src: '/brand/cut-p/png/pantessa-app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/cut-p/png/pantessa-app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/cut-p/png/pantessa-app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
