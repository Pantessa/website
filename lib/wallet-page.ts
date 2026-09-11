/**
 * The wallet page (2026-09-11, Nate: "I love our wallet model, can we make
 * this a page in the app and put it on the left side bar as an option above
 * docs"). /wallet is the "Wallet details" window given the whole screen
 * beside the app spine. One address and one path test, shared by the spine
 * seat, the modal's door to the page, Navigation (no brochure nav here) and
 * NavAccount (sign-in and sign-out stay on the page). Pure, and pinned.
 */
export const WALLET_PAGE_HREF = '/wallet'

export function isWalletPath(pathname: string): boolean {
  return pathname === WALLET_PAGE_HREF || pathname.startsWith(`${WALLET_PAGE_HREF}/`)
}
