// Single source of truth for the x402 MCP directory.
//
// Every entry is an x402-gated agent from agentic.market: pay-per-call in USDC
// on Base, no API keys. Two categories — Inference (LLMs) and Data.
//
// `callable: true` entries have a verified endpoint the chat can actually pay
// and call right now. The rest are featured in the directory and link out to
// their agentic.market page.

export interface McpServerData {
  id: string
  name: string
  slug: string
  description: string
  iconUrl: string | null
  category: string // 'Inference' | 'Data'
  websiteUrl: string | null
  color: string
  isDefault: boolean
  isCustom: boolean
  configSchema: Record<string, { type: string; label: string; required: boolean }> | null

  // x402 fields
  kind?: 'inference' | 'data'
  protocol?: 'mcp' | 'http' | null
  endpoint?: string | null
  tool?: string | null // MCP tool name (inference)
  queryParam?: string | null // primary query param (http data)
  priceUsd?: string | null // e.g. "0.01"
  network?: string | null // CAIP-2 or chain name, e.g. "base"
  callable?: boolean // true → chat can pay+call it today
}

export const CATEGORY_ICONS: Record<string, string> = {
  Inference: '🧠',
  Data: '📊',
  Search: '🔍',
  Media: '🎬',
  Social: '💬',
  Trading: '📈',
  Infra: '🛠️',
  Storage: '🗄️',
  Travel: '🧭',
  Other: '⚡',
  Custom: '⚡',
}

export const CATEGORY_COLORS: Record<string, string> = {
  Inference: 'from-violet-500/20 to-fuchsia-500/20',
  Data: 'from-emerald-500/20 to-teal-500/20',
  Custom: 'from-zinc-500/20 to-zinc-400/20',
}

// ── The catalog ──────────────────────────────────────────────────────────────

