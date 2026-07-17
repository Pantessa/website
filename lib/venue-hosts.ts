// ─────────────────────────────────────────────────────────────────────────
//  Native venue policy hosts — the SYNTHETIC hosts Yeetful's own guarded
//  transaction layers attribute spend to (lib/uniswap-venue, lib/lifi-venue,
//  lib/cow-guardrails, the Aave gate, HL exec). They are not MCP endpoints,
//  so an allowlist derived from the directory can never contain them — every
//  consumer that builds or explains an allowlist must union / label them
//  from HERE, or native swaps go NOT_ALLOWED with no way out (the trap that
//  ate Nate's first DCA). Pure module: safe on client and server.
//
//  Adding a venue? Three touchpoints, all here-adjacent: (1) this list,
//  (2) the label below, (3) pass a policyBlock to buildReport at the gate.
// ─────────────────────────────────────────────────────────────────────────

/** Always-allowed spend-attribution hosts of the native guarded layers.
 *  The user signs every one of these transactions themselves — the caps
 *  still gate them, the allowlist never should. */
export const NATIVE_VENUE_HOSTS = [
  'uniswap.yeetful.com',
  'lifi.yeetful.com',
  'api.cow.fi',
  'aave-mcp.yeetful.com',
  'api.hyperliquid.xyz',
] as const

/** Friendly names — "uniswap.yeetful.com" reads as a mystery third party
 *  when it's really the native swap layer. */
export const VENUE_HOST_LABELS: Record<string, string> = {
  'uniswap.yeetful.com': "Yeetful's native Uniswap venue",
  'lifi.yeetful.com': "Yeetful's LiFi settlement venue",
  'api.cow.fi': 'the CoW Swap venue',
  'aave-mcp.yeetful.com': 'the Aave agent',
  'api.hyperliquid.xyz': 'the Hyperliquid venue',
}
