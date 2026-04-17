'use client'

import { useEffect } from 'react'
import ChatInterface from '@/components/ChatInterface'
import ChatSidebar from '@/components/ChatSidebar'
import { useYeetfulStore, McpServer } from '@/lib/store'

const STATIC_SERVERS: McpServer[] = [
  { id: 'github', name: 'GitHub', slug: 'github', description: 'Access repositories, issues, PRs, and code search across GitHub', iconUrl: null, category: 'Development', websiteUrl: 'https://github.com', color: '#6e40c9', isDefault: true, isCustom: false, configSchema: null },
  { id: 'slack', name: 'Slack', slug: 'slack', description: 'Send messages, search channels, and manage your workspace', iconUrl: null, category: 'Communication', websiteUrl: 'https://slack.com', color: '#4A154B', isDefault: true, isCustom: false, configSchema: null },
  { id: 'notion', name: 'Notion', slug: 'notion', description: 'Read and write to your Notion workspace', iconUrl: null, category: 'Productivity', websiteUrl: 'https://notion.so', color: '#000000', isDefault: true, isCustom: false, configSchema: null },
  { id: 'linear', name: 'Linear', slug: 'linear', description: 'Manage issues, projects, and sprints', iconUrl: null, category: 'Project Management', websiteUrl: 'https://linear.app', color: '#5E6AD2', isDefault: true, isCustom: false, configSchema: null },
  { id: 'stripe', name: 'Stripe', slug: 'stripe', description: 'Query payments and subscriptions', iconUrl: null, category: 'Payments', websiteUrl: 'https://stripe.com', color: '#635BFF', isDefault: true, isCustom: false, configSchema: null },
  { id: 'figma', name: 'Figma', slug: 'figma', description: 'Access design files and components', iconUrl: null, category: 'Design', websiteUrl: 'https://figma.com', color: '#F24E1E', isDefault: true, isCustom: false, configSchema: null },
  { id: 'aws', name: 'AWS', slug: 'aws', description: 'Manage cloud infrastructure', iconUrl: null, category: 'Cloud', websiteUrl: 'https://aws.amazon.com', color: '#FF9900', isDefault: true, isCustom: false, configSchema: null },
]

export default function ChatPage() {
  const { servers, setServers } = useYeetfulStore()

  useEffect(() => {
    if (servers.length === 0) {
      fetch('/api/servers')
        .then((r) => r.json())
        .then((data: McpServer[]) => {
          if (data.length > 0) setServers(data)
          else setServers(STATIC_SERVERS)
        })
        .catch(() => setServers(STATIC_SERVERS))
    }
  }, [servers.length, setServers])

  return (
    <div className="h-[calc(100vh-3.5rem)] flex">
      {/* Sidebar */}
      <div className="relative flex-shrink-0">
        <ChatSidebar />
      </div>

      {/* Main chat */}
      <main className="flex-1 min-w-0 flex flex-col">
        <ChatInterface />
      </main>
    </div>
  )
}
