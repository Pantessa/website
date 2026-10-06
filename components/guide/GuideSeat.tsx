'use client'

// A GUIDE SEAT (squad front-door, 2026-10-06): where a surface lets the
// guide speak. GUIDE lane owns this file and the card it renders; a surface
// mounts `<GuideSeat surface="…" />` once and never decides what shows —
// lib/guide does (which hint, given what this browser has already seen and
// done). Renders nothing on the server and during hydration (a crawler never
// sees a tip), nothing when no hint applies, and nothing once the hint it
// showed was dismissed.
//
// The seat is also the guide's eyes on its surface: it records
// `visited:<surface>` (AFTER it has picked, so "a visit on file" means an
// earlier page load), notes `connected` when it sees a wallet address, and
// reports shown / cta / dismissed / off to the journey log through
// lib/analytics — the hint's id, never the wallet, never the words.
//
// `posture`: /live mounts two seats (the rail on desktop, the main column on
// a phone — the rail is below the fold there); each renders only in its own
// posture, so exactly one picks.

import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { analytics } from '@/lib/analytics'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import {
  compactOnPhone,
  dismissGuideHint,
  noteGuideEvent,
  pickHintForLoad,
  turnGuideOff,
  type GuideCta,
  type GuideCtx,
  type GuideHint,
  type GuideSurface,
} from '@/lib/guide'
import { PHONE_MQ } from '@/lib/phone-shell'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { useHydrated } from '@/lib/use-hydrated'
import GuideCard from './GuideCard'
import { useGuideState } from './use-guide-state'
import './guide.css'

export type GuideSeatProps = {
  surface: GuideSurface
  /** Render only in this posture (lib/phone-shell PHONE_MQ decides). */
  posture?: 'desktop' | 'phone'
  /** The symbol page's symbol and its own buy sentence (the chart hint
   *  quotes a sentence the ladder builds, never a guess). */
  symbol?: string | null
  ask?: string | null
}

/** Which posture this viewport is, re-read on resize. Null before hydration. */
function usePosture(): 'desktop' | 'phone' | null {
  const hydrated = useHydrated()
  const [phone, setPhone] = useState<boolean | null>(null)
  useEffect(() => {
    if (!hydrated) return
    const mq = window.matchMedia(PHONE_MQ)
    const read = () => setPhone(mq.matches)
    read()
    mq.addEventListener('change', read)
    return () => mq.removeEventListener('change', read)
  }, [hydrated])
  if (!hydrated || phone === null) return null
  return phone ? 'phone' : 'desktop'
}

export default function GuideSeat({ surface, posture, symbol = null, ask = null }: GuideSeatProps) {
  const here = usePosture()
  const state = useGuideState()
  const { address } = useAccount()
  const connected = !!address
  const active = here !== null && (!posture || posture === here)

  // The pick, once, when this seat becomes active: the hint (or none), then
  // the visit goes on the record. A later render of the same load gets the
  // same answer from lib/guide, so a remount never shows a second card.
  const [hint, setHint] = useState<GuideHint | null>(null)
  useEffect(() => {
    if (!active) return
    const picked = pickHintForLoad(surface, { surface, symbol, ask, connected })
    setHint(picked.hint)
    if (picked.hint && picked.fresh) analytics.guide(picked.hint.id, 'shown')
    noteGuideEvent(`visited:${surface}`)
    // Picked once per activation on purpose; symbol/ask only word the card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, surface])

  useEffect(() => {
    if (active && connected) noteGuideEvent('connected')
  }, [active, connected])

  // An ask-shaped CTA SENDS through the connect-to-act door into the ask
  // door's sheet (LiveFeed's exact wiring); no shipped hint uses it yet.
  const openDoor = useAskDoor((s) => s.openDoor)
  const run = useCallback((text: string) => openDoor(text, { send: true, mcps: askAppSlugs(text) }), [openDoor])
  const promptHref = useCallback((text: string) => `/chat?prompt=${encodeURIComponent(text)}`, [])
  const { act, door } = useConnectToAct({ run, redirectFor: promptHref })

  if (!active || !hint) return null
  if (state.off || state.dismissed[hint.id]) return null

  const ctx: GuideCtx = { surface, symbol, ask, connected }
  const onCta = (cta: GuideCta) => {
    analytics.guide(hint.id, 'cta', cta.kind)
    // The lesson landed: the card goes and never comes back.
    dismissGuideHint(hint.id, surface)
  }
  const onDismiss = () => {
    analytics.guide(hint.id, 'dismissed')
    dismissGuideHint(hint.id, surface)
  }
  const onOff = () => {
    analytics.guide(hint.id, 'off')
    turnGuideOff()
  }

  return (
    <div className="guide-seat" data-guide-seat={surface}>
      {/* The splash and the symbol page are the one row on a phone (lib/guide
          GUIDE_COMPACT_SURFACES): the first screen there belongs to the
          boards and the chart. */}
      <GuideCard hint={hint} ctx={ctx} onCta={onCta} onDismiss={onDismiss} onOff={onOff} onAsk={act} compact={compactOnPhone(surface)} />
      {door}
    </div>
  )
}
