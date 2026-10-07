'use client'

// THE EMPTY DOOR (squad pre-gtm, 2026-10-06, FIRSTRUN lane). Every empty
// state of the spine — nothing running, no chats, no links, no wallet — used
// to be one muted sentence, and a stranger's first tap on JOBS or CHATS met a
// wall. This is the one card they all render instead: the Emerald Cut, a
// mono eyebrow naming the place, the lesson in the chat's display face, one
// line of what will land here, up to three short "what it is for" lines, and
// ONE primary action that works right now — a chip that SENDS (through the
// connect-to-act door, so a stranger meets the unified door and the held ask
// runs when a wallet lands), a link into the app (SpineLink), a plain href,
// or a button the surface owns. A secondary action is a text link.
//
// The same contract as the guide card: never a modal, no scrim, no portal,
// role="note", tokens only (dark + light free), reduced motion drops the
// entrance. The chip-send rule holds: a chip sends, a link prefills, a URL
// never fires a turn. GuideSeat's wiring for an ask is reused verbatim
// (useConnectToAct → the ask door's sheet with the ask's apps), unless the
// surface hands its own `run` (the chat rail sends into the chat beside it).

import { useCallback, type ReactNode } from 'react'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { PantessaMark } from '@/components/Logo'
import SpineLink from '@/components/SpineLink'
import './guide.css'

export type DoorAct =
  | { kind: 'ask'; label: string; ask: string }
  | { kind: 'spine'; label: string; href: string }
  | { kind: 'href'; label: string; href: string }
  | { kind: 'button'; label: string; onClick: () => void; disabled?: boolean }
  /** A control the surface renders itself (the unified sign-in door). */
  | { kind: 'node'; node: ReactNode }

export type EmptyDoorProps = {
  /** Which place this is — `JOBS`, `CHATS`… (mono, uppercase). */
  eyebrow: string
  title: string
  body: ReactNode
  /** Up to three short lines: what lands here, in the order it happens. */
  lines?: readonly string[]
  primary?: DoorAct
  secondary?: DoorAct
  /** The ask action's runner. Default: the ask door's sheet (GuideSeat's). */
  run?: (ask: string) => void
  /** The rail's narrow column: smaller type, the mark above the words. */
  compact?: boolean
  className?: string
  /** For the harness and drives: `data-door="jobs"`. */
  id: string
}

function ActControl({ act, cls, onAsk }: { act: DoorAct; cls: string; onAsk: (ask: string) => void }) {
  switch (act.kind) {
    case 'ask':
      return (
        <button type="button" className={cls} data-door-act="ask" onClick={() => onAsk(act.ask)} title={act.ask}>
          {act.label}
        </button>
      )
    case 'spine':
      return (
        <SpineLink href={act.href} prefetch={false} className={cls} data-door-act="spine">
          {act.label}
        </SpineLink>
      )
    case 'href':
      return (
        <a href={act.href} className={cls} data-door-act="href">
          {act.label}
        </a>
      )
    case 'button':
      return (
        <button type="button" className={cls} data-door-act="button" onClick={act.onClick} disabled={act.disabled}>
          {act.label}
        </button>
      )
    case 'node':
      return <>{act.node}</>
  }
}

export default function EmptyDoor({ eyebrow, title, body, lines, primary, secondary, run, compact = false, className, id }: EmptyDoorProps) {
  const openDoor = useAskDoor((s) => s.openDoor)
  const sheet = useCallback((text: string) => openDoor(text, { send: true, mcps: askAppSlugs(text) }), [openDoor])
  const promptHref = useCallback((text: string) => `/chat?prompt=${encodeURIComponent(text)}`, [])
  const { act, door } = useConnectToAct({ run: run ?? sheet, redirectFor: promptHref })

  return (
    <aside className={['door', compact ? 'door--compact' : '', className ?? ''].join(' ').trim()} role="note" aria-labelledby={`door-${id}-title`} data-door={id}>
      <span className="door__mark" aria-hidden>
        <PantessaMark size={compact ? 22 : 28} />
      </span>
      <div className="door__body">
        <div className="door__eyebrow">{eyebrow}</div>
        <p id={`door-${id}-title`} className="door__title">
          {title}
        </p>
        <p className="door__text">{body}</p>
        {lines && lines.length > 0 && (
          <ol className="door__lines">
            {lines.slice(0, 3).map((l, i) => (
              <li key={i}>
                <span className="door__n" aria-hidden>
                  {i + 1}
                </span>
                <span>{l}</span>
              </li>
            ))}
          </ol>
        )}
        {(primary || secondary) && (
          <div className="door__acts">
            {primary && <ActControl act={primary} cls="door__cta" onAsk={act} />}
            {secondary && <ActControl act={secondary} cls="door__link" onAsk={act} />}
          </div>
        )}
      </div>
      {door}
    </aside>
  )
}
