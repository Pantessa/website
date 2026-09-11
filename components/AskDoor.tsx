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
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowUp, ArrowUpRight, Mic, X } from 'lucide-react'
import { PantessaMark } from '@/components/Logo'
import VoiceButton from '@/components/VoiceButton'
import { analytics } from '@/lib/analytics'
import { askDoorChips, askDoorHidden, askDoorNav, askDoorPillHidden, askDoorPlaceholder, askDoorSymbol, useAskDoor } from '@/lib/ask-door'
import { normalizeSpokenAsk } from '@/lib/voice-ask'
import { useYeetfulStore } from '@/lib/store'
import type { InjectedPrompt } from '@/lib/trade-asks'

// ChatInterface is heavy (wagmi, the store, every card); it loads only when
// a visitor actually sends something through the door.
const ChatInterface = dynamic(() => import('@/components/ChatInterface'), { ssr: false })

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The nav / drawer trigger. Renders nothing where the door is hidden. */
export function AskDoorTrigger({ variant = 'nav' }: { variant?: 'nav' | 'drawer' }) {
  const pathname = usePathname()
  const openDoor = useAskDoor((s) => s.openDoor)
  if (askDoorHidden(pathname)) return null
  return (
    <button
      type="button"
      className={variant === 'nav' ? 'nav__ask' : 'nav__tab drawer__ask'}
      onClick={() => openDoor()}
      aria-label="Ask Pantessa"
      title="Ask Pantessa — one sentence, guarded build, your wallet signs (⌘K)"
      data-ask-door={variant}
    >
      <span className="nav__ask-mark" aria-hidden="true">
        <PantessaMark size={16} />
      </span>
      <span>Ask</span>
      {variant === 'nav' && (
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
  if (askDoorPillHidden(pathname) || open) return null
  return (
    <button
      type="button"
      className="askdoor-pill"
      onClick={() => openDoor()}
      aria-label="Ask Pantessa"
      title="Ask Pantessa — one sentence, guarded build, your wallet signs"
      data-ask-door="pill"
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

function AskDoorSheet() {
  const pathname = usePathname()
  const router = useRouter()
  const open = useAskDoor((s) => s.open)
  const draft = useAskDoor((s) => s.draft)
  const setDraft = useAskDoor((s) => s.setDraft)
  const closeDoor = useAskDoor((s) => s.closeDoor)
  const openDoor = useAskDoor((s) => s.openDoor)
  const setCurrentChatId = useYeetfulStore((s) => s.setCurrentChatId)

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Live = an ask was sent; the sheet is the runtime until closed.
  const [prompt, setPrompt] = useState<InjectedPrompt | null>(null)
  const [voiceLive, setVoiceLive] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const hidden = askDoorHidden(pathname)
  const chips = useMemo(() => askDoorChips(pathname), [pathname])
  const sym = askDoorSymbol(pathname)
  const placeholder = askDoorPlaceholder(pathname)

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

  if (!mounted || hidden || !open) return null

  const live = !!prompt
  const appHref = draft.trim() ? `/chat?prompt=${encodeURIComponent(draft.trim())}` : '/chat'

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
            <Link href={appHref} className="askdoor__app" title="Open the full app">
              Open the app <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <button type="button" className="askdoor__close" onClick={closeDoor} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </span>
        </header>

        {live ? (
          <div className="askdoor__runtime">
            <ChatInterface simple injectedPrompt={prompt} />
          </div>
        ) : (
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
                placeholder={placeholder}
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
