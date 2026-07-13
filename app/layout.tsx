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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdfdfc' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
}

/* Runs before first paint: stored choice ('yf-theme') wins, else the OS
   preference; tracks OS changes while no explicit choice is stored.
   /embed is exempt — it themes itself from the ?theme= param on .embed-root
   (embed.css). Keep in sync with components/ThemeToggle. */
const THEME_BOOTSTRAP = `(function(){try{
var d=document.documentElement;
if(location.pathname==='/embed'||location.pathname.indexOf('/embed/')===0){d.dataset.theme='dark';return}
var mq=window.matchMedia('(prefers-color-scheme: light)');
var apply=function(){
var s=null;try{s=localStorage.getItem('yf-theme')}catch(e){}
var t=(s==='light'||s==='dark')?s:(mq.matches?'light':'dark');
if(d.dataset.theme!==t)d.dataset.theme=t;
d.classList.toggle('dark',t==='dark');
};
apply();
if(mq.addEventListener)mq.addEventListener('change',apply);
new MutationObserver(apply).observe(d,{attributes:true,attributeFilter:['data-theme']});
}catch(e){}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is OWNED by the bootstrap script, never rendered as a prop:
    // a hydration-fallback client re-render of this layout would stamp the
    // literal back over the user's choice (bit us on /servers/add).
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Hanken+Grotesk:wght@400..700&family=Instrument+Serif:ital@0;1&family=Newsreader:ital,opsz,wght@0,6..72,500..600;1,6..72,500..600&display=swap"
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
