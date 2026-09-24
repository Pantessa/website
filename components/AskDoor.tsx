'use client'

// The ask door — Pantessa's composer on every page (2026-09-11).
//
// Three ways in, one sheet:
//   • the docked pill at the bottom of every brochure page (a fake composer:
//     mark · placeholder · mic · ⌘K), which steps aside where a composer
//     already lives (/chat, /embed, /i, the dashboard's DashAskBar);
//   • the "Ask" button in the site nav + the mobile drawer;
//   • ⌘K / Ctrl+K anywhere the door is allowed.
//
// The sheet is a command palette in its idle state (composer + mic +
// context chips — on a symbol page the chips are that symbol's real trade
// asks) and becomes the runtime once you send: the SAME ChatInterface the
// intent-link runtime mounts in `simple` mode takes the ask as an injected
// prompt, so the guarded build and the sign card appear right here, over the
// page you were reading. Connect to act, sign in to keep (rule 6 — every
// sign-in CTA inside ChatInterface is the unified door). Chart / markets
// asks never burn a turn: the door navigates to /t/<symbol>, which is the
// better answer (chart + tabs + order panel) for a visitor who isn't in the
// chat. The door is its own thread — it never appends into whatever chat
// the visitor last had open (the Trade panel's rule).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import SpineLink from '@/components/SpineLink'
import { usePathname, useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { ArrowUp, ArrowUpRight, Mic, X } from 'lucide-react'
import { PantessaMark } from '@/components/Logo'
import ShareButton from '@/components/ShareButton'
import VoiceButton from '@/components/VoiceButton'
import Sheet from '@/components/mobile/Sheet'
import { PHONE_MQ, isPhoneViewport } from '@/lib/phone-shell'
import { analytics } from '@/lib/analytics'
import { askDoorChips, askDoorHidden, askDoorNav, askDoorPillHidden, askDoorPlaceholder, askDoorSymbol, useAskDoor } from '@/lib/ask-door'
import { normalizeSpokenAsk } from '@/lib/voice-ask'
import { useYeetfulStore, type McpServer } from '@/lib/store'
import { FREE_FLEET_FALLBACK } from '@/lib/free-fleet'
import { missingAppIds } from '@/lib/ask-apps'
import { CATALOG } from '@/lib/mcp-data'
import type { InjectedPrompt } from '@/lib/trade-asks'
import { canSellAsk } from '@/lib/sell-gate'
import { useHeld } from '@/lib/use-held'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useTradable } from '@/lib/use-tradable'

// ChatInterface is heavy (wagmi, the store, every card); it loads only when
// a visitor actually sends something through the door.
const ChatInterface = dynamic(() => import('@/components/ChatInterface'), { ssr: false })

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The phone posture, live (false on the server and until the first client
 *  read, so the server HTML never guesses). */
function usePhonePosture(): boolean {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(PHONE_MQ)
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}

/** QA's drive contract (squad mobile-native): a labeled tap that opens THE
 *  Sheet wears `data-sheet-open="<the Sheet's id>"`. The door is a Sheet only
 *  on a phone and only when no page has docked it (on /t it lands in Ask the
 *  chart instead), so the attribute is there exactly then. */
function useDoorSheetOpener(): { 'data-sheet-open'?: 'ask' } {
  const phone = usePhonePosture()
  const docked = useAskDoor((s) => !!s.dock)
  return phone && !docked ? { 'data-sheet-open': 'ask' } : {}
}

/** The nav / drawer / markets-rail trigger. Renders nothing where the door
 *  is hidden. `rail` is the nav pill docked in the markets watchlist column
 *  (the strip above the watchlist — the brochure nav is gone there). On a
 *  phone the rail trigger IS the screen's ask field (squad mobile-native,
 *  2026-09-24): it fills the top bar with the page's own placeholder, and the
 *  floating pill steps aside wherever one is on the page (x402-design.css,
 *  `body:has([data-ask-door="rail"])`), so the door never covers the data. */
