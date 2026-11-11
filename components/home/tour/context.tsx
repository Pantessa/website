'use client'

// THE TOUR's shared hands (squad landing, 2026-11-10; COORDINATOR-OWNED,
// frozen after the contract — ask the coordinator for a change). One
// provider around the whole tour so the eight panels share:
//
//   • `data`  — the server's TourSnapshot (counts, fees, the yield ladder,
//               the community's public posts) and `read`, THE READ's
//               snapshot (nine live quotes with sparklines) — props from the
//               page, so a panel's first paint is the server's.
//   • `act`   — run a sentence the way every chip on the site does:
//               connect-to-act (lib/use-connect-to-act — a connected wallet
//               runs it, anyone else gets the connect-only door and the ask
//               is held) into the Ask door (lib/ask-door), which SENDS it.
//               Standing rule 6: never a raw wallet modal, never a
//               `/chat?prompt=` link in the HTML.
//   • `fill`  — open the Ask door with a draft in it, NOT sent.
//   • `say`   — send TYPED words the way the top strip's Ask does: straight
//               into the Ask door, sent, with no connect step first. A
//               question is answered with no wallet; a money ask meets the
//               chat's own wall, which opens the connect door and holds the
//               ask. For free text only — a chip or a composed sentence uses
//               `act` (a job sentence must: the jobs layer's guest wall has
//               no door).
//   • `canAct`— whether a sentence's venue can run it right now
//               (lib/trade-venue-gate over the measured verdicts). A chip
//               that cannot run is not offered.
//
// ONE connect door for all eight panels: the provider renders it.

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { askAppSlugs } from '@/lib/ask-apps'
import { useAskDoor } from '@/lib/ask-door'
import { EMPTY_TOUR, type TourSnapshot } from '@/lib/home-tour'
import { EMPTY_READ, type ReadSnapshot } from '@/lib/read'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { useTradable } from '@/lib/use-tradable'

export interface TourHands {
  data: TourSnapshot
  read: ReadSnapshot
  act: (ask: string) => void
  fill: (draft: string) => void
  say: (text: string) => void
  canAct: (ask: string) => boolean
}

const Ctx = createContext<TourHands>({
  data: EMPTY_TOUR,
  read: EMPTY_READ,
  act: () => {},
  fill: () => {},
  say: () => {},
  canAct: () => true,
})

export function TourProvider({ data = EMPTY_TOUR, read = EMPTY_READ, children }: { data?: TourSnapshot; read?: ReadSnapshot; children: ReactNode }) {
  const openDoor = useAskDoor((s) => s.openDoor)
  const tradable = useTradable()
  const run = useCallback((ask: string) => openDoor(ask, { send: true, mcps: askAppSlugs(ask) }), [openDoor])
  const promptHref = useCallback((ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`, [])
  const { act, door } = useConnectToAct({ run, redirectFor: promptHref })
  const fill = useCallback((draft: string) => openDoor(draft, { mcps: askAppSlugs(draft) }), [openDoor])
  const say = useCallback((text: string) => openDoor(text, { send: true, mcps: askAppSlugs(text) }), [openDoor])
  const canAct = useCallback((ask: string) => canTradeAsk(ask, tradable), [tradable])
  const hands = useMemo<TourHands>(() => ({ data, read, act, fill, say, canAct }), [data, read, act, fill, say, canAct])
  return (
    <Ctx.Provider value={hands}>
      {children}
      {door}
    </Ctx.Provider>
  )
}

/** The tour's hands, from inside any panel. */
export function useTour(): TourHands {
  return useContext(Ctx)
}
