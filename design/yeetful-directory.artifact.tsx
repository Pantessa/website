// ─────────────────────────────────────────────────────────────────────────
//  Pantessa · x402 Directory — SELF-CONTAINED design artifact
//
//  Paste this whole file into Claude (claude.ai → new chat → "build me an
//  artifact from this") together with a screenshot of the real /  page.
//  It has NO repo imports, NO Next.js, NO zustand, NO API calls, NO
//  framer-motion — just React + Tailwind + lucide-react, which Claude's
//  artifact sandbox supports. The catalog data is inlined and the
//  select/search/filter state is local, so it renders and clicks live.
//
//  Structure mirrors the real app 1:1 so the restyle ports straight back:
//    top nav  → components/Header (+ ConnectWallet)
//    hero     → components/ParticleHeader
//    stats / search / pills / grid → app/page.tsx
//    card     → components/McpServerCard.tsx
//
//  ASK CLAUDE: "Keep this exact structure and the same sections — just make
//  it prettier. Don't change the data shape or the card layout's fields
//  (icon, name, category, description, $price/call, Live/Directory badge,
//  active state, external-link)."
// ─────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { Search, Sparkles, Check, Plus, ExternalLink, Zap, Wallet } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────
interface Server {
  id: string
  name: string
  description: string
  category: 'Inference' | 'Data'
  color: string
  priceUsd: string
  callable: boolean // true = chat can pay+call it live; false = directory-only
  kind: 'inference' | 'data'
  websiteUrl?: string
}

const CATEGORY_ICONS: Record<string, string> = { Inference: '🧠', Data: '📊' }

// ── Inlined catalog (mirrors lib/mcp-data.ts CATALOG) ───────────────────────
const CATALOG: Server[] = [
  { id: 'yeetful-claude', name: 'Yeetful · Claude', category: 'Inference', kind: 'inference', color: '#D97757', priceUsd: '0.01', callable: true,
    description: 'Anthropic Claude Haiku 4.5 over MCP Streamable HTTP. Pay-per-call, no API key — the default inference engine.', websiteUrl: 'https://agentic.market/services/anthropic-yeetful-com' },
  { id: 'chatgpt', name: 'ChatGPT', category: 'Inference', kind: 'inference', color: '#10A37F', priceUsd: '0.001', callable: false,
    description: 'GPT, Responses, Images, and audio APIs across x402-enabled gateway providers.', websiteUrl: 'https://agentic.market/services/chatgpt' },
  { id: 'deepseek', name: 'DeepSeek', category: 'Inference', kind: 'inference', color: '#4D6BFE', priceUsd: '0.001', callable: false,
    description: 'Frontier LLM for coding and reasoning, x402-gated. Pay-per-call in USDC on Base.', websiteUrl: 'https://agentic.market/services/deepseek' },
  { id: 'google-gemini', name: 'Google Gemini', category: 'Inference', kind: 'inference', color: '#4285F4', priceUsd: '0.001', callable: false,
    description: 'Google Gemini models via x402-enabled gateways and agent wrappers.', websiteUrl: 'https://agentic.market/services/google-gemini' },
  { id: 'groq', name: 'Groq', category: 'Inference', kind: 'inference', color: '#F55036', priceUsd: '0.001', callable: false,
    description: 'Ultra-fast LLM inference (Llama, DeepSeek, Gemma) over x402.', websiteUrl: 'https://agentic.market/services/groq' },
  { id: 'venice', name: 'Venice', category: 'Inference', kind: 'inference', color: '#E84142', priceUsd: '0.001', callable: false,
    description: 'Privacy-focused AI inference — text, image, audio, and embeddings via an OpenAI-compatible API.', websiteUrl: 'https://agentic.market/services/venice' },
  { id: 'tripadvisor', name: 'Tripadvisor', category: 'Data', kind: 'data', color: '#34E0A1', priceUsd: '0.01', callable: true,
    description: 'Travel content API — location data, photos, and reviews for hotels, restaurants, and attractions worldwide.', websiteUrl: 'https://agentic.market/services/tripadvisor-content-api-readme-io' },
  { id: 'wolfram-alpha', name: 'Wolfram|Alpha', category: 'Data', kind: 'data', color: '#DD1100', priceUsd: '0.01', callable: true,
    description: 'Computational intelligence engine — factual queries, math, science, and unit conversions.', websiteUrl: 'https://agentic.market/services/wolframalpha-x402-paysponge-com' },
  { id: 'coingecko', name: 'CoinGecko', category: 'Data', kind: 'data', color: '#8DC63F', priceUsd: '0.01', callable: false,
    description: 'Crypto prices, market caps, and trading volume. x402-gated, pay-per-call.', websiteUrl: 'https://agentic.market/services/coingecko' },
  { id: 'coinmarketcap', name: 'CoinMarketCap', category: 'Data', kind: 'data', color: '#3861FB', priceUsd: '0.01', callable: false,
    description: 'Crypto prices, rankings, and market data over x402.', websiteUrl: 'https://agentic.market/services/coinmarketcap' },
  { id: 'messari', name: 'Messari', category: 'Data', kind: 'data', color: '#0BA5EC', priceUsd: '0.15', callable: false,
    description: 'Crypto intelligence and research data, x402-gated.', websiteUrl: 'https://agentic.market/services/messari' },
  { id: 'the-graph', name: 'The Graph', category: 'Data', kind: 'data', color: '#6F4CFF', priceUsd: '0.01', callable: false,
    description: 'Indexing protocol for querying blockchain data with subgraphs, x402-gated.', websiteUrl: 'https://agentic.market/services/the-graph' },
]

const ALL = 'All'

