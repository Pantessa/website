import '@/lib/indexeddb-polyfill' // server-only IndexedDB shim (must load before wagmi)
import type { Metadata, Viewport } from 'next'
import './globals.css'
import './x402-design.css'
import Navigation from '@/components/Navigation'
import Providers from '@/components/Providers'
import { Analytics } from "@vercel/analytics/next"


export const metadata: Metadata = {
  title: 'Yeetful — MCP Power Chat',
  description: 'Combine multiple MCP servers into a single, supercharged AI chat experience.',
  keywords: ['MCP', 'Model Context Protocol', 'AI Chat', 'Yeetful'],
  authors: [{ name: 'Yeetful' }],
  icons: { icon: '/favicon.ico' },
  openGraph: {
    title: 'Yeetful — MCP Power Chat',
    description: 'Combine multiple MCP servers into a supercharged AI chat.',
    type: 'website',
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
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="text-white min-h-screen antialiased">
        <Providers>
          <Navigation />
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
