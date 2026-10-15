import type { ReactNode } from 'react'
import Link from 'next/link'
import Footer from '@/components/Footer'
import MarketsShell from '@/components/markets/shell/MarketsShell'
import MarketsSide from '@/components/markets/shell/MarketsSide'
import WatchlistSlot from '@/components/markets/shell/WatchlistSlot'
import SpineLink from '@/components/SpineLink'
import { LINKS_STUDIO_HREF } from '@/lib/links-href'
import { X_HANDLE } from '@/lib/social'
import { absoluteUrl } from '@/lib/site-url'
import { PROGRESS_WINDOWS, windowHref, windowLabel, type ProgressWindow } from '@/lib/progress'
import '@/components/progress/progress.css'

// The shell both progress pages share: the markets frame (spine · main ·
// the side column with the ask + account strip and the docked watchlist ·
// foot), a head with the window switch, the share line and the door to the
// link studio — the two things these pages exist to encourage.

export function ProgressFrame({ surface, children }: { surface: 'leaderboard' | 'analytics'; children: ReactNode }) {
  return (
    <MarketsShell surface={surface}>
      <main className="mkt-frame__main pg" data-progress={surface}>
        {children}
      </main>
      <MarketsSide label="Your watchlist">
        <WatchlistSlot />
      </MarketsSide>
      <div className="mkt-frame__foot">
        <Footer />
      </div>
    </MarketsShell>
  )
}

export function ProgressHead({
  eyebrow,
  title,
  sub,
  base,
  window: w,
  shareText,
}: {
  eyebrow: string
  title: string
  sub: string
  base: string
  window: ProgressWindow
  shareText: string
}) {
  const tweet = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(absoluteUrl(windowHref(base, w)))}&via=${X_HANDLE}`
  return (
    <header className="pg__head">
      <div>
        <div className="pg__eyebrow">{eyebrow}</div>
        <h1 className="pg__title">{title}</h1>
        <p className="pg__sub">{sub}</p>
      </div>
      <div className="pg__tools">
        <nav className="pg__windows" aria-label="Window">
          {PROGRESS_WINDOWS.map((win) => (
            <Link key={win} href={windowHref(base, win)} className="pg__window" aria-current={win === w ? 'true' : undefined} data-window={win}>
              {windowLabel(win)}
            </Link>
          ))}
        </nav>
        <a className="pg__btn" href={tweet} target="_blank" rel="noopener noreferrer" data-share="x">
          <svg viewBox="0 0 24 24" aria-hidden fill="currentColor"><path d="M18.9 2H22l-7.3 8.3L23 22h-6.8l-5.3-6.9L4.8 22H1.7l7.8-8.9L0 2h7l4.8 6.3L18.9 2zm-1.2 18h1.9L6.4 3.9H4.4L17.7 20z" /></svg>
          Share
        </a>
        <SpineLink href={LINKS_STUDIO_HREF} className="pg__btn pg__btn--accent" data-door="mint">
          Mint a link
        </SpineLink>
      </div>
    </header>
  )
}