// ── Card (mirrors components/McpServerCard.tsx) ─────────────────────────────
function ServerCard({ server, active, onToggle }: { server: Server; active: boolean; onToggle: () => void }) {
  const catIcon = CATEGORY_ICONS[server.category] || '⚡'
  return (
    <div
      onClick={onToggle}
      className={[
        'group relative rounded-2xl border transition-all duration-300 overflow-hidden cursor-pointer',
        active
          ? 'border-white/25 bg-white/[0.08] shadow-lg shadow-white/5'
          : 'border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700/80 hover:bg-zinc-900/70',
      ].join(' ')}
    >
      {active && (
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 50% 0%, ${server.color}, transparent 70%)` }}
        />
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={['w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-xl transition-transform duration-200', active ? 'scale-110' : 'group-hover:scale-105'].join(' ')}
              style={{ background: `linear-gradient(135deg, ${server.color}22, ${server.color}44)`, border: `1px solid ${server.color}33` }}
            >
              <span>{catIcon}</span>
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-white text-sm leading-tight truncate">{server.name}</h3>
              <span className="text-[11px] text-zinc-500 font-medium">{server.category}</span>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onToggle() }}
            className={['flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200', active ? 'bg-white text-zinc-950 hover:bg-zinc-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'].join(' ')}
          >
            {active ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />}
          </button>
        </div>

        <p className="mt-3 text-xs text-zinc-500 leading-relaxed line-clamp-2 group-hover:text-zinc-400 transition-colors">
          {server.description}
        </p>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-300 border border-zinc-700/60 font-medium font-mono">
              ${server.priceUsd}/call
            </span>
            {server.callable ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-medium flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" /> Live
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800/60 text-zinc-500 border border-zinc-700/40 font-medium">Directory</span>
            )}
            {active && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white border border-white/15 font-medium flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-white inline-block" /> Active
              </span>
            )}
          </div>
          {server.websiteUrl && (
            <a href={server.websiteUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors rounded" title="View on agentic.market">
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page (mirrors app/page.tsx + Header + ParticleHeader) ───────────────────
export default function YeetfulDirectory() {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState(ALL)
  const [activeIds, setActiveIds] = useState<string[]>(['yeetful-claude', 'tripadvisor'])

  const toggle = (id: string) =>
    setActiveIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  const categories = [ALL, ...Array.from(new Set(CATALOG.map((s) => s.category))).sort()]
  const filtered = CATALOG.filter((s) => {
    const q = search.toLowerCase()
    const matchesSearch = !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    const matchesCat = activeCategory === ALL || s.category === activeCategory
    return matchesSearch && matchesCat
  })

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-32">
      {/* Top nav */}
      <header className="sticky top-0 z-20 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-white text-zinc-950 grid place-items-center text-xs font-black">Y</div>
            <span className="font-semibold tracking-tight">pantessa</span>
            <span className="ml-2 text-[10px] uppercase tracking-widest text-zinc-600">x402 directory</span>
          </div>
          <nav className="flex items-center gap-4 text-sm text-zinc-400">
            <a className="hover:text-white transition-colors" href="#">Directory</a>
            <a className="hover:text-white transition-colors" href="#">Chat</a>
            <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white text-zinc-950 text-xs font-semibold hover:bg-zinc-200 transition-colors">
              <Wallet className="w-3.5 h-3.5" strokeWidth={2.5} /> Connect Wallet
            </button>
          </nav>
        </div>
      </header>

      {/* Hero (replaces ParticleHeader) */}
      <section className="relative overflow-hidden border-b border-zinc-800/60">
        <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(ellipse at 50% -20%, #3f3f46, transparent 60%)' }} />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">One wallet. Every x402 agent.</h1>
          <p className="mt-3 text-zinc-400 max-w-xl mx-auto">
            Pick inference and data agents, pay per call in USDC on Base. No API keys, no subscriptions.
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Stats row */}
        <div className="flex items-center gap-6 mb-8">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-sm text-zinc-400"><span className="text-white font-semibold">{CATALOG.length}</span> agents available</span>
          </div>
          {activeIds.length > 0 && (
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-sm text-zinc-400"><span className="text-white font-semibold">{activeIds.length}</span> active</span>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
            <input
              type="text"
              placeholder="Search x402 agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800/60 text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-zinc-600 transition-colors"
            />
          </div>
        </div>

        {/* Category pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-6">
          {categories.map((cat) => {
            const isActive = activeCategory === cat
            const icon = cat === ALL ? '⚡' : CATEGORY_ICONS[cat] || '📦'
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={['flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap', isActive ? 'bg-white text-zinc-950' : 'bg-zinc-900/80 text-zinc-400 border border-zinc-800/60 hover:border-zinc-700 hover:text-zinc-200'].join(' ')}
              >
                <span>{icon}</span>{cat}
              </button>
            )
          })}
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-20"><p className="text-zinc-500">No agents match your search.</p></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((s) => (
              <ServerCard key={s.id} server={s} active={activeIds.includes(s.id)} onToggle={() => toggle(s.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Floating active bar (replaces components/ActiveServerBar) */}
      {activeIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-3 rounded-2xl border border-zinc-700/60 bg-zinc-900/90 backdrop-blur shadow-xl shadow-black/40">
          <span className="text-xs text-zinc-400">{activeIds.length} active</span>
          <div className="flex items-center gap-1.5">
            {activeIds.map((id) => {
              const s = CATALOG.find((x) => x.id === id)!
              return <span key={id} className="text-[11px] px-2 py-1 rounded-lg bg-white/6 border border-white/8">{s.name}</span>
            })}
          </div>
          <button className="px-3 py-1.5 rounded-xl bg-white text-zinc-950 text-xs font-semibold hover:bg-zinc-200 transition-colors">Start chat →</button>
        </div>
      )}
    </div>
  )
}
