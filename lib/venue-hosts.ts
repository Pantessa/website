// ─────────────────────────────────────────────────────────────────────────
//  Native venue policy hosts — the SYNTHETIC hosts Pantessa's own guarded
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
 *  The user signs every one of these transactions themselves — the
 *  allowlist never gates them, and (since the self-signed cap exemption)
 *  neither do the caps for wallet-signed builds; only kill switches do. */
export const NATIVE_VENUE_HOSTS = [
  'uniswap.yeetful.com',
  'lifi.yeetful.com',
  'api.cow.fi',
  'aave-mcp.yeetful.com',
  'api.hyperliquid.xyz',
  'opensea.io',
] as const

/** House inference — every chat turn is attributed here. Curating agents
 *  must never cut it off: an allowlist without it refuses ALL chat turns
 *  (the "Yeetful · House NOT_ALLOWED" wall of 2026-07-17), which reads as
 *  the product being broken, not a policy choice. Union it wherever a
 *  concrete allowlist is derived, exactly like the venue hosts. */
export const HOUSE_INFERENCE_HOSTS = ['api.anthropic.com'] as const

/** Friendly names — "uniswap.yeetful.com" reads as a mystery third party
 *  when it's really the native swap layer. */
export const VENUE_HOST_LABELS: Record<string, string> = {
  'uniswap.yeetful.com': "Pantessa's native Uniswap venue",
  'lifi.yeetful.com': "Pantessa's LiFi settlement venue",
  'api.cow.fi': 'the CoW Swap venue',
  'aave-mcp.yeetful.com': 'the Aave agent',
  'api.hyperliquid.xyz': 'the Hyperliquid venue',
  'opensea.io': 'the OpenSea marketplace',
  // Labeled but NOT in NATIVE_VENUE_HOSTS above: a send to an arbitrary
  // recipient is exactly what a curated allowlist should get to gate — the
  // SpendPolicyFix card offers the allow when a curated account blocks it.
  'transfer.yeetful.com': "Pantessa's native token sends",
}
