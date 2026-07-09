import '@/lib/indexeddb-polyfill' // server-only IndexedDB shim (must load before wagmi)
import type { Metadata, Viewport } from 'next'
import './globals.css'
import './x402-design.css'
import Navigation from '@/components/Navigation'
import { AppShellMount } from '@/components/AppShell'
import Providers from '@/components/Providers'
import { Analytics } from "@vercel/analytics/next"


// Matches the SITE convention used by robots.ts / sitemap.ts / blog.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeetful.com'

const TITLE = 'Yeetful — Every dapp. One chat.'
// Meta description (Google truncates ~150–160 chars).
const DESCRIPTION =
  'Compose free MCPs — Uniswap, Snapshot, CoW, Hyperliquid — or your own into one agent that swaps, votes, and answers. Your wallet signs. Every call receipted.'
// Shorter copy for social cards (previews truncate ~125 chars, esp. on mobile).
const SOCIAL_DESCRIPTION =
  'Free first-party MCPs + your own, composed into one agent. Swaps, votes, answers — your wallet signs, every call receipted.'

export const metadata: Metadata = {
  // Required for OG/Twitter image URLs to resolve to absolute URLs.
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  keywords: ['MCP', 'Model Context Protocol', 'x402', 'agentic payments', 'USDC', 'Base', 'AI agents', 'Yeetful'],
  authors: [{ name: 'Yeetful' }],
  // Icons are file-based: app/icon.svg, app/icon.png, app/apple-icon.png —
  // Next App Router auto-generates the <link> tags, so no metadata.icons needed.
  // Card images are file-based too: app/opengraph-image.tsx + app/twitter-image.tsx
  // render the "Mega dapps are here" card — no images entries needed here.
  openGraph: {
    title: TITLE,
    description: SOCIAL_DESCRIPTION,
    type: 'website',
    url: SITE,
    siteName: 'Yeetful',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: SOCIAL_DESCRIPTION,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#09090b',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=Newsreader:ital,opsz,wght@0,6..72,500..600;1,6..72,500..600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="text-white min-h-screen antialiased">
        <Providers>
          <Navigation />
          <AppShellMount />
          {children}
        </Providers>
        {/* Vercel Analytics only ships events when deployed on Vercel; mounting
            it in dev just logs "Failed to fetch" against the missing endpoint. */}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
