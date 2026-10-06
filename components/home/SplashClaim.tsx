'use client'

// The claim block at the top of the splash (squad front-door, 2026-10-06;
// SPLASH lane). `/` is the app now — the markets index in the shell — and a
// visitor landing cold still has to know in one glance what this is. So the
// main column opens on HERO_LINE as the page's visible h1, ONE sentence in
// the voice of lib/markets-copy (the SPLASH block; no new slogan), and the
// door to the long-form story (/story). Budget: ≤72px tall on desktop so the
// live pulse stays above the fold at 1440×900; one line + the door on a
// phone (the sentence hides below 640px but stays in the server HTML, so a
// crawler and a JS-off visitor still read it).
//
// Returning visitors, and anyone with a wallet or a session, get the
// one-line version: the claim is for the stranger. "Been here before" is a
// flag this browser writes on its first visit (SPLASH_SEEN_KEY) — until
// lib/guide exposes `visited.home` (GUIDE lane), when this reads that
// instead. The server renders the full block (no hydration guess); the
// collapse is a post-hydration decision, like the boot hold.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { useSession } from '@/lib/session'
import { STORY_HREF } from '@/lib/markets'
import { SPLASH } from '@/lib/markets-copy'

/** Written once this browser has seen the splash; read on the next visit. */
export const SPLASH_SEEN_KEY = 'pantessa.splash.seen'

export default function SplashClaim() {
  const { status } = useSession()
  const { address } = useAccount()
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    try {
      setSeen(window.localStorage.getItem(SPLASH_SEEN_KEY) === '1')
      window.localStorage.setItem(SPLASH_SEEN_KEY, '1')
    } catch {
      // storage blocked: every visit is a first visit
    }
  }, [])
  const compact = seen || status === 'authed' || !!address
  return (
    <header className="mk-claim" data-splash-claim data-compact={compact || undefined}>
      <h1 className="mk-claim__h1">{SPLASH.h1}</h1>
      <p className="mk-claim__sub">{SPLASH.sub}</p>
      {/* A brochure page, not the shell: a plain link is right here. No
          prefetch — every visitor would otherwise pull the story's payload. */}
      <Link href={STORY_HREF} className="mk-claim__door mono" prefetch={false} data-splash-door>
        {SPLASH.door} <span aria-hidden>→</span>
      </Link>
    </header>
  )
}
