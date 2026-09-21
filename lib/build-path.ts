/**
 * Which layer of the transaction stack produced a turn's signable artifact.
 *
 * The aggregate sibling of the per-turn route_trace_lines detail (PR #385):
 * every tx-built chat response names its builder, the client echoes it on the
 * tx-built AND signed telemetry beacons (embed_turns.build_path), and
 * /dashboard/embeds rolls it into a per-layer built → signed breakdown —
 * "which layer creates transactions, and which layer's builds die unsigned".
 *
 * - native-*  — Pantessa's deterministic guardrailed builders (the parse →
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
 * - app-mode-* — App Mode panels (the structured workspace face). The build
 *               still runs through the native layers (/api/panels/* reuses
 *               the same builders + guardrails); the distinct path splits
 *               chat vs workspace conversion in the built → signed funnel.
 */
export const BUILD_PATHS = [
  'native-aave-supply',
  'native-aave-op',
  'native-morpho-lend',
  'native-morpho-op',
  'native-swap-uniswap',
  'native-swap-uniswap-v4',
  'native-swap-lifi',
  'native-swap-cow',
  'native-cross-chain',
  // A cross-chain leg INSIDE a job — the same builder, DELIBERATELY fee-free
  // (lib/jobs-runner asks 1Click for no appFees: "insufficient funds" must
  // never cost extra to fix). Its own path so the fee map can't claim a fee
  // the leg never charged.
  'native-cross-chain-leg',
  // A LiFi funding leg inside a job (lib/lifi-bridge) — fee-free by the same
  // rule; the venue is LiFi, the fee is nobody's.
  'native-fund-bridge',
  'native-transfer',
  'native-nft-transfer',
  'native-nft-list',
  'native-nft-buy',
  'native-lido',
  'native-hl-guardian',
  'native-hl-exec',
  // The HL bridge-deposit on-ramp: an Arbitrum USDC transfer to Bridge2. It
  // carries NO builder fee (that rides the perp ORDER), so it can't share
  // native-hl-exec's fee-bearing path.
  'native-hl-deposit',
  'native-job',
  'planner',
  'manual',
  'app-mode-swap',
  'app-mode-vote',
] as const

export type BuildPath = (typeof BUILD_PATHS)[number]

/** Validate a self-reported beacon value — anything else is dropped, never stored. */
export function isBuildPath(v: unknown): v is BuildPath {
  return typeof v === 'string' && (BUILD_PATHS as readonly string[]).includes(v)
}

/** The bucket for value we can't name a venue for: legacy rows written before
 *  per-layer tagging, and paths that record a surface rather than a venue. */
export const UNATTRIBUTED_VENUE = 'unattributed'

/**
 * Which VENUE each build path settled against — the public-facing name the
 * /activity flow map and venue table render.
 *
 * `Record<BuildPath, string>` on purpose: a new entry in BUILD_PATHS fails tsc
 * until it names its venue. That compile-time gate is the whole point — the
 * map used to be a partial lookup in the overview route with `?? path` as its
 * fallback, so any path nobody remembered to add (native-swap-lifi, the whole
 * NFT layer, both app-mode paths) rendered as a raw `native-…` string in a
 * PUBLIC diagram. A venue is a product name; a build path is an internal one.
 */
export const VENUE_OF_BUILD_PATH: Record<BuildPath, string> = {
  'native-aave-supply': 'aave',
  'native-aave-op': 'aave',
  'native-morpho-lend': 'morpho',
  'native-morpho-op': 'morpho',
  'native-swap-uniswap': 'uniswap',
  'native-swap-uniswap-v4': 'uniswap',
  // The LiFi settlement venue — venue-gated pools (Robinhood tokenized stocks)
  // route through the chain's own swap venue (lib/lifi-venue.ts).
  'native-swap-lifi': 'lifi',
  'native-swap-cow': 'cow',
  'native-cross-chain': 'near-intents',
  'native-cross-chain-leg': 'near-intents',
  'native-fund-bridge': 'lifi',
  'native-transfer': 'transfer',
  'native-nft-transfer': 'opensea',
  'native-nft-list': 'opensea',
  'native-nft-buy': 'opensea',
  'native-lido': 'lido',
  'native-hl-guardian': 'hyperliquid',
  'native-hl-exec': 'hyperliquid',
  'native-hl-deposit': 'hyperliquid',
  'native-job': 'jobs',
  planner: 'planner',
  manual: 'manual',
  // app-mode-* are SURFACE tags, not venue tags — that split (chat vs
  // workspace) is why they exist at all. GovernancePanel is unambiguously
  // Snapshot, so that one resolves; the swap panel runs the same three-venue
  // cascade as chat (v3 → v4 → LiFi) and throws the winner away, so its venue
  // genuinely isn't in the row. Guessing 'uniswap' would print a LiFi stock
  // swap as a Uniswap one — an unattributed lane is the honest answer.
  'app-mode-vote': 'snapshot',
  'app-mode-swap': UNATTRIBUTED_VENUE,
}

/**
 * job_steps.builder → venue, for the builders that only ever appear inside a
 * chain (VENUE_OF_BUILD_PATH covers the ones that also tag a standalone turn).
 * Not exhaustive by type: `builder` is a free-form column, and unknown
 * builders resolve to null rather than leaking the raw string.
 *
 * `wait` is deliberately absent: a wait is a settlement predicate, not a
 * venue, and the chain renders it as its own kind of node.
 */
export const VENUE_OF_JOB_BUILDER: Record<string, string> = {
  'native-lifi-fund': 'lifi',
  'native-lifi-swap': 'lifi',
  'native-swap': 'uniswap',
  'native-transfer': 'transfer',
  'native-nft-buy': 'opensea',
  'native-aave': 'aave',
  'native-aave-repay': 'aave',
  'native-morpho-repay': 'morpho',
  'native-lido': 'lido',
}

/**
 * Resolve a stored build_path (or a job step's builder) to its venue.
 *
 * Returns null when nothing maps — NEVER the raw input. Callers pick the
 * fall-through their surface needs: an aggregate lane buckets null into
 * {@link UNATTRIBUTED_VENUE}, a chain step renders no protocol mark at all.
 */
export function venueOfBuildPath(path: string | null | undefined): string | null {
  if (!path) return null
  return VENUE_OF_BUILD_PATH[path as BuildPath] ?? VENUE_OF_JOB_BUILDER[path] ?? null
}
