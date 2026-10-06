'use client'

// THE KEEP-IT MOMENT (squad pre-gtm, FIRSTRUN r3). After the FIRST signed
// receipt a visitor should see what they just did — the sentence, the dollars,
// the on-chain receipt — and ONE warm invitation to sign in and keep the thread
// and their record. Connect to act, sign in to keep (rule 6): the invitation
// comes AFTER the aha, never before it, and it never blocks: "Not now" quiets
// it for the session; the chat and the receipt stay usable either way.
//
// Rendered by /i (IntentRuntime's post-receipt bar) and /chat (ChatSignInGate's
// connected banner once a receipt exists). The surface owns the sign-in call
// (`onKeep` = useSession().signIn); this card owns the words and the look.

import { useState } from 'react'
import { Fingerprint, Loader2 } from 'lucide-react'
import { KEEP_IT } from '@/lib/first-run'
import { PantessaMark } from '@/components/Logo'
import './guide.css'

export type KeepItBarProps = {
  /** Where the receipt happened — the dismissal is remembered per id for this session. */
  id: string
  ask?: string | null
  valueUsd?: number | null
  txUrl?: string | null
  onKeep: () => void
  busy?: boolean
  /** One row (the phone's in-flow seat). */
  compact?: boolean
}

const dismissKey = (id: string) => `pantessa.keep.notnow.${id}`

function fmtUsd(n: number): string {
  return n >= 100 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`
}

export default function KeepItBar({ id, ask, valueUsd, txUrl, onKeep, busy = false, compact = false }: KeepItBarProps) {
  const [gone, setGone] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && window.sessionStorage.getItem(dismissKey(id)) === '1'
    } catch {
      return false
    }
  })
  if (gone) return null
  const notNow = () => {
    try {
      window.sessionStorage.setItem(dismissKey(id), '1')
    } catch {
      /* private mode: forgets on reload, that is all */
    }
    setGone(true)
  }
  const facts: string[] = []
  if (typeof valueUsd === 'number' && valueUsd > 0) facts.push(`${fmtUsd(valueUsd)} moved`)
  facts.push('signed by your wallet')

  return (
    <aside className={compact ? 'keep keep--compact' : 'keep'} role="note" aria-label={KEEP_IT.aria} data-keep-it={id}>
      <span className="keep__mark" aria-hidden>
        <PantessaMark size={compact ? 20 : 26} />
      </span>
      <div className="keep__body">
        <p className="keep__title">
          {KEEP_IT.title}
          {ask ? <span className="keep__ask"> “{ask}”</span> : null}
        </p>
        <p className="keep__facts">
          {facts.join(' · ')}
          {txUrl ? (
            <>
              {' · '}
              <a href={txUrl} target="_blank" rel="noreferrer" className="keep__receipt">
                {KEEP_IT.receipt}
              </a>
            </>
          ) : null}
        </p>
        {!compact && <p className="keep__text">{KEEP_IT.body}</p>}
      </div>
      <div className="keep__acts">
        <button type="button" className="keep__cta" onClick={onKeep} disabled={busy} data-keep-act="keep">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Fingerprint className="w-3.5 h-3.5" />}
          {busy ? KEEP_IT.busy : KEEP_IT.cta}
        </button>
        <button type="button" className="keep__later" onClick={notNow} data-keep-act="later">
          {KEEP_IT.later}
        </button>
      </div>
    </aside>
  )
}
