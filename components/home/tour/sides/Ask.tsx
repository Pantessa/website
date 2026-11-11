'use client'

// THE TOUR · ASK — the composer (squad landing, 2026-11-10; lane SIDES-A).
// The claim is "say it, it builds", so the miniature is a place to say it:
//
//   • a real input. What is typed is SENT into the Ask door (`say`), the
//     way the top strip's Ask sends it: never through the wallet gate here,
//     because typed words may be a question and a question is answered with
//     no wallet (components/AskDoor.tsx send → ChatInterface's guest lane;
//     a money ask meets the chat's own connect wall, which holds it).
//     Nothing here calls the chat itself;
//   • example rows from the side's own sentences (lib/home-tour/ask.ts):
//     the mark of the app that catches each, the sentence, the app's name.
//     A row is an ORDER, so it runs through `act` (connect-to-act, then the
//     door sends it) and is not offered when its venue cannot run it;
//   • one question row, the chat's own no-wallet example (lib/examples):
//     a read, so it is sent the way typed words are (`say`), never `act`;
//   • the fleet's marks as doors into the chat with that app on
//     (lib/home-apps), so the count in the words is something to touch.

import { useId, useState, type FormEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import LandingLink from '@/components/home/LandingLink'
import { getProtocolMark } from '@/components/protocol-marks'
import { askAppSlugs } from '@/lib/ask-apps'
import { EXAMPLE_PROMPTS } from '@/lib/examples'
import { HOME_APPS, HOME_APPS_ALL_HREF, homeAppHref } from '@/lib/home-apps'
import { meta } from '@/lib/home-tour/ask'
import { tourJourney } from '@/lib/home-tour'
import { useTour } from '../context'
import { TourPanel } from '../Panel'
import './a/kit.css'
import './ask.css'

/** The words column without its chips: the rows in the composer are the chips. */
const COPY = { ...meta, asks: [] }
/** The chat's own data question: a read, answered with no wallet. */
const QUESTION = EXAMPLE_PROMPTS.find((p) => p.prompt.endsWith('?') && !/\bmy\b/i.test(p.prompt)) ?? null
const J = (what: string) => tourJourney(meta.id, what)

export default function AskSide() {
  const { data, act, say, canAct } = useTour()
  const [text, setText] = useState('')
  const inputId = useId()
  const rows = meta.asks.filter((a) => canAct(a.ask))
  const ready = text.trim().length > 0

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const words = text.trim()
    if (!words) return
    say(words)
    setText('')
  }

  return (
    <TourPanel side={COPY} demoLabel="The composer, with examples">
      <div className="ta tk" data-tour-mini="ask">
        <form className="tk__composer" onSubmit={submit}>
          <label className="sr-only" htmlFor={inputId}>
            Say what you want done
          </label>
          <input id={inputId} className="tk__input" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Say what you want done" autoComplete="off" autoCapitalize="sentences" spellCheck={false} enterKeyHint="go" maxLength={240} data-ask-door-yield data-tour-ask-input />
          <button type="submit" className={`tk__send${ready ? ' is-ready' : ''}`} disabled={!ready} aria-label="Send it to Ask" data-journey={J('typed')}>
            <ArrowUp size={16} aria-hidden />
          </button>
        </form>
        <p className="ta-note">Enter sends it: a question needs no wallet, an order asks for one to sign.</p>

        <div className="tk__examples">
          <p className="ta-eyebrow mono">Or run one of these</p>
          <ul className="tk__rows">
            {rows.map((a) => {
              const Mark = getProtocolMark(askAppSlugs(a.ask)[0] ?? a.via)
              return (
                <li key={a.ask}>
                  <button type="button" className="tk__row" onClick={() => act(a.ask)} title={a.ask} data-ask={a.ask} data-journey={J(a.label)}>
                    <span className="tk__mark" aria-hidden>
                      {Mark ? <Mark size={18} /> : a.via.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="tk__words">
                      <span className="tk__ask">{a.ask}</span>
                      <span className="tk__via mono">{a.via}</span>
                    </span>
                    <span className="tk__arrow" aria-hidden>
                      →
                    </span>
                  </button>
                </li>
              )
            })}
            {QUESTION && (
              <li>
                <button type="button" className="tk__row tk__row--read" onClick={() => say(QUESTION.prompt)} title={QUESTION.prompt} data-say={QUESTION.prompt} data-journey={J('a question')}>
                  <span className="tk__mark tk__mark--read mono" aria-hidden>
                    ?
                  </span>
                  <span className="tk__words">
                    <span className="tk__ask">{QUESTION.prompt}</span>
                    <span className="tk__via mono">an answer, no wallet</span>
                  </span>
                  <span className="tk__arrow" aria-hidden>
                    →
                  </span>
                </button>
              </li>
            )}
          </ul>
        </div>

        <div className="tk__fleet">
          <p className="ta-eyebrow mono">{data.counts.apps != null ? `${data.counts.apps} apps behind it` : 'The apps behind it'}</p>
          <ul className="tk__apps">
            {HOME_APPS.map((app) => {
              const Mark = getProtocolMark(app.slug, app.name)
              return (
                <li key={app.slug}>
                  <LandingLink href={homeAppHref(app.slug)} className="tk__app" prefetch={false} title={`${app.name}: ${app.does}`} aria-label={`${app.name}: ${app.does}`} data-app={app.slug} data-journey={J(`app ${app.name}`)}>
                    {Mark ? <Mark size={20} /> : <span className="mono">{app.name.slice(0, 1)}</span>}
                  </LandingLink>
                </li>
              )
            })}
            <li>
              <LandingLink href={HOME_APPS_ALL_HREF} className="tk__app tk__app--all mono" prefetch={false} aria-label="All apps" data-journey={J('all apps')}>
                All
              </LandingLink>
            </li>
          </ul>
        </div>
      </div>
    </TourPanel>
  )
}
