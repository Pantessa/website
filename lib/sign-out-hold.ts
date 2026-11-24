/**
 * SIGN OUT MEANS GONE, across reloads too (Nate, 2026-11-24: "I pressed sign
 * out, but the address bar still says I am connected").
 *
 * wagmi's disconnect only forgets the wallet on OUR side. The site stays
 * authorized inside the wallet, and the injected connector keeps listening
 * to the provider: the next `connect` or `accountsChanged` it emits (an
 * unlock, an account switch, a page load in some wallets) runs
 * `onConnect`, which reconnects wagmi without anyone pressing anything and
 * even wipes the `<id>.disconnected` shim. So a visitor who signed out came
 * back to the gray "connected, not signed" pill.
 *
 * Two parts close it:
 *  1. lib/session asks the wallet to revoke the site's permission
 *     (`wallet_revokePermissions`, MetaMask and the wallets that copy it)
 *     with time to answer, and clears wagmi's "remember me" keys.
 *  2. This HOLD: a localStorage flag written on sign-out. While it is set,
 *     a wallet connection that arrives without the visitor opening the
 *     connect list is dropped again. Opening the list ends the hold.
 *
 * Pure (no wagmi, no window) so the harness pins it.
 */

export const SIGN_OUT_HOLD_KEY = 'pantessa.signedOutHold'

/** wagmi's storage keys (createStorage prefixes 'wagmi.'). */
export const WAGMI_KEYS_TO_FORGET = ['wagmi.recentConnectorId', 'wagmi.injected.connected'] as const

type StorageRW = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export function setSignOutHold(storage: StorageRW | null | undefined, now: number): void {
  try {
    storage?.setItem(SIGN_OUT_HOLD_KEY, String(now))
  } catch {
    // storage blocked: the revoke and the disconnect still ran
  }
}

export function clearSignOutHold(storage: StorageRW | null | undefined): void {
  try {
    storage?.removeItem(SIGN_OUT_HOLD_KEY)
  } catch {
    // storage blocked: nothing was held
  }
}

export function hasSignOutHold(storage: Pick<StorageRW, 'getItem'> | null | undefined): boolean {
  try {
    const v = storage?.getItem(SIGN_OUT_HOLD_KEY)
    return typeof v === 'string' && v.length > 0
  } catch {
    return false
  }
}

/**
 * Forget the wallet the way a brand-new visitor's browser has never known it:
 * no recent connector, no targetless-injected flag, and the `<id>.disconnected`
 * shim written for every connector id we have, so wagmi's page-load reconnect
 * authorizes nothing.
 */
export function forgetWalletKeys(storage: StorageRW | null | undefined, connectorIds: readonly string[]): void {
  if (!storage) return
  try {
    for (const key of WAGMI_KEYS_TO_FORGET) storage.removeItem(key)
    for (const id of connectorIds) storage.setItem(`wagmi.${id}.disconnected`, 'true')
  } catch {
    // storage blocked: the hold below cannot be written either; the
    // in-memory disconnect still ran
  }
}

export type WagmiStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected'

/**
 * What one wagmi status change means while a sign-out hold may be set:
 * 'drop' when a wallet arrived on its own, 'none' otherwise.
 *
 * No wagmi status says "the visitor pressed connect": a page-load
 * `reconnect` with nothing stored passes through `connecting` too, and an
 * authorized extension then lands as `connected` (measured 2026-11-24). So
 * the hold is never released here. It ends only on a gesture: lib/session
 * clears it when the connect list opens, and every connect that does not
 * go through that list is an exempt connector (the CDP account behind its
 * own door, the embed's host wallet, which is the HOST page's).
 */
export function signOutHoldStep(input: {
  held: boolean
  next: WagmiStatus
  connectorId: string | null
  exemptConnectorIds: readonly string[]
}): 'drop' | 'none' {
  if (!input.held || input.next !== 'connected') return 'none'
  if (input.connectorId && input.exemptConnectorIds.includes(input.connectorId)) return 'none'
  return 'drop'
}