export const CATALOG: McpServerData[] = [
  // ── Inference ──────────────────────────────────────────────────────────────
  {
    id: 'yeetful-claude',
    name: 'Yeetful · Claude',
    slug: 'yeetful-claude',
    description:
      'Anthropic Claude Haiku 4.5 inference over MCP Streamable HTTP. ask_claude + claude_chat. Pay-per-call, no API key.',
    iconUrl: null,
    category: 'Inference',
    websiteUrl: 'https://agentic.market/services/anthropic-yeetful-com',
    color: '#D97757',
    isDefault: true,
    isCustom: false,
    configSchema: null,
    kind: 'inference',
    protocol: 'mcp',
    endpoint: 'https://anthropic.yeetful.com/api/mcp/mcp',
    tool: 'ask_claude',
    priceUsd: '0.005',
    network: 'base',
    callable: true,
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    slug: 'chatgpt',
    description:
      'GPT, Responses, Images, and audio APIs across x402-enabled gateways. Pay-per-call in USDC.',
    iconUrl: null,
    category: 'Inference',
    websiteUrl: 'https://agentic.market/?q=chatgpt',
    color: '#10A37F',
    isDefault: true,
    isCustom: false,
    configSchema: null,
    kind: 'inference',
    protocol: 'http',
    endpoint: 'https://blockrun.ai/api/v1/chat/completions',
    tool: 'openai/gpt-4o-mini',
    priceUsd: '0.001',
    network: 'base',
    callable: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    slug: 'deepseek',
    description: 'Frontier LLM for coding and reasoning, x402-gated. Pay-per-call in USDC on Base.',
    iconUrl: null,
    category: 'Inference',
    websiteUrl: 'https://agentic.market/?q=deepseek',
    color: '#4D6BFE',
    isDefault: true,
    isCustom: false,
    configSchema: null,
    kind: 'inference',
    protocol: 'http',
    endpoint: 'https://blockrun.ai/api/v1/chat/completions',
    tool: 'deepseek/deepseek-chat',
    priceUsd: '0.001',
    network: 'base',
    callable: true,
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    slug: 'google-gemini',
    description: 'Google Gemini models via x402-enabled gateways and agent wrappers.',
    iconUrl: null,
    category: 'Inference',
    websiteUrl: 'https://agentic.market/?q=gemini',
    color: '#4285F4',
    isDefault: true,
    isCustom: false,
    configSchema: null,
    kind: 'inference',
    protocol: 'http',
    endpoint: 'https://blockrun.ai/api/v1/chat/completions',
    tool: 'google/gemini-2.5-flash-lite',
    priceUsd: '0.001',
    network: 'base',
    callable: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    slug: 'groq',
    description: 'Ultra-fast LLM inference (Llama, DeepSeek, Gemma) over x402.',
    iconUrl: null,
    category: 'Inference',
    websiteUrl: 'https://agentic.market/?q=groq',
    color: '#F55036',
    isDefault: true,
    isCustom: false,
    configSchema: null,
    kind: 'inference',
    protocol: null,
    endpoint: null,
    priceUsd: '0.001',
    network: 'base',
    callable: false,
  },
  {
    id: 'venice',
    name: 'Venice',
    slug: 'venice',
    description:
      'Privacy-focused AI inference — text, image, audio, embeddings via OpenAI-compatible API, x402-gated.',
    iconUrl: null,
    category: 'Inference',
    websiteUrl: 'https://agentic.market/?q=venice',
    color: '#E84142',
    isDefault: true,
    isCustom: false,
    configSchema: null,
    kind: 'inference',
    protocol: null,
    endpoint: null,
    priceUsd: '0.001',
    network: 'base',
    callable: false,
  },

  // ── Data ─────────────────────────────────────────────────────────────────
  {
    id: 'tripadvisor',
    name: 'Tripadvisor',
    slug: 'tripadvisor',
    description:
      'Travel content API — detailed location data, photos, and reviews for hotels, restaurants, and attractions worldwide.',
    iconUrl: null,
    category: 'Data',
    websiteUrl: 'https://agentic.market/services/tripadvisor-content-api-readme-io',
    color: '#34E0A1',
    isDefault: true,
    isCustom: false,
    configSchema: null,
    kind: 'data',
    protocol: 'http',
    endpoint: 'https://tripadvisor.x402.paysponge.com/api/v1/location/search',
    queryParam: 'searchQuery',
    priceUsd: '0.01',
    network: 'base',
    callable: true,
  },
  {
    id: 'wolfram-alpha',
    name: 'Wolfram|Alpha',
    slug: 'wolfram-alpha',
    description:
      'Computational intelligence — answer factual queries, math, science, and engineering. Pay-per-call in USDC.',
    iconUrl: null,
    category: 'Data',
    websiteUrl: 'https://agentic.market/?q=wolfram',
    color: '#DD1100',
    isDefault: true,
    isCustom: false,
    configSchema: null,
    kind: 'data',
    protocol: 'http',
    endpoint: 'https://wolframalpha.x402.paysponge.com/v1/result',
    queryParam: 'i',
    priceUsd: '0.01',
    network: 'base',
    callable: true,
  },
  {
    id: 'coingecko',
    name: 'CoinGecko',
    slug: 'coingecko',
    description: 'Crypto prices, market caps, and trading volume. x402-gated, pay-per-call.',
    iconUrl: null,
    category: 'Data',
    websiteUrl: 'https://agentic.market/?q=coingecko',
    color: '#8DC63F',
    isDefault: true,
    isCustom: false,
    configSchema: null,
    kind: 'data',
    protocol: null,
    endpoint: null,
    priceUsd: '0.01',
    network: 'base',
    callable: false,
  },
  {
    id: 'coinmarketcap',
    name: 'CoinMarketCap',
    slug: 'coinmarketcap',
    description: 'Crypto prices, rankings, and market data over x402.',
    iconUrl: null,
    category: 'Data',
    websiteUrl: 'https://agentic.market/?q=coinmarketcap',
    color: '#3861FB',
    isDefault: true,
    isCustom: false,
    configSchema: null,
    kind: 'data',
    protocol: null,
    endpoint: null,
    priceUsd: '0.01',
    network: 'base',
    callable: false,
  },
  {
    id: 'messari',
    name: 'Messari',
    slug: 'messari',
    description: 'Crypto intelligence and research data, x402-gated.',
    iconUrl: null,
    category: 'Data',
    websiteUrl: 'https://agentic.market/?q=messari',
    color: '#0BA5EC',
    isDefault: true,
    isCustom: false,
    configSchema: null,
    kind: 'data',
    protocol: null,
    endpoint: null,
    priceUsd: '0.15',
    network: 'base',
    callable: false,
  },
  {
    id: 'the-graph',
    name: 'The Graph',
    slug: 'the-graph',
    description: 'Indexing protocol for querying blockchain data with subgraphs, x402-gated.',
    iconUrl: null,
    category: 'Data',
    websiteUrl: 'https://agentic.market/?q=the%20graph',
    color: '#6F4CFF',
    isDefault: true,
    isCustom: false,
    configSchema: null,
    kind: 'data',
    protocol: null,
    endpoint: null,
    priceUsd: '0.01',
    network: 'base',
    callable: false,
  },
]

// App icons used in the particle header animation — x402 brands.
export const YEET_ICONS = [
  { emoji: '🧠', label: 'Claude' },
  { emoji: '💬', label: 'ChatGPT' },
  { emoji: '🔮', label: 'DeepSeek' },
  { emoji: '✦', label: 'Gemini' },
  { emoji: '⚡', label: 'Groq' },
  { emoji: '🧭', label: 'Tripadvisor' },
  { emoji: '🔢', label: 'Wolfram' },
  { emoji: '🦎', label: 'CoinGecko' },
  { emoji: '📈', label: 'CoinMarketCap' },
  { emoji: '🔷', label: 'The Graph' },
  { emoji: '🛡️', label: 'BlackSwan' },
  { emoji: '💸', label: 'x402' },
]