export function AskDoorTrigger({ variant = 'nav' }: { variant?: 'nav' | 'drawer' | 'rail' }) {
  const pathname = usePathname()
  const openDoor = useAskDoor((s) => s.openDoor)
  const opener = useDoorSheetOpener()
  if (askDoorHidden(pathname)) return null
  return (
    <button
      type="button"
      className={variant === 'drawer' ? 'nav__tab drawer__ask' : variant === 'rail' ? 'nav__ask mkt-frame__ask' : 'nav__ask'}
      onClick={() => openDoor()}
      aria-label="Ask Pantessa"
      title="Ask Pantessa — one sentence, guarded build, your wallet signs (⌘K)"
      data-ask-door={variant}
      {...opener}
    >
      <span className="nav__ask-mark" aria-hidden="true">
        <PantessaMark size={16} />
      </span>
      <span className={variant === 'rail' ? 'mkt-frame__askword' : undefined}>Ask</span>
      {variant === 'rail' && (
        <span className="mkt-frame__askhint" aria-hidden="true">
          {askDoorPlaceholder(pathname)}
        </span>
      )}
      {variant !== 'drawer' && (
        <kbd className="nav__ask-kbd mono" aria-hidden="true">
          ⌘K
        </kbd>
      )}
    </button>
  )
}

/** The docked pill — a composer-shaped invitation at the bottom of the page. */
function AskDoorPill() {
  const pathname = usePathname()
  const open = useAskDoor((s) => s.open)
  const openDoor = useAskDoor((s) => s.openDoor)
  const opener = useDoorSheetOpener()
  if (askDoorPillHidden(pathname) || open) return null
  return (
    <button
      type="button"
      className="askdoor-pill"
      onClick={() => openDoor()}
      aria-label="Ask Pantessa"
      title="Ask Pantessa — one sentence, guarded build, your wallet signs"
      data-ask-door="pill"
      {...opener}
    >
      <span className="askdoor-pill__mark" aria-hidden="true">
        <PantessaMark size={22} />
      </span>
      <span className="askdoor-pill__text">{askDoorPlaceholder(pathname)}</span>
      <span className="askdoor-pill__short">Ask</span>
      <span className="askdoor-pill__mic" aria-hidden="true">
        <Mic className="h-3.5 w-3.5" />
      </span>
      <kbd className="askdoor-pill__kbd mono" aria-hidden="true">
        ⌘K
      </kbd>
    </button>
  )
}

/** The directory's fallback when /api/servers is down — the /i runtime's own. */
const STATIC_SERVERS: McpServer[] = [...FREE_FLEET_FALLBACK, ...CATALOG]

