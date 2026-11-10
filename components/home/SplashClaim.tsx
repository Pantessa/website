'use client'

// THE HERO — the top of the home's main column (squad landing, 2026-11-10;
// lane HERO; the claim block it grew from is the front-door squad's,
// 2026-10-06). `/` is the app AND the landing, so this block has two
// postures and ONE server HTML:
//
//   • a STRANGER (`<html data-home="new">`, and the server's own HTML) reads
//     a real hero: whose page this is, HERO_LINE as the page's visible h1 at
//     display size, one sentence, three short proofs, and the doors — down
//     to the tour on this page (`#tour`), into a real chart, the share, and
//     the long-form story;
//   • someone who USES the app (`data-home="return"`) keeps the one line it
//     has always been, plus one small door back to the tour.
//
// The posture is the attribute, never React state: an inline script sets it
// before first paint (lib/home-mode), hero.css folds this markup on
// `:root[data-home='return']`, and nothing here reads storage, the session
// or the guide's record — so the block cannot change height after it is
// drawn. Words: lib/markets-copy SPLASH. Look: ./hero.css.
//
// Doors (standing rule 6): the chart is a SpineLink (a public page: a plain
// link); the tour is an anchor on this page; /story is a brochure page, not
// the app, so it stays a plain un-prefetched link (a SpineLink would hold a
// stranger at the sign-in door for a page that needs none).

import Link from 'next/link'
import type { MouseEvent } from 'react'
import SpineLink from '@/components/SpineLink'
import ShareActions from '@/components/ShareActions'
import { setTourPref } from '@/components/home/HomeModeSync'
import { TOUR_ANCHOR } from '@/lib/home-tour'
import { STORY_HREF } from '@/lib/markets'
import { SPLASH } from '@/lib/markets-copy'
import { marketsPost } from '@/lib/share-posts'
import './hero.css'

const TOUR_HREF = `#${TOUR_ANCHOR}`

/** A plain pointer click: the page glides to the tour. A keyboard press
 *  (detail 0) or a modified click keeps the browser's own anchor jump, which
 *  also moves the reading position for the next Tab. The phone frame scrolls
 *  inside an element, so this is scrollIntoView, never window.scrollTo. */
function glides(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.detail > 0 && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}

function glideToTour() {
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  document.getElementById(TOUR_ANCHOR)?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
}

export default function SplashClaim() {
  // The stranger's primary door: the tour is already open under THE READ.
  const toTour = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!glides(e) || !document.getElementById(TOUR_ANCHOR)) return
    e.preventDefault()
    glideToTour()
  }
  // The returning visitor's door: ask for the tour back (their own choice,
  // remembered), then go to it. The page unfolds on the attribute at once;
  // the glide waits one frame for that layout.
  const reopenTour = (e: MouseEvent<HTMLAnchorElement>) => {
    setTourPref('open')
    if (!glides(e)) return
    e.preventDefault()
    requestAnimationFrame(glideToTour)
  }
  return (
    <header className="mk-claim" data-splash-claim>
      <div className="mk-claim__in">
        <div className="mk-claim__main">
          <p className="mk-claim__eyebrow mono">
            <b>{SPLASH.eyebrow[0]}</b>{' '}
            <span>{SPLASH.eyebrow[1]}</span>
          </p>
          <h1 className="mk-claim__h1">{SPLASH.h1}</h1>
          <p className="mk-claim__sub">{SPLASH.sub}</p>
          <div className="mk-claim__doors">
            <a href={TOUR_HREF} className="mk-claim__go" onClick={toTour} data-hero-door="tour" data-journey={`Hero: ${SPLASH.tourDoor}`}>
              {SPLASH.tourDoor} <span aria-hidden>↓</span>
            </a>
            <SpineLink href={`/t/${SPLASH.chartSymbol}`} className="mk-claim__try" prefetch={false} data-hero-door="chart" data-journey={`Hero: ${SPLASH.chartDoor} ${SPLASH.chartSymbol}`}>
              {SPLASH.chartDoor} <span className="mk-claim__sym mono">{SPLASH.chartSymbol}</span> <span aria-hidden>→</span>
            </SpineLink>
          </div>
        </div>
        <div className="mk-claim__acts">
          <a href={TOUR_HREF} className="mk-claim__tour mono" onClick={reopenTour} data-hero-door="reopen" data-journey={`Hero: ${SPLASH.returnTour}`}>
            {SPLASH.returnTour} <span aria-hidden>↓</span>
          </a>
          {/* The board's own share. A phone's line has no room for it and hides it. */}
          <ShareActions post={marketsPost()} variant="pill" label="Share" surface="splash" className="mk-claim__share" />
          {/* A brochure page, not the shell: a plain link is right here. No
              prefetch — every visitor would otherwise pull the story's payload. */}
          <Link href={STORY_HREF} className="mk-claim__door mono" prefetch={false} data-splash-door>
            {SPLASH.door} <span aria-hidden>→</span>
          </Link>
        </div>
        <ul className="mk-claim__proofs" aria-label="What it never asks of you">
          {SPLASH.proofs.map((p) => (
            <li key={p.lead} className="mk-claim__proof">
              <b>{p.lead}</b>{' '}
              <span>{p.rest}</span>
            </li>
          ))}
        </ul>
      </div>
    </header>
  )
}
