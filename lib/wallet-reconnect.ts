// lib/wallet-reconnect.ts — the two boot-time decisions a wallet surface
// makes before it knows anything, kept pure so the harness can pin them.
//
// THE STRANGER'S FIRST FIVE SECONDS (squad gtm 2026-09-08, ONBOARDING lane).
// wagmi reports `reconnecting` on every page load until EVERY connector has
// settled — and with the WalletConnect lane lit (NEXT_PUBLIC_WC_PROJECT_ID)
// that takes ~4s. Both first-party surfaces treated "not settled" as "a
// wallet may be about to appear" and held their door behind a loader:
// measured on a prod build, the /i splash's "Connect & build my path"
// button first rendered at 5.3s and /chat's empty state (the invitation +
// example chips) at 4.4s — for a visitor who has NEVER connected a wallet
// here, so there was nothing to reconnect. wagmi persists what it would
// reconnect (`wagmi.store` → state.current + connections, and
// `wagmi.recentConnectorId`); when neither names a connection, the wait is
// pure theatre and the door can paint on the first frame. A returning wallet
// still gets its branded pause: the store names it.

/** The subset of `Storage` these helpers read — localStorage in the browser,
 *  a plain object in the harness. */
export type StorageLike = { getItem(key: string): string | null }

/** wagmi's persisted keys (createStorage's default prefix is 'wagmi'). */
export const WAGMI_STORE_KEY = 'wagmi.store'
export const WAGMI_RECENT_CONNECTOR_KEY = 'wagmi.recentConnectorId'

/** True when wagmi has a connection it will try to restore on this load —
 *  the ONLY case where "checking for a connected wallet" is worth showing.
 *  Fails CLOSED to false (no storage, blocked storage, unparseable JSON): a
 *  visitor we can't read is treated as new, and a connector that settles
 *  connected anyway still takes over the surface (isConnected is the truth;
 *  this only decides what to paint meanwhile). */
export function hasStoredWalletConnection(storage: StorageLike | null | undefined): boolean {
  if (!storage) return false
  try {
    const recent = storage.getItem(WAGMI_RECENT_CONNECTOR_KEY)
    if (recent && recent !== 'null' && recent !== '""') return true
    const raw = storage.getItem(WAGMI_STORE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { state?: { current?: unknown; connections?: { value?: unknown[] } } }
    const state = parsed?.state
    if (!state) return false
    if (typeof state.current === 'string' && state.current.length > 0) return true
    return Array.isArray(state.connections?.value) && state.connections.value.length > 0
  } catch {
    return false
  }
}

/** Window for the connect-wallet re-run below: a "connect your wallet to
 *  continue" reply older than this is a conversation the visitor walked away
 *  from, not one they are still in. */
export const CONNECT_ASK_RERUN_WINDOW_MS = 2 * 60 * 1000

/** A transactional ask that arrived without a wallet gets a "Connect wallet
 *  to continue" reply; the button re-runs the ask when an address lands.
 *  But the address can land WITHOUT the button: a returning visitor's wallet
 *  reconnects ~4s after load (the WC-lane init above), and an example chip
 *  tapped at 4.4s runs before it — live on 2026-09-08 the reply said "connect
 *  your wallet" while the banner said "Wallet connected", the button hid
 *  (address present) and the ask was stranded. This decides the re-run for
 *  that path: the LAST message in the thread is a fresh connect-wallet reply,
 *  an address just arrived, and nothing is in flight. */
export function shouldRerunConnectAsk(input: {
  /** The thread's last message, or null for an empty thread. */
  last: { role: string; meta?: unknown; createdAt?: string } | null
  hasAddress: boolean
  loading: boolean
  now: number
}): string | null {
  const { last, hasAddress, loading, now } = input
  if (!hasAddress || loading || !last || last.role !== 'assistant') return null
  const meta = last.meta as { connectWallet?: unknown; connectAsk?: unknown } | undefined
  if (meta?.connectWallet !== true || typeof meta.connectAsk !== 'string' || !meta.connectAsk.trim()) return null
  const at = last.createdAt ? Date.parse(last.createdAt) : NaN
  if (!Number.isFinite(at) || now - at > CONNECT_ASK_RERUN_WINDOW_MS || now < at - 60_000) return null
  return meta.connectAsk
}

// ── The connect gate's way back ─────────────────────────────────────────
// "Connect wallet to continue" flips to "Connecting…" the moment it is
// pressed and used to stay there FOREVER unless an address landed: dismiss
// the door, pick a wallet that isn't installed, reject the connection — the
// chip was dead and every later ask read "Connecting…" too (QA O-4, squad gtm
// 2026-09-08, reproduced live). The gate releases once nothing is still
// trying: no door up, no wallet list up, no connector mid-handshake, and no
// address. CONNECT_ASK_RELEASE_GRACE_MS covers the beat between the door
// closing and the wallet list opening (same tick, different renders).
export const CONNECT_ASK_RELEASE_GRACE_MS = 700

export function connectAskReleased(input: {
  /** The gate is armed (a connect ask is pending). */
  pending: boolean
  hasAddress: boolean
  /** The unified door (CreateAccountModal) is on screen. */
  doorOpen: boolean
  /** RainbowKit's wallet list is on screen. */
  listOpen: boolean
  /** wagmi's account status — 'connecting' = a connector is mid-handshake
   *  (an extension popup, a deep link, a QR wait); 'reconnecting' = the
   *  mount-time restore probe, which with the WalletConnect lane lit runs
   *  ~9s after load on a fresh page. */
  walletStatus: 'connected' | 'connecting' | 'reconnecting' | 'disconnected'
  /** hasStoredWalletConnection(): only then can 'reconnecting' land an
   *  address. A fresh visitor's probe restores nothing — waiting on it held
   *  "Connecting…" ~4s after the door was dismissed (measured live). */
  storedConnection: boolean
}): boolean {
  const { pending, hasAddress, doorOpen, listOpen, walletStatus, storedConnection } = input
  if (!pending || hasAddress) return false
  if (doorOpen || listOpen) return false
  if (walletStatus === 'connecting') return false
  if (walletStatus === 'reconnecting' && storedConnection) return false
  return true
}
