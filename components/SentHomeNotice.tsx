'use client'

// The splash's one line for a visitor the app just sent here (lib/app-entry
// sentHomeNotice). They opened /chat, /wallet or the dashboard without a
// wallet; the signed-out gate brought them home and remembered the way back.
// This says so and offers the door. A sign-in from the landing already lands
// on the remembered page (lib/session signInLandingHere), so the button
// passes no destination of its own.
//
// It rides the splash's lead seat now (squad front-door, 2026-10-06 —
// `/` is the markets index in the app shell, components/home/HomeSurface):
// a left-aligned row the full width of the data column, not the centered
// island it was on the brochure.

import { useEffect, useState } from 'react'
import CreateAccountButton from '@/components/CreateAccountButton'
import { useSession } from '@/lib/session'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { SIGN_IN_RETURN_KEY, readSignInReturn, sentHomeNotice, type SentHomeNotice as Notice } from '@/lib/app-entry'

export default function SentHomeNotice() {
  const { signedOut, connectAndSignIn } = useSession()
  const [notice, setNotice] = useState<Notice | null>(null)
  useEffect(() => {
    try {
      setNotice(sentHomeNotice(readSignInReturn(window.sessionStorage.getItem(SIGN_IN_RETURN_KEY), Date.now())))
    } catch {
      // storage blocked: nothing was remembered, nothing to say
    }
  }, [])
  if (!notice || !signedOut) return null
  const dismiss = () => {
    setNotice(null)
    try {
      window.sessionStorage.removeItem(SIGN_IN_RETURN_KEY)
    } catch {
      // nothing kept
    }
  }
  const cta = 'btn btn--solid'
  return (
    <div
      role="status"
      data-sent-home
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-3.5 py-2.5 text-[13px] leading-snug text-[color:var(--muted)]"
    >
      <span className="min-w-[16rem] flex-1">
        {notice.ask ? (
          <>
            <b className="text-[color:var(--fg)]">&ldquo;{notice.ask}&rdquo;</b> needs a wallet to run. Sign in and it is waiting for you; nothing
            moves until you sign.
          </>
        ) : (
          <>Opening {notice.what} needs a wallet. Sign in and you land right back there.</>
        )}
      </span>
      {cdpEnabled ? (
        <CreateAccountButton className={cta} label="Sign in" />
      ) : (
        <button type="button" className={cta} onClick={() => connectAndSignIn()}>
          Sign in
        </button>
      )}
      <button type="button" className="underline underline-offset-2" onClick={dismiss}>
        Not now
      </button>
    </div>
  )
}
