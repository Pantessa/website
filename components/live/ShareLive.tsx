'use client'

// SHARE THIS FIGHT (GTM squad 2026-10-13, lane CARD). Copies the URL that
// carries the pick (`?t=`, the view, a battle's window — lib/live-share
// shareUrlFor, on the canonical origin), and on a phone opens the share sheet
// (navigator.share) with the plain line beside it. A card with that pick
// unfurls from the URL (app/api/og/live via app/live/page generateMetadata).
// Mounted (one line each, the coordinator's seats) in /live's view strip and
// the deck's bar.
//
// The pick comes from lib/use-market-pick when `markets` is omitted (PICK owns
// the hook). The window is read off the address bar on PRESS, never at render
// (/live's battle views keep `since` in the URL with replaceState, which the
// router never sees; the deck has no window and shares the default). Nothing
// market-shaped is rendered, so the server's HTML and the first client render
// agree whatever the memory holds — and the deck at `/` stays static.

import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_WINDOW, parseFrontWindow, type LiveView } from '@/lib/battle'
import { shareTitle, shareUrlFor } from '@/lib/live-share'
import { parsePickParam } from '@/lib/market-pick'
import { useMarketPick } from '@/lib/use-market-pick'

export interface ShareLiveProps {
  view: LiveView
  /** The deck's bar or /live's strip. */
  seat: 'live' | 'deck'
  /** The pick to carry; the seat reads it from lib/use-market-pick when omitted. */
  markets?: readonly string[]
}

type ShareState = 'idle' | 'copied' | 'shared' | 'failed'

const NOUN: Record<LiveView, string> = { tape: 'tape', front: 'front', siege: 'siege', map: 'map' }

/** The old way, for a browser without the async clipboard (or a denied one). */
function copyByHand(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

export default function ShareLive({ view, seat, markets }: ShareLiveProps) {
  const pick = useMarketPick({ seat: seat === 'live' ? 'page' : 'stage' })
  const chosen = markets ?? pick.markets
  const [state, setState] = useState<ShareState>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const settle = useCallback((s: ShareState) => {
    setState(s)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), s === 'failed' ? 6000 : 2200)
  }, [])

  const onShare = useCallback(async () => {
    const here = new URLSearchParams(window.location.search)
    const since = seat === 'live' ? parseFrontWindow(here.get('since')) : DEFAULT_WINDOW
    // Belt: a pick that is only the fallback trio while /live's own URL names
    // markets means the hook has not read the URL (yet) — the URL is the pick.
    const fromUrl = seat === 'live' && !markets && pick.source === 'fallback' ? parsePickParam(here.get('t')) : []
    const list = fromUrl.length ? fromUrl : chosen
    const href = shareUrlFor(view, list, since)
    setUrl(href)
    const text = list.length ? shareTitle(view, list, since) : 'Pantessa Live'
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    if (coarse && typeof navigator.share === 'function') {
      try {
        await navigator.share({ url: href, text, title: 'Pantessa Live' })
        settle('shared')
        return
      } catch (err) {
        // The person closed the sheet: nothing to say. Anything else falls to the copy.
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no async clipboard')
      await navigator.clipboard.writeText(href)
      settle('copied')
    } catch {
      settle(copyByHand(href) ? 'copied' : 'failed')
    }
  }, [chosen, markets, pick.source, seat, settle, view])

  const word = state === 'copied' ? 'Copied' : state === 'shared' ? 'Shared' : state === 'failed' ? 'Copy failed' : 'Share'
  const label = `Share this ${NOUN[view]}: copy a link that carries your markets`
  return (
    <>
      <style href="pantessa-share-live" precedence="default">{CSS}</style>
      <button
        type="button"
        className={`lshare lshare--${seat}${seat === 'live' ? ' live__view' : ''}${state !== 'idle' ? ` is-${state}` : ''}`}
        onClick={onShare}
        aria-label={label}
        title={state === 'failed' && url ? url : label}
        data-journey={`Share ${view}`}
        data-share-state={state}
      >
        <svg className="lshare__icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden focusable="false">
          {state === 'copied' || state === 'shared' ? (
            <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M8 10V2.5M5 5.2L8 2.2l3 3M3.5 8.5v4.2c0 .5.4.8.8.8h7.4c.4 0 .8-.3.8-.8V8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
        <span className="lshare__word">{word}</span>
      </button>
      <span className="lshare__live" role="status" aria-live="polite">
        {state === 'copied' ? 'Link copied' : state === 'shared' ? 'Shared' : state === 'failed' ? 'Could not copy the link' : ''}
      </span>
    </>
  )
}

// Scoped to .lshare. The /live seat wears the strip's own pill (.live__view —
// its height, and the 44px touch box live.css gives every view under a coarse
// pointer), its icon alone on a phone. The deck seat is an icon cell at the
// bar's right, beside the book switch, ruled off like the switch (the bar's
// four channel tabs and the switch fill a 1440 bar; a worded chip clipped The
// Siege), and a 36px round chip in the phone row (a 44px hit box). Site tokens
// only, so light mode comes free.
const CSS = `
.lshare { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; font-family: inherit; color: var(--muted); cursor: pointer; -webkit-tap-highlight-color: transparent; }
.lshare:hover { color: var(--fg); }
.lshare:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.lshare.is-copied, .lshare.is-shared { color: var(--accent); }
.lshare.is-failed { color: var(--sell, #ff5d5d); }
.lshare__icon { flex: 0 0 auto; }
.lshare__live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
.lshare--live { margin-left: 2px; font-size: 12px; font-weight: 500; color: var(--fg); }
.lshare--deck { flex: 0 0 auto; align-self: stretch; width: 44px; justify-content: center; padding: 0; margin-left: auto; border-left: 1px solid var(--line); color: var(--fg); position: relative; }
.lshare--deck .lshare__word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.lshare--deck .lshare__icon { width: 16px; height: 16px; }
.lshare--deck:hover { background: var(--surf-1); }
.lshare--deck ~ .deck__flick { margin-left: 0; }
@media (max-width: 640px) {
  .lshare--deck { align-self: center; width: 36px; height: 36px; margin: 0; border: 1px solid var(--line); border-radius: 999px; }
}
@media (max-width: 640px) and (hover: none) {
  .lshare--deck::after { content: ''; position: absolute; inset: -4px; }
}
/* A phone: the four views fill the strip's row (292px of a 328–358px column at
   360–390), so the share is its icon (the word stays for readers), 32px drawn
   and a 44px box that reaches into the gutter, never over the next view. */
@media (max-width: 400px) {
  .lshare--live { width: 32px; padding: 0; justify-content: center; }
  .lshare--live .lshare__word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .lshare--live .lshare__icon { width: 15px; height: 15px; }
}
@media (max-width: 400px) and (hover: none) {
  .lshare--live::after { inset: -4px -12px -4px 0; }
}
/* 320: the four views alone are 292px of a 288px column; with the share in the
   row each view gives 3px a side (scoped to a strip that carries the share). */
@media (max-width: 340px) {
  .live__views:has(> .lshare--live) > .live__view:not(.lshare) { padding: 0 7px; }
  .lshare--live { width: 30px; }
}
`
