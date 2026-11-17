'use client'

// THE APPS PAGE ON A PHONE (squad apps-page, PHONE lane, 2026-11-17): what
// the APPS screen shows below lg for a connected wallet. The desktop page's
// sibling, built from the same pieces (the scan, the section modules, the
// needs-you strip, the recurring buys), laid out in one column:
// lib/apps-phone phoneLayoutFor (1 app in full, 2 or 3 stacked, 4 or more one
// line each).
//
// THE CHAT IS ALWAYS IN REACH: the ask bar (and up to two suggestions above
// it) is the panel's LAST ROW, a sibling of the screen's one scroller, never
// inside it. So it never scrolls away and never covers the last row of
// content, it sits right above the tab bar, and when the soft keyboard is up
// the frame shrinks onto the keyboard (app/native-shell.css) and the bar
// rides on top of it. A send hands the ask to the chat (lib/apps-page-ui
// sendAsk) and goes to the conversation, where ChatWorkspace feeds it to
// ChatInterface's injectedPrompt. The APPS tab brings you back here, at the
// scroll you left.
//
// A section never builds or signs anything: its buttons hand their asks to
// the chat, where a money ask comes back as the card the wallet signs.

import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Plus } from 'lucide-react'
import BrandIcon from '@/components/BrandIcon'
import ChainPicker from '@/components/ChainPicker'
import ChatLoader from '@/components/ChatLoader'
import AppsRailTab from '@/components/AppsRailTab'
import Sheet from '@/components/mobile/Sheet'
import { useSoftKeyboard } from '@/components/mobile/useSoftKeyboard'
import NeedsYou from '@/components/apps/NeedsYou'
import Recurring from '@/components/apps/Recurring'
import { Eyebrow } from '@/components/apps/parts'
import { SECTIONS } from '@/components/apps/sections'
import { useAppSet } from '@/components/apps/useAppSet'
import { useAppTiles } from '@/components/apps/useAppTiles'
import { useAppsUi } from '@/lib/apps-page-ui'
import { appFamily, askPlaceholder, densityEyebrow, dockSuggestions, lineFor, needsYouRows, pageHeadline, quietSentence, splitPageTiles } from '@/lib/apps-page'
import { askBarSubmit, phoneLayoutFor, phoneSuggestions } from '@/lib/apps-phone'
import { mergeMoneyMap, summarizeMoneyMap } from '@/lib/splash/money-map'
import { useYeetfulStore } from '@/lib/store'
import { cleanServerName } from '@/lib/utils'
import './apps.css'
import './apps-phone.css'

// The page's scroll, kept for the session: you go to the chat and the APPS
// tab brings you back where you were (the screen unmounts in between).
let SCROLL_MEMORY = 0

