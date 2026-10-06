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
// one-line version: the claim is for the stranger. "Been here before" is the
// guide's own record (lib/guide `visited.home`, written by the home seat the
// first time it mounts) — read ONCE, at mount, straight from the store:
// GuideSeat notes this visit a render later, and a live subscription
// (useGuideState) would turn a stranger's first visit into a return visit
// mid-page. The server renders the full block (no hydration guess); the
// collapse is a post-hydration decision, like the boot hold.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { useSession } from '@/lib/session'
import { getGuideState } from '@/lib/guide'
import { STORY_HREF } from '@/lib/markets'
import { SPLASH } from '@/lib/markets-copy'

export default function SplashClaim() {
  const { status } = useSession()
  const { address } = useAccount()
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    // Once, before the home seat's own `visited:home` lands on the record.
    setSeen(!!getGuideState().visited.home)
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
