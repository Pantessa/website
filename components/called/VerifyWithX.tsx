'use client'

// "Verify with X": the one button a handle's owner presses to make their own
// plots verified. CONTRACT STUB (squad called-it): lane AUTH owns this file
// and replaces the body (signed-in state from GET /api/x/me, sign out, the
// unavailable state). The props are the contract; lanes CHART and RECORD
// mount it as it is.
import { xAuthStartHref } from '@/lib/called-it/x-auth'

export interface VerifyWithXProps {
  /** A path on this site to come back to. Defaults to the page the button is on, read on press. */
  next?: string
  /** `button` stands alone; `line` sits inside a sentence. */
  variant?: 'button' | 'line'
  className?: string
}

export default function VerifyWithX({ next, variant = 'button', className }: VerifyWithXProps) {
  return (
    <a
      className={className}
      data-variant={variant}
      data-journey="called_verify_x"
      href={xAuthStartHref(next ?? '/x')}
      onClick={(e) => {
        if (next) return
        e.preventDefault()
        window.location.href = xAuthStartHref(window.location.pathname + window.location.search)
      }}
    >
      Verify with X
    </a>
  )
}
