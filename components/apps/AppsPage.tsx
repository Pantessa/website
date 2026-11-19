'use client'

// THE APPS PAGE (squad apps-page, 2026-11-17): what the APPS tab shows on a
// desktop for a connected wallet. The selected apps ARE the page — one app
// in full, two or three side by side, four or more one line each
// (lib/apps-page densityFor) — and the chat is docked beside it
// (components/ChatWorkspace mounts ChatInterface in the dock; this file
// never renders a thread).
//
// THE CHAT IS ALWAYS IN REACH: the dock is its own column, so the page
// scrolls under nothing and the composer never leaves the screen; with the
// dock closed, one ask bar is pinned under the page's scroller (outside it),
// and a send from it opens the dock with the ask running.
//
// A button on the page never builds anything: it hands its ask to the chat
// (lib/apps-page-ui sendAsk), where a money ask comes back as the card the
// wallet signs.

import { useEffect, useMemo, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import ChainPicker from '@/components/ChainPicker'
import ChatLoader from '@/components/ChatLoader'
import SiteAccount from '@/components/SiteAccount'
import AppChips from '@/components/apps/AppChips'
import AppsStart from '@/components/apps/AppsStart'
import NeedsYou from '@/components/apps/NeedsYou'
import Recurring from '@/components/apps/Recurring'
import { Eyebrow } from '@/components/apps/parts'
import { SECTIONS } from '@/components/apps/sections'
import { useAppSet } from '@/components/apps/useAppSet'
import { useAppTiles } from '@/components/apps/useAppTiles'
import { useAppsStart } from '@/components/apps/useAppsStart'
import { useAppsUi } from '@/lib/apps-page-ui'
import { START_EYEBROW } from '@/lib/apps-start'
import {
  appFamily,
  askPlaceholder,
  densityEyebrow,
  densityFor,
  dockSuggestions,
  lineFor,
  needsLeads,
  needsYouRows,
  pageHeadline,
  pageTotalUsd,
  quietSentence,
  sectionDensityFor,
  splitPageTiles,
} from '@/lib/apps-page'
import { cleanServerName } from '@/lib/utils'
import './apps.css'

export default function AppsPage({ address }: { address?: string }) {
  const { active, servers } = useAppSet()
  const { tiles, map, loading, pending, retry } = useAppTiles(address, active)
  const { chatOpen, setChatOpen, sendAsk, setSuggestions } = useAppsUi()

  const density = densityFor(active.length)
  const sectionDensity = sectionDensityFor(density)
  const names = active.map((s) => cleanServerName(s.name))
  const page = useMemo(() => splitPageTiles(tiles ?? [], active.map((s) => s.slug)), [tiles, active])
  const totalUsd = useMemo(() => pageTotalUsd([...page.bySlug.values()].flat()), [page])
  const needs = needsYouRows(page.briefing)
  // An empty wallet's first run (lib/apps-start): it takes the headline and
  // leads the page; the apps' own sections stay under it.
  const start = useAppsStart({ address: address ?? '', servers, active, ready: !loading && tiles !== null, totalUsd, needs: needs.length })
  const starting = start.phase === 'start'

  // The dock's empty state offers the open apps' own first asks.
  useEffect(() => {
    setSuggestions(starting ? start.suggestions : dockSuggestions(active.map((s) => (page.bySlug.get(s.slug) ?? []).flatMap((t) => t.prompts))))
  }, [active, page, setSuggestions, starting, start.suggestions])

  const askFor = (slug?: string) => (text: string, opts?: { send?: boolean }) =>
    sendAsk(text, { send: opts?.send, mcps: slug ? [slug] : undefined })

  const only = density === 'full' ? active[0] : null
  const needsFirst = needsLeads(density, only ? appFamily(only) : null)
  const onlyModule = only ? SECTIONS[appFamily(only)] : null
  const pageLoading = loading || tiles === null
  const headline = !address
    ? pageHeadline({ count: active.length, totalUsd, needs: 0, noWallet: true })
    : pageLoading
    ? pageHeadline({ count: active.length, totalUsd, needs: needs.length, loading: true })
    : (only && onlyModule?.headline?.({ server: only, tiles: page.bySlug.get(only.slug) ?? [], page, map })) ||
      pageHeadline({ count: active.length, totalUsd, needs: needs.length })

  // The one-line posture folds every quiet app into ONE sentence.
  const sectionsFor = active.map((server) => {
    const family = appFamily(server)
    const mod = SECTIONS[family]
    const group = page.bySlug.get(server.slug) ?? []
    const isPending = pending.some((p) => p.id === server.id)
    // With no wallet nothing was read, so no app is "quiet": "Nothing new
    // from …" would describe a wallet the page never saw. Each keeps its line.
    const quiet =
      sectionDensity === 'line' && !!address && !isPending && (mod.quiet ? mod.quiet({ server, tiles: group, page, map }) : lineFor(group).quiet)
    return { server, family, mod, group, isPending, quiet }
  })
  const loud = sectionsFor.filter((s) => !s.quiet)
  const quiet = sectionsFor.filter((s) => s.quiet)

  return (
    <div className="apg" data-apps-page="" data-density={density} data-chat={chatOpen ? 'open' : 'closed'}>
      <AppChips
        right={
          <>
            <ChainPicker />
            <SiteAccount />
            <button
              type="button"
              aria-pressed={chatOpen}
              onClick={() => setChatOpen(!chatOpen)}
              className="apg-chip apg-chip--chat"
              title={chatOpen ? 'Close the chat' : 'Open the chat'}
              data-apps-chat-toggle=""
            >
              <MessageSquare width={14} height={14} aria-hidden />
              Chat
            </button>
          </>
        }
      />

      <div className="apg__scroll" data-apps-scroll="">
        <div className={`apg__inner apg__inner--${density}`}>
          <header className="apg-head">
            <Eyebrow>{starting ? START_EYEBROW : densityEyebrow(active.length)}</Eyebrow>
            <h1 className="apg-headline" data-deciding={start.phase === 'deciding' ? '' : undefined}>
              {starting ? start.headline : headline}
            </h1>
          </header>

          {starting && address && <AppsStart address={address} start={start} onAsk={(text, slug) => sendAsk(text, { mcps: [slug] })} />}

          {density === 'empty' ? (
            !starting && <p className="apg-muted apg-empty">Press Add app above to pick one. One app is shown in full; add more and the page makes room for each.</p>
          ) : loading || tiles === null ? (
            <ChatLoader inline />
          ) : (
            <>
              {needsFirst && <NeedsYou rows={needs} onAsk={askFor()} />}

              {density === 'lines' ? (
                <div className="apg-lines" data-apps-lines="">
                  {loud.map(({ server, family, mod, group, isPending }) => (
                    <mod.Section
                      key={server.id}
                      server={server}
                      family={family}
                      tiles={group}
                      pending={isPending}
                      density="line"
                      page={page}
                      map={map}
                      address={address ?? ''}
                      onAsk={askFor(server.slug)}
                      onRetry={retry}
                    />
                  ))}
                  <Recurring tile={page.recurring} line onAsk={askFor()} />
                  {quiet.length > 0 && !starting && (
                    <div className="apg-line apg-line--quiet" data-apps-line="quiet">
                      <span className="apg-line__app">
                        <Eyebrow>Quiet</Eyebrow>
                      </span>
                      <p className="apg-line__text apg-muted">{quietSentence(quiet.map((q) => cleanServerName(q.server.name)))}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className={density === 'side' ? 'apg-cols' : 'apg-full'} data-apps-cols={active.length} style={{ ['--apg-n' as string]: active.length }}>
                  {sectionsFor.map(({ server, family, mod, group, isPending }) => (
                    <mod.Section
                      key={server.id}
                      server={server}
                      family={family}
                      tiles={group}
                      pending={isPending}
                      density={sectionDensity}
                      page={page}
                      map={map}
                      address={address ?? ''}
                      onAsk={askFor(server.slug)}
                      onRetry={retry}
                    />
                  ))}
                </div>
              )}

              {!needsFirst && <NeedsYou rows={needs} onAsk={askFor()} />}
              {density !== 'lines' && <Recurring tile={page.recurring} onAsk={askFor()} />}
            </>
          )}
        </div>
      </div>

      {/* The chat's door while the dock is closed: pinned under the scroller,
          never inside it, so it is on screen at every scroll position. */}
      {!chatOpen && <AskBar placeholder={askPlaceholder(names)} disabled={active.length === 0} onSend={(text) => sendAsk(text)} onOpen={() => setChatOpen(true)} />}
    </div>
  )
}

function AskBar({ placeholder, disabled, onSend, onOpen }: { placeholder: string; disabled: boolean; onSend: (text: string) => void; onOpen: () => void }) {
  const [text, setText] = useState('')
  return (
    <form
      className="apg-askbar"
      data-apps-askbar=""
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) {
          onSend(text)
          setText('')
        } else onOpen()
      }}
    >
      <div className="apg-askbar__pill">
        <MessageSquare width={16} height={16} aria-hidden className="apg-askbar__icon" />
        <input
          aria-label="Ask the chat"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="apg-askbar__input"
        />
        <button type="submit" className="apg-askbar__send" aria-label={text.trim() ? 'Send to the chat' : 'Open the chat'} disabled={disabled}>
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </form>
  )
}
