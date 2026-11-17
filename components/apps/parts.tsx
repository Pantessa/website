'use client'

// Shared pieces every section on the apps page is built from (squad
// apps-page). Flat by rule: no card shells, no shadows, hairlines between
// things; mono eyebrows, the display face for the one headline, one filled
// accent button on the whole page at most (the thing a wallet signs lives in
// the chat). Logos stay: every app wears its mark, every token its icon.
// Classes are in components/apps/apps.css (prefix `apg-`).

import type { ReactNode } from 'react'
import Link from 'next/link'
import BrandIcon from '@/components/BrandIcon'
import type { McpServer } from '@/lib/store'
import { cleanServerName, cn } from '@/lib/utils'

/** MONO UPPERCASE label over a block. */
export function Eyebrow({ children, tone, className }: { children: ReactNode; tone?: 'needs' | 'idle' | 'ok'; className?: string }) {
  return (
    <div className={cn('apg-eyebrow', className)}>
      {tone && <span aria-hidden className={`apg-dot apg-dot--${tone}`} />}
      {children}
    </div>
  )
}

/** An app's name with its mark, linking to its server page. */
export function AppMark({ server, size = 18 }: { server: McpServer; size?: number }) {
  return (
    <Link href={`/servers/${server.slug}`} className="apg-appmark" title={`About ${cleanServerName(server.name)}`}>
      <BrandIcon server={server} size={size} />
      <span>{cleanServerName(server.name)}</span>
    </Link>
  )
}

/** A section's frame: the app's mark, an optional note on the right, then
 *  the body. In `side` density it is one column; in `full` it is the page. */
export function SectionFrame({
  server,
  note,
  children,
  className,
}: {
  server: McpServer
  note?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('apg-section', className)} data-apps-section={server.slug} aria-label={cleanServerName(server.name)}>
      <header className="apg-section__head">
        <AppMark server={server} />
        {note && <span className="apg-section__note">{note}</span>}
      </header>
      {children}
    </section>
  )
}

/** One fact: a number (or a short value) over what it is. */
export function Fact({ value, label, sub, tone }: { value: ReactNode; label: string; sub?: ReactNode; tone?: 'pos' | 'neg' }) {
  return (
    <div className="apg-fact">
      <div className={cn('apg-fact__value', tone && `apg-fact__value--${tone}`)}>{value}</div>
      <div className="apg-fact__label">{label}</div>
      {sub && <div className="apg-fact__sub">{sub}</div>}
    </div>
  )
}

/** Three or four facts in a row (wraps to two columns in a narrow column). */
export function FactRow({ children }: { children: ReactNode }) {
  return <div className="apg-facts">{children}</div>
}

/** The outlined pill every page action uses. It hands its ask to the chat. */
export function AskButton({
  children,
  onClick,
  title,
  strong,
  className,
}: {
  children: ReactNode
  onClick: () => void
  title?: string
  /** The one more-prominent action of a block (still outlined, never filled). */
  strong?: boolean
  className?: string
}) {
  return (
    <button type="button" onClick={onClick} title={title} className={cn('apg-btn', strong && 'apg-btn--strong', className)}>
      {children}
    </button>
  )
}

/** A titled list block: MONO title, an optional note, rows separated by
 *  hairlines. The main list and the side lists of a section are this. */
export function ListBlock({ title, note, children, className }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('apg-list', className)}>
      <div className="apg-list__head">
        <span className="apg-eyebrow">{title}</span>
        {note && <span className="apg-list__note">{note}</span>}
      </div>
      <div className="apg-list__rows">{children}</div>
    </div>
  )
}

/** One row of a list: a leading mark, a main line with small print under
 *  it, a value on the right, and at most two actions. */
export function ListRow({
  lead,
  main,
  sub,
  value,
  valueSub,
  actions,
}: {
  lead?: ReactNode
  main: ReactNode
  sub?: ReactNode
  value?: ReactNode
  valueSub?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="apg-row">
      {lead && <span className="apg-row__lead">{lead}</span>}
      <span className="apg-row__main">
        <span className="apg-row__title">{main}</span>
        {sub && <span className="apg-row__sub">{sub}</span>}
      </span>
      {(value || valueSub) && (
        <span className="apg-row__value">
          {value && <span>{value}</span>}
          {valueSub && <span className="apg-row__sub">{valueSub}</span>}
        </span>
      )}
      {actions && <span className="apg-row__acts">{actions}</span>}
    </div>
  )
}

/** The 4+ posture: one app, one sentence, one button. */
export function AppLineRow({
  server,
  text,
  act,
  tone,
}: {
  server: McpServer
  text: ReactNode
  act?: { label: string; onClick: () => void } | null
  tone?: 'needs' | 'idle' | 'ok'
}) {
  return (
    <div className="apg-line" data-apps-line={server.slug}>
      <span className="apg-line__app">
        <BrandIcon server={server} size={18} />
        <span className="apg-eyebrow">
          {tone && <span aria-hidden className={`apg-dot apg-dot--${tone}`} />}
          {cleanServerName(server.name)}
        </span>
      </span>
      <p className="apg-line__text">{text}</p>
      {act && (
        <AskButton onClick={act.onClick} className="apg-line__act">
          {act.label}
        </AskButton>
      )}
    </div>
  )
}

/** A section still loading its own scan (an app just toggled on). */
export function SectionPending({ server, line }: { server: McpServer; line?: boolean }) {
  if (line) return <AppLineRow server={server} text={<span className="apg-skel apg-skel--text" aria-label="Reading" />} />
  return (
    <SectionFrame server={server} note="reading">
      <div className="apg-skel apg-skel--block" aria-hidden />
      <div className="apg-skel apg-skel--block apg-skel--short" aria-hidden />
    </SectionFrame>
  )
}
