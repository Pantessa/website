// "Verify with X": the account itself proves its handle (OAuth 2.0 with
// PKCE), which is the only thing that makes a plot "verified".
//
// CONTRACT STUB (squad called-it, 2026-11-11): lane AUTH writes the bodies
// and the routes under app/api/x/auth/**, and keeps these names. Every other
// lane reads identity through getXIdentity and links through xAuthStartHref.
export interface XIdentity {
  xUserId: string
  /** Lowercase, no @. */
  handle: string
  name: string
  avatarUrl: string | null
  /** When X confirmed it (ms). */
  at: number
}

/** The X account this browser proved, or null. Server only (reads a signed httpOnly cookie). */
export async function getXIdentity(): Promise<XIdentity | null> {
  return null
}

/** Where a "Verify with X" button goes. `next` is a path on this site to return to. */
export function xAuthStartHref(next: string): string {
  return `/api/x/auth/start?next=${encodeURIComponent(next)}`
}
