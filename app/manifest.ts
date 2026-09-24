import type { MetadataRoute } from 'next'
import { THEME_COLORS } from '@/lib/phone-shell'

// Add to Home Screen opens a real standalone app (squad mobile-native,
// 2026-09-24; SHELL owns this). Icons are the Emerald Cut app icon from the
// brand kit (public/brand/emerald/png): the 192 and 512 are the kit's
// rounded-square icon (purpose `any`); the maskable one is the same mark on a
// full-bleed square of its own background at 80% so Android's masks keep the
// stone whole. start_url is the app's front door — the public markets
// screen, the first seat of the tab bar; a returning wallet acts on connect
// there and the spine takes it anywhere else.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Pantessa',
    short_name: 'Pantessa',
    description: 'You have an intent. We do the rest. Every dapp, one chat — swaps, stocks, perps and protections your wallet signs.',
    start_url: '/markets',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: THEME_COLORS.dark,
    theme_color: THEME_COLORS.dark,
    categories: ['finance'],
    icons: [
      { src: '/brand/emerald/png/pantessa-app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/emerald/png/pantessa-app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/emerald/png/pantessa-app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