function AskDoorSheet() {
  const pathname = usePathname()
  const router = useRouter()
  const open = useAskDoor((s) => s.open)
  const draft = useAskDoor((s) => s.draft)
  const setDraft = useAskDoor((s) => s.setDraft)
  const closeDoor = useAskDoor((s) => s.closeDoor)
  const openDoor = useAskDoor((s) => s.openDoor)
  const fire = useAskDoor((s) => s.fire)
  const takeFire = useAskDoor((s) => s.takeFire)
  const setCurrentChatId = useYeetfulStore((s) => s.setCurrentChatId)
  const { address: walletAddress, status: walletStatus } = useAccount()
  const [holdTick, setHoldTick] = useState(0)
  const servers = useYeetfulStore((s) => s.servers)
  const setServers = useYeetfulStore((s) => s.setServers)
  const activeServerIds = useYeetfulStore((s) => s.activeServerIds)
  const setActiveServerIds = useYeetfulStore((s) => s.setActiveServerIds)

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Live = an ask was sent; the sheet is the runtime until closed.
  const [prompt, setPrompt] = useState<InjectedPrompt | null>(null)
  const [voiceLive, setVoiceLive] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const postureRef = useRef<boolean | null>(null)
  const hidden = askDoorHidden(pathname)
  const briefChips = useAskDoor((s) => s.briefChips)
  // A Sell suggestion only for a wallet that holds the token (lib/sell-gate).
  const held = useHeld()
  const tradable = useTradable()
  const chips = useMemo(
    () => askDoorChips(pathname, briefChips).filter((c) => canSellAsk(c.ask, held) && canTradeAsk(c.ask, tradable)),
    [pathname, briefChips, held, tradable],
  )
  const sym = askDoorSymbol(pathname)
  const placeholder = askDoorPlaceholder(pathname)
  // The phone Sheet's one-row composer is ~240px wide: the long placeholder
  // wrapped to a clipped second line there. A short one fits.
  const phonePlaceholder = sym ? `Ask about ${sym}…` : 'Ask Pantessa anything…'

  // ⌘K / Ctrl+K toggles; Esc closes the idle sheet (a live runtime keeps its
  // build — close it with the button so a stray Esc never loses a sign card).
  useEffect(() => {
    if (hidden) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const s = useAskDoor.getState()
        if (s.open) s.closeDoor()
        else s.openDoor()
        return
      }
      if (e.key === 'Escape' && useAskDoor.getState().open && !prompt && !voiceLive) closeDoor()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hidden, prompt, voiceLive, closeDoor])

  // A route change closes the door and drops the live runtime (the /t page
  // it navigated to owns the next ask).
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    closeDoor()
    setPrompt(null)
  }, [pathname, closeDoor])

  // Open: focus the composer, lock the page scroll. Close: drop the runtime.
  useEffect(() => {
    if (!open) {
      setPrompt(null)
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [open])

  // Auto-grow the textarea (one line to four).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [draft, open])

  const send = useCallback(
    (raw: string) => {
      const text = normalizeSpokenAsk(raw).trim()
      if (!text) return
      const href = askDoorNav(text)
      if (href) {
        analytics.askDoor(text, 'nav', pathname)
        setDraft('')
        closeDoor()
        router.push(href)
        return
      }
      analytics.askDoor(text, 'run', pathname)
      setCurrentChatId(null)
      setDraft('')
      setPrompt({ text, send: true, at: Date.now() })
    },
    [pathname, router, closeDoor, setDraft, setCurrentChatId],
  )

  // A surface opened the door WITH an ask to run (openDoor(text, { send:
  // true }) — the wallet window's flag fixes and its rebalance): send it
  // as the sheet opens. Taken before sending so a re-render can't fire twice.
  // A fired ask may name the MCPs its gate needs (a bridge leg → NEAR
  // Intents). Turn them on FIRST — the same slug→id step the /i runtime
  // does — then send once the set carries them; an unknown slug (a stale
  // directory) releases the send anyway, and the refusal copy says what to
  // add ([[chat-id-load-race]]: a definitive settle, never a hostage ask).
  useEffect(() => {
    if (!open || !fire?.mcps?.length || servers.length > 0) return
    fetch('/api/servers')
      .then((r) => r.json())
      .then((data: McpServer[]) => setServers(data.length > 0 ? data : STATIC_SERVERS))
      .catch(() => setServers(STATIC_SERVERS))
  }, [open, fire, servers.length, setServers])
  useEffect(() => {
    if (!open || !fire || hidden) return
    // A wallet that is KNOWN but still settling (wagmi reads 'connecting'
    // for seconds after a load while the address is already there) would
    // send the ask without it — the runtime answers "connect your wallet",
    // then re-sends on connect. Hold the send for the wallet, up to 10s.
    const elapsed = Date.now() - fire.at
    if (walletAddress && walletStatus !== 'connected' && elapsed < 10_000) {
      const t = setTimeout(() => setHoldTick((n) => n + 1), 10_000 - elapsed)
      return () => clearTimeout(t)
    }
    const want = fire.mcps ?? []
    if (want.length > 0) {
      if (servers.length === 0) return
      const missing = missingAppIds(want, servers, activeServerIds)
      if (missing.length > 0) {
        setActiveServerIds([...activeServerIds, ...missing])
        return
      }
    }
    takeFire()
    send(fire.text)
  }, [open, fire, hidden, takeFire, send, servers, activeServerIds, setActiveServerIds, walletAddress, walletStatus, holdTick])

  // The posture is read once per opening (squad mobile-native, 2026-09-24):
  // a phone gets THE Sheet (components/mobile/Sheet — a tap outside, a swipe
  // down, the back gesture, Escape and its close button all dismiss it, the
  // way every phone panel closes), a desktop keeps the ⌘K palette. A tablet
  // rotating across lg mid-run keeps the posture it opened in: switching
  // would remount the runtime and drop a sign card. Idempotent in render.
  if (!open) postureRef.current = null
  else if (mounted && postureRef.current === null) postureRef.current = isPhoneViewport()

  if (!mounted || hidden || !open) return null

  const live = !!prompt
  const appHref = draft.trim() ? `/chat?prompt=${encodeURIComponent(draft.trim())}` : '/chat'

  const runtime = live ? (
    <div className="askdoor__runtime">
      <ChatInterface simple injectedPrompt={prompt} />
    </div>
  ) : null
  const composer = (
    <>
      <div className={`askdoor__composer ${voiceLive ? 'is-listening' : ''}`}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send(draft)
            }
          }}
          placeholder={postureRef.current ? phonePlaceholder : placeholder}
          aria-label="Ask Pantessa"
          rows={1}
          className="askdoor__input"
          autoComplete="off"
          spellCheck={false}
        />
        <VoiceButton
          onInterim={(t) => setDraft(t)}
          onFinal={(t) => {
            setVoiceLive(false)
            send(t)
          }}
          onCancel={() => setVoiceLive(false)}
          onStateChange={(s) => setVoiceLive(s === 'listening')}
        />
        <button
          type="button"
          className={`askdoor__send ${draft.trim() ? 'is-ready' : ''}`}
          onClick={() => send(draft)}
          disabled={!draft.trim()}
          aria-label="Send"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
      <div className="askdoor__chips" aria-label="Try one">
        {chips.map((c) => (
          <button key={c.label} type="button" className="askdoor__chip" onClick={() => send(c.ask)} title={c.ask}>
            {c.label}
          </button>
        ))}
      </div>
    </>
  )

  if (postureRef.current) {
    return (
      <Sheet
        open
        onClose={closeDoor}
        id="ask"
        size={live ? 'full' : 'auto'}
        className={live ? 'askdoor-sheet askdoor-sheet--live' : 'askdoor-sheet'}
        title={
          <span className="askdoor__sheettitle">
            <PantessaMark size={18} />
            <span className="askdoor__sheetask">{live ? prompt.text : sym ? `Act on ${sym}` : 'Ask Pantessa'}</span>
          </span>
        }
        footer={live ? undefined : <p className="askdoor__sheetfoot mono">ONE SENTENCE · GUARDED BUILD · NOTHING MOVES UNTIL YOU SIGN</p>}
      >
        <div className="askdoor__sheetbody" data-ask-door="sheet" data-live={live ? '1' : '0'}>
          {live ? (
            <>
              <div className="askdoor__sheetbar">
                <ShareButton signInLane />
                <SpineLink href={appHref} className="askdoor__app" title="Open the full app">
                  Open the app <ArrowUpRight className="h-3.5 w-3.5" />
                </SpineLink>
              </div>
              {runtime}
            </>
          ) : (
            composer
          )}
        </div>
      </Sheet>
    )
  }

  return createPortal(
    <div className={`askdoor ${live ? 'askdoor--live' : ''}`} data-ask-door="sheet" data-live={live ? '1' : '0'}>
      <button className="askdoor__backdrop" aria-label="Close" onClick={closeDoor} />
      <div className="askdoor__sheet" role="dialog" aria-modal="true" aria-label="Ask Pantessa">
        <header className="askdoor__head">
          <span className="askdoor__brand">
            <PantessaMark size={18} />
            <span className="askdoor__word">pantessa</span>
          </span>
          {live ? (
            <span className="askdoor__asktext" title={prompt.text}>
              {prompt.text}
            </span>
          ) : (
            <span className="askdoor__eyebrow mono">{sym ? `ACT ON ${sym}` : 'ASK FROM ANYWHERE'} · YOUR WALLET SIGNS</span>
          )}
          <span className="askdoor__headright">
            {/* Share, just like the app's header: a signed-in owner flips the
                thread public + copies /p/<slug>; a connect-only wallet gets
                the sign-in lane (the SIWE prompt runs in place, the door
                stays open). Only once there's a thread to share. */}
            {live && <ShareButton signInLane />}
            <SpineLink href={appHref} className="askdoor__app" title="Open the full app">
              Open the app <ArrowUpRight className="h-3.5 w-3.5" />
            </SpineLink>
            <button type="button" className="askdoor__close" onClick={closeDoor} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </span>
        </header>

        {live ? (
          runtime
        ) : (
          <>
            {composer}
            <p className="askdoor__foot mono">
              ONE SENTENCE · GUARDED BUILD · NOTHING MOVES UNTIL YOU SIGN
              <span className="askdoor__foot-kbd">
                <kbd>{isMac() ? '⌘' : 'Ctrl'}</kbd>
                <kbd>K</kbd> anywhere · <kbd>Esc</kbd> closes
              </span>
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Mounted once in the root layout: the pill + the sheet. */
export default function AskDoor() {
  return (
    <>
      <AskDoorPill />
      <AskDoorSheet />
    </>
  )
}

// Other surfaces open the door with a draft (a symbol page's "Ask about X"
// affordances, a docs example, a landing tile) via the store directly:
//   useAskDoor.getState().openDoor('Buy $20 of ETH')
export { useAskDoor }
