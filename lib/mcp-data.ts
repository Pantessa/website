// Static fallback MCP server data (used if DB not available)
export interface McpServerData {
  id: string
  name: string
  slug: string
  description: string
  iconUrl: string | null
  category: string
  websiteUrl: string | null
  color: string
  isDefault: boolean
  isCustom: boolean
  configSchema: Record<string, { type: string; label: string; required: boolean }> | null
}

export const CATEGORY_ICONS: Record<string, string> = {
  Development: '💻',
  Communication: '💬',
  Productivity: '📋',
  'Project Management': '📊',
  Storage: '🗄️',
  Payments: '💳',
  Database: '🗃️',
  Design: '🎨',
  CRM: '🤝',
  'E-Commerce': '🛒',
  Cloud: '☁️',
  Custom: '⚡',
}

export const CATEGORY_COLORS: Record<string, string> = {
  Development: 'from-violet-500/20 to-purple-500/20',
  Communication: 'from-blue-500/20 to-cyan-500/20',
  Productivity: 'from-orange-500/20 to-amber-500/20',
  'Project Management': 'from-indigo-500/20 to-blue-500/20',
  Storage: 'from-green-500/20 to-emerald-500/20',
  Payments: 'from-purple-500/20 to-pink-500/20',
  Database: 'from-sky-500/20 to-blue-500/20',
  Design: 'from-pink-500/20 to-rose-500/20',
  CRM: 'from-orange-500/20 to-red-500/20',
  'E-Commerce': 'from-lime-500/20 to-green-500/20',
  Cloud: 'from-yellow-500/20 to-amber-500/20',
  Custom: 'from-zinc-500/20 to-zinc-400/20',
}

// App icons used in the particle header animation
export const YEET_ICONS = [
  { emoji: '⚡', label: 'GitHub' },
  { emoji: '💬', label: 'Slack' },
  { emoji: '📝', label: 'Notion' },
  { emoji: '📐', label: 'Linear' },
  { emoji: '☁️', label: 'Drive' },
  { emoji: '💳', label: 'Stripe' },
  { emoji: '📊', label: 'Airtable' },
  { emoji: '🎨', label: 'Figma' },
  { emoji: '🔷', label: 'Jira' },
  { emoji: '🤝', label: 'HubSpot' },
  { emoji: '🛒', label: 'Shopify' },
  { emoji: '✅', label: 'Asana' },
  { emoji: '🗃️', label: 'PostgreSQL' },
  { emoji: '🌩️', label: 'AWS' },
  { emoji: '📱', label: 'Twilio' },
]
