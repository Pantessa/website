// ─────────────────────────────────────────────────────────────────────────
//  Display layer — rich, non-signable artifacts a tool result can carry.
//
//  The transaction layer (lib/transaction-layer.ts) turns tool returns into
//  SIGNABLE artifacts that interrupt the loop. This is its read-only sibling:
//  a tool that returns a recognized DISPLAY payload (today: the wallet MCP's
//  `kind:"portfolio"` shape) gets rendered as a rich card alongside the
//  synthesized text instead of being flattened into prose. The router keeps
//  looping/synthesizing as normal — the card is presentation, not control
//  flow.
// ─────────────────────────────────────────────────────────────────────────

export interface PortfolioHolding {
  symbol: string
  name?: string | null
  chain: string
  /** Human units, already formatted by the tool. */
  balance: string
  priceUsd?: number | null
  valueUsd?: number | null
  native?: boolean
  address?: string | null
}

export interface PortfolioDisplay {
  owner: string
  totalUsd: number
  chains: { chain: string; usd: number; holdings: number }[]
  holdings: PortfolioHolding[]
  hiddenDust?: number
  updatedAt?: string
}

const MAX_HOLDINGS = 40

function holdingOf(raw: unknown): PortfolioHolding | null {
  if (!raw || typeof raw !== 'object') return null
  const h = raw as Record<string, unknown>
  if (typeof h.symbol !== 'string' || typeof h.chain !== 'string' || typeof h.balance !== 'string') return null
  return {
    symbol: h.symbol,
    name: typeof h.name === 'string' ? h.name : null,
    chain: h.chain,
    balance: h.balance,
    priceUsd: typeof h.priceUsd === 'number' ? h.priceUsd : null,
    valueUsd: typeof h.valueUsd === 'number' ? h.valueUsd : null,
    native: h.native === true || undefined,
    address: typeof h.address === 'string' ? h.address : null,
  }
}

/**
 * Recognize a portfolio payload in an MCP tool's return (the wallet MCP's
 * `portfolio` tool emits exactly this shape). Strict on the load-bearing
 * fields, lenient on the rest — a partial match renders a partial card.
 */
export function portfolioFromToolResult(toolResult: unknown): PortfolioDisplay | null {
  if (!toolResult || typeof toolResult !== 'object') return null
  const d = toolResult as Record<string, unknown>
  if (d.kind !== 'portfolio') return null
  if (typeof d.owner !== 'string' || typeof d.totalUsd !== 'number' || !Array.isArray(d.holdings)) return null
  const holdings = d.holdings.map(holdingOf).filter((h): h is PortfolioHolding => h !== null)
  if (holdings.length === 0) return null
  const chains = Array.isArray(d.chains)
    ? d.chains
        .map((c) => {
          if (!c || typeof c !== 'object') return null
          const row = c as Record<string, unknown>
          if (typeof row.chain !== 'string' || typeof row.usd !== 'number') return null
          return { chain: row.chain, usd: row.usd, holdings: typeof row.holdings === 'number' ? row.holdings : 0 }
        })
        .filter((c): c is { chain: string; usd: number; holdings: number } => c !== null)
    : []
  return {
    owner: d.owner,
    totalUsd: d.totalUsd,
    chains,
    holdings: holdings.slice(0, MAX_HOLDINGS),
    hiddenDust: typeof d.hiddenDust === 'number' && d.hiddenDust > 0 ? d.hiddenDust : undefined,
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : undefined,
  }
}

/** Narrow a persisted Message.meta into a PortfolioDisplay, or null. The
 *  sibling of txRequestOf — PortfolioCard reads the card data from here. */
export function portfolioOf(meta: unknown): PortfolioDisplay | null {
  if (!meta || typeof meta !== 'object') return null
  const raw = (meta as Record<string, unknown>).portfolio
  if (!raw || typeof raw !== 'object') return null
  return portfolioFromToolResult({ ...(raw as object), kind: 'portfolio' })
}
