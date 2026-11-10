'use client'

// THE TOUR's panel primitives (squad landing, 2026-11-10; lane STAGE owns
// this file and panel.css after the contract — the SIDES lanes USE them and
// ask STAGE for a change). Every side's panel is the same two columns: the
// words on the left (claim, body, facts, the sentences it can run, the
// doors) and a live miniature on the right (`children` — the side's own
// demo). One shape, so eight panels read as one product.
//
//   <TourPanel side={meta}> …the demo… </TourPanel>
//
// A lane that needs a different arrangement composes the smaller pieces
// (TourCopy, TourFacts, TourAsks, TourDoors, TourDemo) itself.

import type { ReactNode } from 'react'
import LandingLink from '@/components/home/LandingLink'
import { tourAnchor, tourBody, tourFacts, tourJourney, type TourAsk, type TourSideMeta } from '@/lib/home-tour'
import { useTour } from './context'
import './panel.css'

export function TourPanel({ side, children, demoLabel }: { side: TourSideMeta; children?: ReactNode; demoLabel?: string }) {
  return (
    <div className="tp-seat" data-tour-panel={side.id}>
      <article className="tp" aria-labelledby={`${tourAnchor(side.id)}-claim`}>
        <TourCopy side={side} />
        {children != null && <TourDemo label={demoLabel ?? `${side.label}, live`}>{children}</TourDemo>}
      </article>
    </div>
  )
}

/** The words column: claim, body, facts, sentences, doors. */
export function TourCopy({ side, children }: { side: TourSideMeta; children?: ReactNode }) {
  const { data } = useTour()
  return (
    <div className="tp__copy">
      <h3 className="tp__claim" id={`${tourAnchor(side.id)}-claim`}>
        {side.claim}
      </h3>
      <p className="tp__body">{tourBody(side, data)}</p>
      <TourFacts side={side} />
      {children}
      <TourAsks side={side} />
      <TourDoors side={side} />
    </div>
  )
}

export function TourFacts({ side }: { side: TourSideMeta }) {
  const { data } = useTour()
  const facts = tourFacts(side, data)
  if (!facts.length) return null
  return (
    <ul className="tp__facts">
      {facts.map((f) => (
        <li key={f} className="tp__fact">
          {f}
        </li>
      ))}
    </ul>
  )
}

/** One sentence as a chip. Not offered when its venue cannot run it. */
export function TourAskChip({ side, ask, tone = 'plain' }: { side: TourSideMeta; ask: TourAsk; tone?: 'plain' | 'accent' }) {
  const { act, canAct } = useTour()
  if (!canAct(ask.ask)) return null
  return (
    <button type="button" className={`tp__chip tp__chip--${tone}`} onClick={() => act(ask.ask)} title={ask.ask} data-ask={ask.ask} data-journey={tourJourney(side.id, ask.label)}>
      <span className="tp__chiplabel">{ask.label}</span>
      <span className="tp__chipvia mono">{ask.via}</span>
    </button>
  )
}

/** The side's sentences, as chips, with the line that says what a chip is. */
export function TourAsks({ side, asks = side.asks }: { side: TourSideMeta; asks?: TourAsk[] }) {
  const { canAct } = useTour()
  const live = asks.filter((a) => canAct(a.ask))
  if (!live.length) return null
  return (
    <div className="tp__asks">
      <p className="tp__askslab mono">Try one. Your wallet signs it.</p>
      <div className="tp__chips">
        {live.map((a) => (
          <TourAskChip key={a.ask} side={side} ask={a} />
        ))}
      </div>
    </div>
  )
}

/** The side's doors: one primary, the rest quiet. An on-page anchor is a
 *  plain link; everything else is a LandingLink (a signed-in page opens the
 *  unified door aimed at itself; a public page is a plain link). */
export function TourDoors({ side }: { side: TourSideMeta }) {
  return (
    <div className="tp__doors">
      {side.doors.map((d) => {
        const cls = `tp__door tp__door--${d.kind}`
        const inner = (
          <>
            {d.label} <span className="tp__arrow" aria-hidden>→</span>
          </>
        )
        return d.href.startsWith('#') ? (
          <a key={d.href} href={d.href} className={cls} data-journey={tourJourney(side.id, d.label)}>
            {inner}
          </a>
        ) : (
          <LandingLink key={d.href} href={d.href} className={cls} prefetch={false} data-journey={tourJourney(side.id, d.label)}>
            {inner}
          </LandingLink>
        )
      })}
    </div>
  )
}

/** The miniature's frame. `label` names it for a screen reader. */
export function TourDemo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tp__demo" role="group" aria-label={label}>
      {children}
    </div>
  )
}

/** The contract's placeholder demo: what a side shows until its lane lands. */
export function TourDemoStub({ side }: { side: TourSideMeta }) {
  return (
    <p className="tp__stub mono" data-tour-stub={side.id}>
      {side.label}: the live miniature lands here.
    </p>
  )
}
