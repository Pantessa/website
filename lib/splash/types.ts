// Splash dashboard: the shape a connected MCP contributes to the "you just
// jumped in" screen, and the render primitives the client knows how to draw.
//
// The design goal is scale: a new MCP shouldn't need new frontend. It ships an
// "overview" read tool, its source (lib/splash/sources.ts) maps that tool's
// output onto ONE of these render primitives, and the tile draws itself. Add a
// genuinely new shape → add a primitive here + a renderer; reuse an existing
// shape → zero UI work.

export interface SuggestedPrompt {
  /** Chip label shown to the user. */
  label: string
  /** Full text dropped into the chat input when the chip is picked. */
  prompt: string
}

interface TileBase {
  /** Stable id (usually the mcp slug + render kind). */
  id: string
  mcpSlug: string
  mcpName: string
  title: string
  subtitle?: string
  /** Suggested prompts that carry this tile's context into chat. */
  prompts: SuggestedPrompt[]
}

export interface HoldingRow {
  symbol: string
  address: string
  balance: string
  priceUsd: number | null
  valueUsd: number | null
  native?: boolean
}

export interface ProposalRow {
  id: string
  title: string
  spaceId: string
  spaceName: string
  /** Resolved logo URL (Snapshot stamp service — always resolvable by space id). */
  avatarUrl: string
  choices: string[]
  /** Index of the currently leading choice, or null when no votes yet. */
  leadingChoice: string | null
  /** Unix seconds the vote closes. */
  endsAt: number
}

export interface SpaceRow {
  id: string
  name: string
  avatarUrl: string
}

/** A portfolio-style holdings table (Uniswap, and any balances-bearing MCP). */
export type HoldingsTile = TileBase & {
  render: 'holdings'
  totalUsd: number | null
  chain: string
  holdings: HoldingRow[]
}

/** A "things to act on" list with logos (Snapshot proposals, and any
 *  action-queue MCP). */
export type ProposalsTile = TileBase & {
  render: 'proposals'
  spaces: SpaceRow[]
  proposals: ProposalRow[]
}

/** A source that resolved but has nothing to show (empty wallet, no follows). */
export type EmptyTile = TileBase & { render: 'empty'; message: string }

export type SplashTile = HoldingsTile | ProposalsTile | EmptyTile

export interface SplashResponse {
  address: string
  tiles: SplashTile[]
}
