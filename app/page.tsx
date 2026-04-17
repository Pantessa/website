'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Filter, LayoutGrid, List, Sparkles } from 'lucide-react'
import ParticleHeader from '@/components/ParticleHeader'
import McpServerCard from '@/components/McpServerCard'
import ActiveServerBar from '@/components/ActiveServerBar'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { cn } from '@/lib/utils'
import { CATEGORY_ICONS, CATEGORY_COLORS } from '@/lib/mcp-data'

const ALL_CATEGORIES = 'All'

// Fallback static data while DB loads
const STATIC_SERVERS: McpServer[] = [
  { id: 'github', name: 'GitHub', slug: 'github', description: 'Access repositories, issues, PRs, and code search across GitHub', iconUrl: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png', category: 'Development', websiteUrl: 'https://github.com', color: '#6e40c9', isDefault: true, isCustom: false, configSchema: null },
  { id: 'slack', name: 'Slack', slug: 'slack', description: 'Send messages, search channels, and manage your workspace', iconUrl: null, category: 'Communication', websiteUrl: 'https://slack.com', color: '#4A154B', isDefault: true, isCustom: false, configSchema: null },
  { id: 'notion', name: 'Notion', slug: 'notion', description: 'Read and write to your Notion workspace, pages, and databases', iconUrl: null, category: 'Productivity', websiteUrl: 'https://notion.so', color: '#000000', isDefault: true, isCustom: false, configSchema: null },
  { id: 'linear', name: 'Linear', slug: 'linear', description: 'Manage issues, projects, and sprints in your Linear workspace', iconUrl: null, category: 'Project Management', websiteUrl: 'https://linear.app', color: '#5E6AD2', isDefault: true, isCustom: false, configSchema: null },
  { id: 'google-drive', name: 'Google Drive', slug: 'google-drive', description: 'Browse, read, and search your Google Drive files and folders', iconUrl: null, category: 'Storage', websiteUrl: 'https://drive.google.com', color: '#1fa463', isDefault: true, isCustom: false, configSchema: null },
  { id: 'stripe', name: 'Stripe', slug: 'stripe', description: 'Query payments, customers, subscriptions, and financial data', iconUrl: null, category: 'Payments', websiteUrl: 'https://stripe.com', color: '#635BFF', isDefault: true, isCustom: false, configSchema: null },
  { id: 'airtable', name: 'Airtable', slug: 'airtable', description: 'Read and update records in your Airtable bases and tables', iconUrl: null, category: 'Database', websiteUrl: 'https://airtable.com', color: '#FCB400', isDefault: true, isCustom: false, configSchema: null },
  { id: 'figma', name: 'Figma', slug: 'figma', description: 'Access design files, components, and assets from Figma', iconUrl: null, category: 'Design', websiteUrl: 'https://figma.com', color: '#F24E1E', isDefault: true, isCustom: false, configSchema: null },
  { id: 'jira', name: 'Jira', slug: 'jira', description: 'Manage Jira issues, sprints, boards, and project workflows', iconUrl: null, category: 'Project Management', websiteUrl: 'https://atlassian.com', color: '#0052CC', isDefault: true, isCustom: false, configSchema: null },
  { id: 'hubspot', name: 'HubSpot', slug: 'hubspot', description: 'Access CRM data, contacts, deals, and marketing campaigns', iconUrl: null, category: 'CRM', websiteUrl: 'https://hubspot.com', color: '#FF7A59', isDefault: true, isCustom: false, configSchema: null },
  { id: 'shopify', name: 'Shopify', slug: 'shopify', description: 'Query products, orders, customers, and store analytics', iconUrl: null, category: 'E-Commerce', websiteUrl: 'https://shopify.com', color: '#96BF48', isDefault: true, isCustom: false, configSchema: null },
  { id: 'asana', name: 'Asana', slug: 'asana', description: 'Manage tasks, projects, teams, and timelines in Asana', iconUrl: null, category: 'Project Management', websiteUrl: 'https://asana.com', color: '#F06A6A', isDefault: true, isCustom: false, configSchema: null },
  { id: 'postgresql', name: 'PostgreSQL', slug: 'postgresql', description: 'Query and manage your PostgreSQL databases with natural language', iconUrl: null, category: 'Database', websiteUrl: 'https://postgresql.org', color: '#336791', isDefault: true, isCustom: false, configSchema: null },
  { id: 'aws', name: 'AWS', slug: 'aws', description: 'Manage S3, Lambda, EC2, and other AWS services via natural language', iconUrl: null, category: 'Cloud', websiteUrl: 'https://aws.amazon.com', color: '#FF9900', isDefault: true, isCustom: false, configSchema: null },
  { id: 'twilio', name: 'Twilio', slug: 'twilio', description: 'Send SMS, make calls, and manage communications programmatically', iconUrl: null, category: 'Communication', websiteUrl: 'https://twilio.com', color: '#F22F46', isDefault: true, isCustom: false, configSchema: null },
]

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
