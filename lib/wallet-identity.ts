// lib/wallet-identity.ts — name the wallet that is actually signing.
//
// The Wallet page's header is the one place the app says WHICH wallet holds
// the money, and it read `connector.name`. That name is the LANE's name, not
// the extension's, and the two come apart on any browser with one wallet and
// several lanes pointed at it:
//
//   · A lane bound to somebody else's provider names them wrongly — the
//     Phantom lane did exactly that (lib/phantom-lane).
//   · The catch-all injected lane wins wagmi's reconnect ahead of the
//     EIP-6963 connector (it shares `window.ethereum` and sits earlier in the
//     config), so a returning MetaMask user was greeted with "Browser
//     Wallet" — not a lie, but not the wallet's name either.
//
// EIP-6963 already answers the question: every extension announces
// `{ info: { name, rdns }, provider }`, and the provider is the same object
// the connector hands back. Match on identity and the header can say
// MetaMask because MetaMask said so — no flag sniffing, no guessing.
//
// Pure half here; the React half is lib/use-wallet-name.

export type AnnouncedWallet = { name: string; rdns?: string; provider: unknown }

/** The announced name for this provider, by object identity. Undefined when
 *  nothing announced it (a wallet with no EIP-6963 support, an embedded
 *  wallet, the embed's host bridge) — the caller keeps its own label then. */
export function announcedNameFor(
  announced: readonly AnnouncedWallet[],
  provider: unknown,
): string | undefined {
  if (!provider) return undefined
  const hit = announced.find((a) => a.provider === provider)
  const name = hit?.name?.trim()
  return name ? name : undefined
}

/** Lanes whose name is a category, not a wallet: these are the ones an
 *  announcement is allowed to rename. A branded lane (Coinbase, Phantom,
 *  Rainbow, the Pantessa embedded wallet, the embed's host bridge) keeps the
 *  name it connected under — it IS that wallet, and after lib/phantom-lane no
 *  branded lane can bind to a stranger's provider. */
const GENERIC_LANE_IDS = new Set(['injected', 'metaMask'])
const GENERIC_LANE_NAMES = new Set(['browser wallet', 'injected', 'connected wallet'])

export function laneIsGeneric(connectorId: string | undefined, connectorName: string | undefined): boolean {
  if (connectorId && GENERIC_LANE_IDS.has(connectorId)) return true
  return GENERIC_LANE_NAMES.has((connectorName ?? '').trim().toLowerCase())
}

/** The name to show: the announcement when the lane is a category, else the
 *  lane's own name. `metaMask` is in the generic set because that lane is the
 *  MetaMask SDK, which announces itself properly and can be the wrapper for a
 *  differently-branded MetaMask build. */
export function walletDisplayName(
  connectorId: string | undefined,
  connectorName: string | undefined,
  announcedName: string | undefined,
): string | undefined {
  if (announcedName && laneIsGeneric(connectorId, connectorName)) return announcedName
  return connectorName
}
