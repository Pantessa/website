'use client'

// The trade buttons beside a call (squad called-gtm, lane TRADE, 2026-11-16).
//
// A follower lands on a call; the next press is the trade for that market. The
// rules are lib/called-it/acts (pure, pinned): a bull call offers the buy, a
// bear call the sell (only when the wallet holds it) and the short on
// Hyperliquid (only where a perp is listed); every sentence is the app's own
// composer's and passes canTradeAsk. Where nothing can run, this renders
// NOTHING.
//
// A press goes through connect to act (lib/use-connect-to-act: a connected
// wallet runs it, anyone else gets the connect-only door and the ask is held),
// then to the app the way the symbol page sends its asks since #1073: the
// arrival handoff (same tab, one shot) to /chat with the apps the sentence
// needs (lib/symbol-ask symbolAskApps). Where the handoff fence refuses the
// sending page, it degrades to the `/chat?prompt=` prefill, like every other
// sender: the visitor lands on the sentence and presses send.
//
// The label is the sentence. No "follow", no "copy": the button says the order.
import { useCallback, useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ARRIVAL_APP_HREF, writeArrivalIntent } from '@/lib/arrival-intent'
import { callActCaption, callActsFor } from '@/lib/called-it/acts'
import { chartPairFor } from '@/lib/charts'
import { symbolAskApps } from '@/lib/symbol-ask'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { useHeld } from '@/lib/use-held'
import { useHydrated } from '@/lib/use-hydrated'
import { useTradable } from '@/lib/use-tradable'
import './call-acts.css'

export interface CallActsProps {
  symbol: string
  stance: 'bull' | 'bear'
  /** Whose call this is: the journey label, and the caption's second sentence ("@h has no part in this button", review F7). */
  handle?: string
  postId?: string
  /** `row` = chips in a line (a card's foot); `stack` = full-width buttons (a phone sheet, a hero). */
  variant?: 'row' | 'stack'
  className?: string
}

const promptHref = (ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`

export default function CallActs({ symbol, stance, handle, postId, variant = 'row', className }: CallActsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const hydrated = useHydrated()
  const tradable = useTradable()
  const held = useHeld()
  const pair = useMemo(() => chartPairFor(symbol), [symbol])
  const run = useCallback(
    (ask: string) => {
      const handed = writeArrivalIntent({ text: ask, from: pathname ?? '', mcps: symbolAskApps(ask, pair) })
      router.push(handed ? ARRIVAL_APP_HREF : promptHref(ask))
    },
    [pathname, router, pair],
  )
  const { act, door } = useConnectToAct({ run, redirectFor: promptHref })
  // Holdings and the measured verdicts are the browser's: the server and the hydration render draw no chip, so they match.
  const acts = hydrated ? callActsFor(pair, stance, { tradable, held }) : []
  if (!acts.length) return door ? <>{door}</> : null
  return (
    <div className={`xca${className ? ` ${className}` : ''}`} data-variant={variant} data-called-acts={acts.length} data-call-handle={handle || undefined} data-call-post={postId || undefined}>
      <div className="xca__chips" role="group" aria-label={`Trade ${pair?.symbol ?? symbol}`}>
        {acts.map((a) => (
          <a
            key={a.ask}
            className={`xca__chip xca__chip--${a.tone}`}
            href={promptHref(a.ask)}
            onClick={(e) => {
              // A real link (a new tab, no JS gets the prefill); a plain press sends through the door.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
              e.preventDefault()
              act(a.ask)
            }}
            data-ask={a.ask}
            data-journey={`called_act_${a.side}`}
          >
            {a.ask}
          </a>
        ))}
      </div>
      <p className="xca__note">{callActCaption(handle)}</p>
      {door}
    </div>
  )
}
