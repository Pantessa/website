'use client'

// Where a job is offered as a default, this is what offers it (squad lane1,
// the jobs audit, 2026-11-17; rule + catalog in lib/job-offers).
//
//   JobsEmptyDoor  the JOBS rail's empty state: the EmptyDoor card with the
//                  ONE action this wallet can take right now.
//   JobOfferLine   an inline form of the same rule for prose (a docs page, a
//                  tile): the example as text, and a link that runs a job
//                  only when this wallet can run that exact sentence.
//
// The four states, everywhere:
//   offer    the button sends the wallet's own sentence (its chain, its size)
//   fund     no job button: what a job is, what a first one needs, and the
//            door into the wallet window (card / receive address live there)
//   loading  no button that could be wrong; one quiet line
//   connect  what a job is, the example as TEXT, the unified connect door

import type { ReactNode } from 'react'
import EmptyDoor, { type DoorAct } from '@/components/guide/EmptyDoor'
import CreateAccountButton from '@/components/CreateAccountButton'
import AuthButton from '@/components/AuthButton'
import SpineLink from '@/components/SpineLink'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { JOBS_DOOR } from '@/lib/first-run'
import { useJobOffer } from '@/lib/use-job-offer'
import { WALLET_PAGE_HREF } from '@/lib/wallet-page'

/** A quoted sentence shown as an example: text, never a control. */
function Example({ ask }: { ask: string }) {
  return (
    <span className="mt-2 block text-[color:var(--muted-2)]" data-job-example>
      {JOBS_DOOR.exampleLead} <span className="text-[color:var(--muted)]">{`“${ask}”`}</span>
    </span>
  )
}

export function JobsEmptyDoor({ eyebrow, run, compact = true }: { eyebrow: string; run: (ask: string) => void; compact?: boolean }) {
  const view = useJobOffer()

  let extra: ReactNode = null
  let primary: DoorAct | undefined
  switch (view.state) {
    case 'offer':
      extra = (
        <span className="mt-2 block" data-job-offer-why>
          {view.offer.why} <span className="text-[color:var(--muted-2)]">{`It would run: “${view.offer.ask}”`}</span>
        </span>
      )
      primary = { kind: 'ask', label: `${view.offer.label} →`, ask: view.offer.ask }
      break
    case 'fund':
      extra = (
        <span className="mt-2 block" data-job-offer-note>
          {view.note}
        </span>
      )
      primary = { kind: 'spine', label: JOBS_DOOR.fundLabel, href: WALLET_PAGE_HREF }
      break
    case 'unread':
      extra = (
        <span className="mt-2 block text-[color:var(--muted-2)]" data-job-offer-note>
          {view.note}
        </span>
      )
      break
    case 'loading':
      extra = (
        <span className="mt-2 block text-[color:var(--muted-2)]" data-job-offer-reading>
          {JOBS_DOOR.reading}
        </span>
      )
      break
    case 'connect':
      extra = <Example ask={view.example} />
      primary = {
        kind: 'node',
        // The unified door's connect-only lane (rule 6). No redirectTo: the
        // visitor stays on the page they are on.
        node: cdpEnabled ? <CreateAccountButton walletConnectOnly className="door__cta" label={JOBS_DOOR.connectLabel} /> : <AuthButton />,
      }
      break
  }

  return (
    <div data-job-offer={view.state}>
      <EmptyDoor
        id="jobs"
        compact={compact}
        eyebrow={eyebrow}
        title={JOBS_DOOR.title}
        body={
          <>
            {JOBS_DOOR.body}
            {extra}
          </>
        }
        lines={JOBS_DOOR.lines}
        primary={primary}
        run={run}
      />
    </div>
  )
}

/** For prose. Renders the example sentence as plain text; when THIS wallet
 *  can run a job, adds a link that prefills that wallet's own sentence in the
 *  chat (a link prefills, it never sends). Nothing else is ever a link. */
export function JobOfferLine({ example, className }: { example: string; className?: string }) {
  const view = useJobOffer()
  return (
    <span className={className} data-job-offer={view.state}>
      {`“${example}”`}
      {view.state === 'offer' && (
        <>
          {' '}
          (
          <SpineLink href={`/chat?mcps=robinhood-free&prompt=${encodeURIComponent(view.offer.ask)}`} prefetch={false} title={view.offer.ask}>
            {`run one sized to your wallet, from ${view.offer.originName}`}
          </SpineLink>
          )
        </>
      )}
    </span>
  )
}
