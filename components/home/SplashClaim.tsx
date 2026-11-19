'use client'

// THE HERO — the top of the home's main column (squad landing, 2026-11-10;
// lane HERO; the claim block it grew from is the front-door squad's,
// 2026-10-06). `/` is the app AND the landing, so this block has two
// postures and ONE server HTML:
//
//   • a STRANGER (`<html data-home="new">`, and the server's own HTML) reads
//     a real hero: whose page this is, HERO_LINE as the page's visible h1 at
//     display size, one sentence, three short proofs, and the doors — down
//     to the tour on this page (`#tour`) and into a real chart (the Share
//     pill and the "What is this?" door to /story left the hero 2026-11-19;
//     /story stays reachable from the footer);
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
// link); the tour is an anchor on this page.

import type { MouseEvent } from 'react'
import SpineLink from '@/components/SpineLink'
import HeroMosaic, { HeroComposer } from '@/components/home/HeroMosaic'
import { setTourPref } from '@/components/home/HomeModeSync'
import { TOUR_ANCHOR } from '@/lib/home-tour'
import { SPLASH } from '@/lib/markets-copy'
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

/** Whose page this is. Drawn in the claim on a phone and a narrow column; on
 *  a stranger's desktop home the ask + account strip carries it instead
 *  (HomeSurface `stripLead`), so it sits on the controls' row. CSS shows one. */
export function ClaimEyebrow() {
  return (
    <p className="mk-claim__eyebrow mono">
      <b>{SPLASH.eyebrow[0]}</b>{' '}
      <span>{SPLASH.eyebrow[1]}</span>
    </p>
  )
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
      {/* THE MOSAIC (2026-11-19, components/home/HeroMosaic): the tiles stand
          around this block and own every bit of state; the block itself still
          holds none. The sentence sits between the claim and its doors. */}
      <HeroMosaic>
      <div className="mk-claim__in">
        <div className="mk-claim__main">
          <ClaimEyebrow />
          <h1 className="mk-claim__h1">{SPLASH.h1}</h1>
          <p className="mk-claim__sub">{SPLASH.sub}</p>
          <HeroComposer />
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
        </div>
        <ul className="mk-claim__proofs" aria-label="Why it is safe to look">
          {SPLASH.proofs.map((p) => (
            <li key={p.lead} className="mk-claim__proof">
              <b>{p.lead}</b>{' '}
              <span>{p.rest}</span>
            </li>
          ))}
        </ul>
      </div>
      </HeroMosaic>
    </header>
  )
}
