'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Filter, LayoutGrid, List, Sparkles } from 'lucide-react'
import ParticleHeader from '@/components/ParticleHeader'
import McpServerCard from '@/components/McpServerCard'
import ActiveServerBar from '@/components/ActiveServerBar'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { cn } from '@/lib/utils'
import { CATEGORY_ICONS, CATEGORY_COLORS, CATALOG } from '@/lib/mcp-data'

const ALL_CATEGORIES = 'All'

// Fallback static data while DB loads — the curated x402 catalog.
const STATIC_SERVERS: McpServer[] = CATALOG

export default function HomePage() {
  const { servers, setServers, activeServerIds } = useYeetfulStore()
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load from API, fall back to static
    fetch('/api/servers')
      .then((r) => r.json())
      .then((data: McpServer[]) => {
        if (data.length > 0) {
          setServers(data)
        } else {
          setServers(STATIC_SERVERS)
        }
      })
      .catch(() => setServers(STATIC_SERVERS))
      .finally(() => setLoading(false))
  }, [setServers])

  const displayServers = servers.length > 0 ? servers : STATIC_SERVERS

  const categories = [
    ALL_CATEGORIES,
    ...Array.from(new Set(displayServers.map((s) => s.category))).sort(),
  ]

  const filtered = displayServers.filter((s) => {
    const matchesSearch =
      search === '' ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()) ||
      s.category.toLowerCase().includes(search.toLowerCase())
    const matchesCategory = activeCategory === ALL_CATEGORIES || s.category === activeCategory
    return matchesSearch && matchesCategory
  })

  const activeServersCount = activeServerIds.length

  return (
    <div className="min-h-screen pb-32">
      {/* Hero particle header */}
      <ParticleHeader />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Stats row */}
        <div className="flex items-center gap-6 mb-8">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-sm text-zinc-400">
              <span className="text-white font-semibold">{displayServers.length}</span> servers available
            </span>
          </div>
          {activeServersCount > 0 && (
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-sm text-zinc-400">
                <span className="text-white font-semibold">{activeServersCount}</span> active
              </span>
            </div>
          )}
        </div>

        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
            <input
              type="text"
              placeholder="Search MCP servers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800/60 text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-zinc-600 transition-colors"
            />
          </div>
        </div>

        {/* Category pills */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-2 mb-6">
          {categories.map((cat) => {
            const isActive = activeCategory === cat
            const icon = cat === ALL_CATEGORIES ? '⚡' : CATEGORY_ICONS[cat] || '📦'
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap',
                  isActive
                    ? 'bg-white text-zinc-950'
                    : 'bg-zinc-900/80 text-zinc-400 border border-zinc-800/60 hover:border-zinc-700 hover:text-zinc-200'
                )}
              >
                <span>{icon}</span>
                {cat}
              </button>
            )
          })}
        </div>

        {/* Server grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 h-40 animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-zinc-500">No servers match your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((server, i) => (
              <McpServerCard key={server.id} server={server} index={i} />
            ))}
          </div>
        )}
      </div>

      {/* Floating active bar */}
      <AnimatePresence>
        {activeServersCount > 0 && <ActiveServerBar />}
      </AnimatePresence>
    </div>
  )
}
