'use client'

// THE TOUR · BUILD (squad landing, 2026-11-10; lane SIDES-B).
//
// "Real code." Three tabs — Embed, Agent desk, SDK — each showing a block
// COPIED from the page a builder lands on next (./b/snippets.ts names the
// source of every block; the lane's pins read both and fail on drift), with
// a copy button. Under the code: what that door gives you, in the docs' own
// terms. The foot links the published venue manifest, with its counts from
// the snapshot (dropped when they are not there).
//
// The tabs are a real tablist: roving tabindex, Left/Right/Home/End, the
// panel labelled by its tab. Nothing types itself, nothing animates.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import SpineLink from '@/components/SpineLink'
import { tourJourney } from '@/lib/home-tour'
import { meta } from '@/lib/home-tour/build'
import { TourPanel } from '../Panel'
import { useTour } from '../context'
import { BUILD_TABS, type BuildBlock, type BuildTabId } from './b/snippets'
import './b/shared.css'
import './build.css'

type CopyState = 'idle' | 'done' | 'failed'

function CodeBlock({ block, tab }: { block: BuildBlock; tab: BuildTabId }) {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const copy = useCallback(async () => {
    let ok = false
    try {
      await navigator.clipboard.writeText(block.code)
      ok = true
    } catch {
      // No clipboard here (an insecure origin, a refused permission): say so; the text is selectable.
    }
    setState(ok ? 'done' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2400)
  }, [block.code])
  return (
    <figure className="sb-bd__block">
      <figcaption className="sb-bd__bar">
        <span className="sb-bd__where mono">{block.where}</span>
        <button type="button" className="sb-bd__copy mono" onClick={copy} data-copy={tab} data-journey={tourJourney(meta.id, `copy ${tab}`)}>
          <span aria-live="polite">{state === 'done' ? 'Copied' : state === 'failed' ? 'Select it to copy' : 'Copy'}</span>
        </button>
      </figcaption>
      {/* Focusable so a keyboard can scroll a long line. */}
      <pre className="sb-bd__code mono" tabIndex={0} data-build-code={tab}>
        <code>{block.code}</code>
      </pre>
    </figure>
  )
}

export default function BuildSide() {
  const { data } = useTour()
  const [on, setOn] = useState<BuildTabId>(BUILD_TABS[0].id)
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({})
  const tab = BUILD_TABS.find((t) => t.id === on) ?? BUILD_TABS[0]
  const { venues, pinnedAddresses } = data.counts

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = BUILD_TABS.findIndex((t) => t.id === on)
    const to = e.key === 'ArrowRight' ? (i + 1) % BUILD_TABS.length : e.key === 'ArrowLeft' ? (i - 1 + BUILD_TABS.length) % BUILD_TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? BUILD_TABS.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    const next = BUILD_TABS[to].id
    setOn(next)
    tabs.current[next]?.focus()
  }

  return (
    <TourPanel side={meta} demoLabel="Real code: embed, agent desk, SDK">
      <div className="sb-bd" data-bd>
        <div className="sb-bd__tabs" role="tablist" aria-label="Ways to build on Pantessa" onKeyDown={onKey}>
          {BUILD_TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabs.current[t.id] = el
              }}
              type="button"
              role="tab"
              id={`sb-bd-tab-${t.id}`}
              className={`sb-bd__tab${t.id === on ? ' is-on' : ''}`}
              aria-selected={t.id === on}
              aria-controls="sb-bd-panel"
              tabIndex={t.id === on ? 0 : -1}
              onClick={() => setOn(t.id)}
              data-build-tab={t.id}
              data-journey={tourJourney(meta.id, `tab ${t.label}`)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="sb-bd__panel" id="sb-bd-panel" role="tabpanel" aria-labelledby={`sb-bd-tab-${tab.id}`} data-build-panel={tab.id}>
          <p className="sb-bd__says">{tab.says}</p>
          {tab.blocks.map((b) => (
            <CodeBlock key={`${tab.id}:${b.where}`} block={b} tab={tab.id} />
          ))}
          <ul className="sb-bd__points">
            {tab.points.map((p) => {
              const m = /^([a-z_]+): (.*)$/.exec(p)
              return (
                <li key={p} className="sb-bd__point">
                  {m ? (
                    <>
                      <code className="mono">{m[1]}</code>{' '}
                      {m[2]}
                    </>
                  ) : (
                    p
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        {venues != null && pinnedAddresses != null && (
          <p className="sb-bd__foot">
            Every contract a builder may touch is published:{' '}
            <SpineLink href="/docs/venues" prefetch={false} className="sb-bd__link" data-journey={tourJourney(meta.id, 'Venue manifest')}>
              {venues.toLocaleString('en-US')} venues, {pinnedAddresses.toLocaleString('en-US')} pinned{' '}
              <span className="sb-bd__nowrap">
                addresses <i aria-hidden>→</i>
              </span>
            </SpineLink>
          </p>
        )}
      </div>
    </TourPanel>
  )
}
