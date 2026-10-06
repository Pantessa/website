'use client'

// The named failure line (squad pre-gtm POLISH r2): what a panel says when its
// read failed — as opposed to "—", which stays for data that is genuinely
// empty. Quiet (muted mono, one line), says WHAT didn't load, and offers a
// retry where one makes sense. `.fetchfail` lives in app/globals.css.

export default function FetchFailed({
  what,
  onRetry,
  busy = false,
  className,
}: {
  /** What did not load, as a noun phrase: "the daily series", "the order book". */
  what: string
  onRetry?: () => void
  busy?: boolean
  className?: string
}) {
  return (
    <p className={`fetchfail mono${className ? ` ${className}` : ''}`} role="status" data-fetch-failed>
      <span>Couldn’t read {what}.</span>
      {onRetry && (
        <button type="button" className="fetchfail__retry" onClick={onRetry} disabled={busy}>
          {busy ? 'Trying…' : 'Try again'}
        </button>
      )}
    </p>
  )
}
