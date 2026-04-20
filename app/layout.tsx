import type { Metadata, Viewport } from 'next'
import './globals.css'
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
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-zinc-950 text-white min-h-screen antialiased">
        <Providers>
          <Navigation />
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
