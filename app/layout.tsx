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

const TITLE = 'Yeetful — Agent Expense Accounts'
// Meta description (Google truncates ~150–160 chars).
const DESCRIPTION =
  'A spending account for every AI agent — fund it in USDC, set hard budgets and allowlists, and let it pay any MCP server per call. No API key.'
// Shorter copy for social cards (previews truncate ~125 chars, esp. on mobile).
const SOCIAL_DESCRIPTION =
  'An expense account for AI agents — fund it in USDC, set budgets and allowlists, pay any MCP server per call. No API key.'

export const metadata: Metadata = {
  // Required for OG/Twitter image URLs to resolve to absolute URLs.
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  keywords: ['MCP', 'Model Context Protocol', 'x402', 'agentic payments', 'USDC', 'Base', 'AI agents', 'Yeetful'],
  authors: [{ name: 'Yeetful' }],
  // Icons are file-based: app/icon.svg, app/icon.png, app/apple-icon.png —
  // Next App Router auto-generates the <link> tags, so no metadata.icons needed.
  openGraph: {
    title: TITLE,
    description: SOCIAL_DESCRIPTION,
    type: 'website',
    url: SITE,
    siteName: 'Yeetful',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Yeetful — Agent Expense Accounts' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: SOCIAL_DESCRIPTION,
    images: ['/og.png'],
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
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=Newsreader:ital,opsz,wght@0,6..72,500;1,6..72,500&display=swap"
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
