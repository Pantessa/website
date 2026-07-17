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
  /** Chain this holding lives on (multichain portfolios). Absent = single-chain. */
  chain?: string
  /** Per-row "act on this holding" prompts — the row expands to reveal them
   *  (e.g. tap AAPL → Buy more / Sell). Each drops its `prompt` into the
   *  composer, same as a tile chip. Absent → the row stays display-only. */
  actions?: SuggestedPrompt[]
}

/** One recent transaction (asset transfer) for the activity tile. */
export interface ActivityRow {
  hash: string
  /** Human chain label (Ethereum, Base, Arbitrum). */
  chain: string
  /** Direction relative to the connected wallet. */
  direction: 'in' | 'out' | 'self'
  /** Token symbol moved. */
  asset: string
  /** Human amount, pre-formatted (empty when unknown). */
  amount: string
  /** Short counterparty address (the other side of the transfer). */
  counterparty: string
  /** Unix seconds of the block, or 0 when unknown. */
  timestamp: number
  /** Block-explorer link for the tx hash. */
  explorerUrl: string
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
  /** Snapshot voting type (single-choice | basic | approval | ranked-choice |
   *  weighted | quadratic) — drives the choice encoding when a surface offers
   *  inline voting (App Mode's governance panel). Absent on rows cached
   *  before this field existed → treat as single-choice. */
  type?: string
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

/** A wallet's recent transactions across chains (in/out asset transfers). */
export type ActivityTile = TileBase & {
  render: 'activity'
  rows: ActivityRow[]
}

/** A source that FAILED to load — surfaced as a retryable card instead of
 *  silently vanishing (the old `.catch(() => null)` behaviour). */
export type ErrorTile = TileBase & { render: 'error'; message: string }

export interface StatRow {
  /** Left column — what the row is (e.g. "ETH long 2.5x", "WETH → USDC"). */
  label: string
  /** Right column — the headline value (e.g. "$1,204", "62% filled"). */
  value?: string
  /** Small print under the label (e.g. "entry $2,410 · liq $1,980"). */
  sub?: string
  /** Tint the value (PnL green/red). */
  tone?: 'pos' | 'neg'
  /** Per-row "act on this" prompts — the row expands to reveal them (e.g. tap
   *  an open CoW order → Cancel / Check status). Absent → display-only. */
  actions?: SuggestedPrompt[]
}

/** One owned NFT for the gallery tile. Values are PRE-FORMATTED strings
 *  (floor etc.) — the client never does money math on these. */
export interface NftRow {
  /** Display name ("Pudgy Penguin #2489"). */
  name: string
  /** Collection slug + human collection label. */
  collection: string
  collectionName: string
  /** Thumbnail URL (OpenSea CDN), or null → lettermark fallback. */
  imageUrl: string | null
  /** Human chain label (Ethereum, Base, Arbitrum). */
  chain: string
  contract: string
  tokenId: string
  standard: 'erc721' | 'erc1155'
  /** Pre-formatted floor line ("floor 4.26 ETH"), or null when unknown. */
  floor: string | null
  openseaUrl: string | null
  /** Per-NFT "act on this" prompts (Sell / Transfer) — same contract as
   *  HoldingRow.actions; each drops its prompt into the composer. */
  actions?: SuggestedPrompt[]
}

/** A wallet's NFT gallery (the opensea source): image-led rows that expand
 *  into sell/transfer chips. */
export type NftsTile = TileBase & {
  render: 'nfts'
  nfts: NftRow[]
}

/** A generic label/value list — positions, open orders, fills; any MCP whose
 *  overview is "a few rows of account state" reuses this with zero new UI. */
export type RowsTile = TileBase & {
  render: 'rows'
  /** Optional headline stat above the rows (e.g. account value). */
  headline?: { value: string; caption: string }
  rows: StatRow[]
}

export type SplashTile = HoldingsTile | ProposalsTile | RowsTile | ActivityTile | NftsTile | EmptyTile | ErrorTile

export interface SplashResponse {
  address: string
  tiles: SplashTile[]
}

/** Which servers can paint a splash/action tile — mirror of the source
 *  matchers in lib/splash/sources.ts, importable from client components
 *  (sources.ts itself is server-only: it pulls in the MCP caller). Servers
 *  outside the hand-coded set still qualify when they carry featured ("ping
 *  first") endpoints — `splashReady`, derived server-side in lib/catalog. */
export function splashCapable(s: { slug: string; name: string; splashReady?: boolean }): boolean {
  return !!s.splashReady || /uniswap|snapshot|cow|hyperliquid|aave|lido|robinhood|opensea/i.test(`${s.slug} ${s.name}`)
}
