/**
 * Which layer of the transaction stack produced a turn's signable artifact.
 *
 * The aggregate sibling of the per-turn route_trace_lines detail (PR #385):
 * every tx-built chat response names its builder, the client echoes it on the
 * tx-built AND signed telemetry beacons (embed_turns.build_path), and
 * /dashboard/embeds rolls it into a per-layer built → signed breakdown —
 * "which layer creates transactions, and which layer's builds die unsigned".
 *
 * - native-*  — Yeetful's deterministic guardrailed builders (the parse →
 *               verified-tool-call → guard recipes in app/api/chat/route.ts +
 *               lib/aave-supply.ts / lib/aave-ops.ts / lib/uniswap-venue.ts /
 *               lib/cow-build.ts / lib/cross-chain-swap.ts).
 * - planner   — a MODEL-planned tool call returned the signable: the endpoint
 *               planner's smart loop or the Auto-Router engine (lib/router.ts).
 *               The artifact came out of a tool result the model chose to
 *               call, not a native builder.
 * - manual    — a directly-called working-set tool returned it with no
 *               planning step (e.g. snapshot prepare_vote in the manual
 *               mcpDataServers loop).
 */
export const BUILD_PATHS = [
  'native-aave-supply',
  'native-aave-op',
  'native-swap-uniswap',
  'native-swap-uniswap-v4',
  'native-swap-cow',
  'native-cross-chain',
  'planner',
  'manual',
] as const

export type BuildPath = (typeof BUILD_PATHS)[number]

/** Validate a self-reported beacon value — anything else is dropped, never stored. */
export function isBuildPath(v: unknown): v is BuildPath {
  return typeof v === 'string' && (BUILD_PATHS as readonly string[]).includes(v)
}