export default function AppsPhone({ address, title }: { address: string; title: string }) {
  const { active, toggle } = useAppSet()
  const { tiles, map, loading, pending, retry } = useAppTiles(address, active)
  const { sendAsk, setSuggestions, suggestions } = useAppsUi()
  const setPhoneScreen = useYeetfulStore((s) => s.setPhoneScreen)
  const [addOpen, setAddOpen] = useState(false)

  const { layout, section } = phoneLayoutFor(active.length)
  const names = active.map((s) => cleanServerName(s.name))
  const page = useMemo(() => splitPageTiles(tiles ?? [], active.map((s) => s.slug)), [tiles, active])
  const needs = needsYouRows(page.briefing)
  const merged = useMemo(() => mergeMoneyMap(map, tiles ?? []), [map, tiles])
  const totalUsd = merged ? summarizeMoneyMap(merged).totalUsd : null

  // The same suggestions the desktop dock offers (the page publishes them).
  useEffect(() => {
    setSuggestions(dockSuggestions(active.map((s) => (page.bySlug.get(s.slug) ?? []).flatMap((t) => t.prompts))))
  }, [active, page, setSuggestions])

  // Every ask goes to the conversation, which runs it.
  const ask = (text: string, opts?: { send?: boolean; mcps?: string[] }) => {
    sendAsk(text, opts)
    setPhoneScreen('chat')
  }
  const askFor = (slug?: string) => (text: string, opts?: { send?: boolean }) => ask(text, { send: opts?.send, mcps: slug ? [slug] : undefined })

  const only = layout === 'full' ? active[0] : null
  const onlyModule = only ? SECTIONS[appFamily(only)] : null
  const headline =
    (only && onlyModule?.headline?.({ server: only, tiles: page.bySlug.get(only.slug) ?? [], page, map })) ||
    pageHeadline({ count: active.length, totalUsd, needs: needs.length })

  const sectionsFor = active.map((server) => {
    const family = appFamily(server)
    const mod = SECTIONS[family]
    const group = page.bySlug.get(server.slug) ?? []
    const isPending = pending.some((p) => p.id === server.id)
    const quiet = section === 'line' && !isPending && (mod.quiet ? mod.quiet({ server, tiles: group, page, map }) : lineFor(group).quiet)
    return { server, family, mod, group, isPending, quiet }
  })
  const shown = section === 'line' ? sectionsFor.filter((s) => !s.quiet) : sectionsFor
  const quiet = section === 'line' ? sectionsFor.filter((s) => s.quiet) : []

  // The one scroller: remember its position as it scrolls (never at unmount,
  // when a detached node reads 0) and land back on it.
  const scrollerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const remember = () => {
      SCROLL_MEMORY = el.scrollTop
    }
    el.addEventListener('scroll', remember, { passive: true })
    return () => el.removeEventListener('scroll', remember)
  }, [])
  const contentReady = !loading && tiles !== null
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || !contentReady || SCROLL_MEMORY <= 0) return
    const saved = SCROLL_MEMORY
    el.scrollTop = saved
    const raf = requestAnimationFrame(() => {
      if (el.scrollTop < saved) el.scrollTop = saved
    })
    return () => cancelAnimationFrame(raf)
  }, [contentReady])

  return (
    <section data-phone-panel="apps" aria-label={title} className="apgm" data-apps-phone="" data-layout={layout}>
      <header className="apgm-top">
        <h1 className="apgm-top__title">{title}</h1>
        <ChainPicker />
      </header>

      <div ref={scrollerRef} data-app-scroll="" className="apgm-scroll">
        <div className="apgm-chips" role="group" aria-label="Apps on this page" data-apps-chips="">
          {active.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed="true"
              onClick={() => toggle(s)}
              title={`${cleanServerName(s.name)} is on this page. Tap to remove it.`}
              className="apgm-chip apgm-chip--on"
              data-apps-chip={s.slug}
            >
              <BrandIcon server={s} size={16} />
              <span>{cleanServerName(s.name)}</span>
              <span aria-hidden className="apgm-chip__x">
                ×
              </span>
            </button>
          ))}
          <button type="button" onClick={() => setAddOpen(true)} aria-haspopup="dialog" aria-expanded={addOpen} className="apgm-chip apgm-chip--add" data-apps-add="">
            <Plus width={14} height={14} aria-hidden />
            {active.length ? 'Add' : 'Add an app'}
          </button>
        </div>

        <div className={`apgm-inner apgm-inner--${layout}`}>
          <header className="apg-head">
            <Eyebrow>{densityEyebrow(active.length)}</Eyebrow>
            <h2 className="apg-headline apgm-headline">{headline}</h2>
          </header>

          {layout === 'empty' ? (
            <p className="apg-muted apgm-empty">Add an app from the row above. One app is shown in full; add more and the page makes room for each.</p>
          ) : !contentReady ? (
            <ChatLoader inline />
          ) : (
            <>
              <NeedsYou rows={needs} onAsk={askFor()} />

              <div className={layout === 'lines' ? 'apg-lines apgm-lines' : 'apgm-stack'} data-apps-lines={layout === 'lines' ? '' : undefined} data-apps-cols={active.length}>
                {shown.map(({ server, family, mod, group, isPending }) => (
                  <mod.Section
                    key={server.id}
                    server={server}
                    family={family}
                    tiles={group}
                    pending={isPending}
                    density={section ?? 'full'}
                    page={page}
                    map={map}
                    address={address}
                    onAsk={askFor(server.slug)}
                    onRetry={retry}
                  />
                ))}
                {layout === 'lines' && <Recurring tile={page.recurring} line onAsk={askFor()} />}
                {quiet.length > 0 && (
                  <div className="apg-line apg-line--quiet" data-apps-line="quiet">
                    <span className="apg-line__app">
                      <Eyebrow>Quiet</Eyebrow>
                    </span>
                    <p className="apg-line__text apg-muted">{quietSentence(quiet.map((q) => cleanServerName(q.server.name)))}</p>
                  </div>
                )}
              </div>

              {layout !== 'lines' && <Recurring tile={page.recurring} onAsk={askFor()} />}
            </>
          )}
        </div>
      </div>

      <PhoneAskBar
        placeholder={askPlaceholder(names)}
        disabled={active.length === 0}
        suggestions={phoneSuggestions(suggestions)}
        onSend={(text) => ask(text)}
        onOpen={() => setPhoneScreen('chat')}
      />

      <Sheet id="apps-add" open={addOpen} onClose={() => setAddOpen(false)} title="Add an app" size="full">
        <div className="flex flex-col pb-2">
          <AppsRailTab flat />
        </div>
      </Sheet>
    </section>
  )
}

function PhoneAskBar({
  placeholder,
  disabled,
  suggestions,
  onSend,
  onOpen,
}: {
  placeholder: string
  disabled: boolean
  suggestions: { label: string; prompt: string }[]
  onSend: (text: string) => void
  onOpen: () => void
}) {
  const [text, setText] = useState('')
  const { open: keyboardOpen } = useSoftKeyboard()
  return (
    <div className="apgm-ask" data-apps-askbar="" data-keyboard={keyboardOpen ? '' : undefined}>
      {suggestions.length > 0 && !disabled && (
        <div className="apgm-ask__sugs" data-apps-suggestions="">
          {suggestions.map((p) => (
            <button key={p.prompt} type="button" className="apgm-sug" title={p.prompt} onClick={() => onSend(p.prompt)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <form
        className="apgm-ask__pill"
        onSubmit={(e) => {
          e.preventDefault()
          const next = askBarSubmit(text)
          if (next.kind === 'send') {
            setText('')
            onSend(next.text)
          } else onOpen()
        }}
      >
        <MessageSquare width={16} height={16} aria-hidden className="apgm-ask__icon" />
        <input
          aria-label="Ask the chat"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          enterKeyHint="send"
          className="apgm-ask__input"
          data-apps-ask-input=""
        />
        <button type="submit" className="apgm-ask__send" aria-label={text.trim() ? 'Send to the chat' : 'Open the chat'} disabled={disabled} data-apps-ask-send="">
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
    </div>
  )
}
