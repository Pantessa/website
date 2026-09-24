import '@/lib/indexeddb-polyfill' // server-only IndexedDB shim (must load before wagmi)
import type { Metadata, Viewport } from 'next'
import './globals.css'
import './x402-design.css'
import './native-shell.css' // the phone frame + touch rules (squad mobile-native, 2026-09-24); after the design sheet on purpose
import { Suspense } from 'react'
import Navigation from '@/components/Navigation'
import AskDoor from '@/components/AskDoor'
import { AppShellMount } from '@/components/AppShell'
import Providers from '@/components/Providers'
import ViaTracker from '@/components/ViaTracker'
import JourneyTracker from '@/components/JourneyTracker'
import PhoneShellMount from '@/components/mobile/PhoneShellMount'
import { THEME_COLORS } from '@/lib/phone-shell'
import { Analytics } from "@vercel/analytics/next"


// Matches the SITE convention used by robots.ts / sitemap.ts / blog.
import { SITE_URL as SITE } from '@/lib/site-url'

const TITLE = 'Pantessa — Every dapp. One chat.'
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
  keywords: ['MCP', 'Model Context Protocol', 'x402', 'agentic payments', 'USDC', 'Base', 'AI agents', 'Pantessa'],
  authors: [{ name: 'Pantessa' }],
  // Icons are file-based: app/icon.svg, app/icon.png, app/apple-icon.png —
  // Next App Router auto-generates the <link> tags, so no metadata.icons needed.
  // Card images are file-based too: app/opengraph-image.tsx + app/twitter-image.tsx
  // render the "The chart that executes." card (lib/markets-copy) — no images entries needed here.
  openGraph: {
    title: TITLE,
    description: SOCIAL_DESCRIPTION,
    type: 'website',
    url: SITE,
    siteName: 'Pantessa',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: SOCIAL_DESCRIPTION,
  },
  // Add to Home Screen opens a real standalone app (app/manifest.ts is the
  // manifest; squad mobile-native, 2026-09-24). black-translucent: the page
  // paints under the status bar, so the bar wears the site's own theme in
  // both modes instead of iOS's opaque black/white strip — the phone frame
  // pads env(safe-area-inset-top) for exactly this (app/native-shell.css).
  appleWebApp: { capable: true, title: 'Pantessa', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Without viewport-fit=cover iOS reports every env(safe-area-inset-*) as 0,
  // so the spine bar / composer / dashboard paddings that reserve the home
  // indicator were dead code on the phones they were written for.
  viewportFit: 'cover',
  // The OS-preference pair is the pre-JS fallback; THEME_BOOTSTRAP below
  // writes a media-less meta FIRST in <head> that follows the SITE theme
  // (data-theme), so a light-site/dark-OS visitor gets a light status bar.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
}

/* Runs before first paint: stored choice ('yf-theme') wins, else the OS
   preference; tracks OS changes while no explicit choice is stored.
   /embed is exempt — it themes itself from the ?theme= param on .embed-root
   (embed.css). Keep in sync with components/ThemeToggle.
   It also owns the document's `theme-color` (squad mobile-native, 2026-09-24):
   a media-less meta, first in <head>, set to the theme's --bg on every
   data-theme change (the MutationObserver), so the browser chrome and the
   standalone status bar follow the SITE theme, not only the OS. */
const THEME_BOOTSTRAP = `(function(){try{
var d=document.documentElement;
if(location.pathname==='/embed'||location.pathname.indexOf('/embed/')===0){d.dataset.theme='dark';return}
var mq=window.matchMedia('(prefers-color-scheme: light)');
var apply=function(){
var s=null;try{s=localStorage.getItem('yf-theme')}catch(e){}
var t=(s==='light'||s==='dark')?s:(mq.matches?'light':'dark');
if(d.dataset.theme!==t)d.dataset.theme=t;
d.classList.toggle('dark',t==='dark');
var m=document.querySelector('meta[name="theme-color"]:not([media])');
if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.insertBefore(m,document.head.firstChild)}
var c=t==='light'?'${THEME_COLORS.light}':'${THEME_COLORS.dark}';
if(m.getAttribute('content')!==c)m.setAttribute('content',c);
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
          {/* Share-loop attribution: cookies ?via= on any landing so the
              visitor's first sign-in can stamp where they came from. Suspense
              because useSearchParams() must not block static shells. */}
          <Suspense fallback={null}>
            <ViaTracker />
          </Suspense>
          {/* The journey log: views, clicks, time on page and errors, with no
              cookie (lib/journey.ts). What /dashboard/admin/flows reads. */}
          <JourneyTracker />
          {/* The phone shell's global mount: the keyboard → html[data-keyboard]
              + --kb-inset, route scroll memory for the frame's scroller, the
              theme-color belt (components/mobile/PhoneShellMount). No UI. */}
          <PhoneShellMount />
          <Navigation />
          <AppShellMount />
          {children}
          {/* Ask from anywhere: the docked pill + ⌘K sheet on every brochure
              page (hides itself on /chat, /embed, /i — see lib/ask-door). */}
          <AskDoor />
        </Providers>
        {/* Vercel Analytics only ships events when deployed on Vercel; mounting
            it in dev just logs "Failed to fetch" against the missing endpoint. */}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
