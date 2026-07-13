'use client'

// "Add your own MCP" — the chat rail's inline path into the directory. A
// compact modal version of /servers/add: paste the MCP base URL, tools are
// discovered from the server's own tools/list, and the user stars the tools a
// newly connected account should PING FIRST (mcp_endpoints.featured). Those
// stars power two things: the connect-time quick-view card (generic splash
// tile) and the endpoint planner's "start here" hints. On save the MCP drops
// straight into the working set and its action window opens.
//
// Rendered through a portal — the rail animates width with overflow hidden,
// which would clip a fixed child.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Globe, Loader2, Plus, Star, Wand2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore, type McpServer } from '@/lib/store'
import { useSession } from '@/lib/session'

interface DiscoveredParam {
  group?: string
  name: string
  type?: string
  description?: string
  required?: boolean
}
interface DiscoveredTool {
  name: string
  title: string | null
  description: string | null
  params: DiscoveredParam[]
  plannable: boolean
  url: string
}

/** Params that take the user's own address — same heuristic the generic
 *  splash source uses to fill featured tools, so "preselected here" ≈ "will
 *  actually paint a personalized card". */
const ADDRESS_PARAM_RE = /^(owner|user|address|wallet|account|follower|voter|holder|trader)$/i
const isPersonalTool = (t: DiscoveredTool) =>
  t.plannable && t.params.some((p) => ADDRESS_PARAM_RE.test(p.name) || /\$USER_ADDRESS/.test(p.description ?? ''))

export default function AddMcpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addServer, activeServerIds, setActiveServerIds, updateChatServers, markManualMcp, currentChatId } =
    useYeetfulStore()
  const { status, connectAndSignIn } = useSession()
  const router = useRouter()

  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoError, setLogoError] = useState(false)
  const [tools, setTools] = useState<DiscoveredTool[] | null>(null)
  const [starred, setStarred] = useState<Set<string>>(new Set())
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  // Reset per open so a second add starts clean.
  useEffect(() => {
    if (!open) return
    setUrl('')
    setName('')
    setDescription('')
    setLogoUrl('')
    setLogoError(false)
    setTools(null)
    setStarred(new Set())
    setError('')
    setNote('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const discover = async () => {
    if (!url || fetching) return
    setFetching(true)
    setError('')
    setNote('')
    const meta = fetch('/api/fetch-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
      .then((r) => r.json())
      .catch(() => null)
    const disc = fetch('/api/servers/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
      .catch(() => ({ ok: false, data: null }))
    try {
      const [m, d] = await Promise.all([meta, disc])
      if (m) {
        setName((n) => n || m.title || '')
        setDescription((v) => v || m.description || '')
      }
      // Auto-pull the logo: the MCP's own serverInfo.icons first (what it ships
      // for itself), else the site favicon/og:image. User can still override.
      const autoLogo = (d.ok && typeof d.data?.logoUrl === 'string' ? d.data.logoUrl : '') || m?.iconUrl || ''
      if (autoLogo) {
        setLogoError(false)
        setLogoUrl((v) => v || autoLogo)
      }
      const found: DiscoveredTool[] = d.ok && Array.isArray(d.data?.tools) ? d.data.tools : []
      setTools(found)
      if (found.length > 0) {
        // Preselect the tools most likely to paint a personal quick view —
        // wallet-aware reads first, else the first callable tool.
        const personal = found.filter(isPersonalTool).slice(0, 2)
        const fallback = personal.length > 0 ? personal : found.filter((t) => t.plannable).slice(0, 1)
        setStarred(new Set(fallback.map((t) => t.name)))
        setNote(`${found.length} tool${found.length === 1 ? '' : 's'} found · ${found.filter((t) => t.plannable).length} callable`)
      } else {
        setNote(d.data?.error ? `No MCP tools: ${d.data.error}` : 'No MCP tools found at that URL.')
      }
      if (!m && !d.ok) setError('Could not reach that URL.')
    } finally {
      setFetching(false)
    }
  }

  const toggleStar = (toolName: string) => {
    setStarred((prev) => {
      const next = new Set(prev)
      if (next.has(toolName)) next.delete(toolName)
      else next.add(toolName)
      return next
    })
  }

  const submit = async () => {
    if (!name || !description || saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          category: 'Custom',
          websiteUrl: url || null,
          mcpUrl: url || null,
          logoUrl: logoUrl || null,
          featuredTools: [...starred],
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.status === 401) {
        setError('Sign in to add your MCP to the shared directory.')
        return
      }
      if (!res.ok || !data) {
        setError(data?.error || 'Failed to add the server.')
        return
      }
      const server: McpServer = { ...data, isCustom: true }
      addServer(server)
      // Land it in the working set (so it's active when they come back to
      // chat), close the modal, then send them to the newly created MCP's
      // detail page to see the discovered tools it just saved.
      const nextIds = [...activeServerIds, server.id]
      setActiveServerIds(nextIds)
      // Adding your own MCP is the most deliberate pick there is — always
      // paint its splash card, activity or not.
      markManualMcp(server.slug, true)
      if (currentChatId) updateChatServers(currentChatId, nextIds)
      onClose()
      router.push(`/servers/${server.slug}`)
    } catch {
      setError('Network error — try again.')
    } finally {
      setSaving(false)
    }
  }

  const starredCount = starred.size
  const canSubmit = !!name && !!description && !saving
  const body = useMemo(() => {
    if (typeof document === 'undefined') return null
    return document.body
  }, [])
  if (!body) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-[8vh]"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-label="Add your own MCP"
            onClick={(e) => e.stopPropagation()}
            className="addmcp__panel w-full max-w-[540px] rounded-2xl border border-[var(--line-2)] shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 px-5 pt-4 pb-3.5 border-b border-[var(--line)]">
              <span className="w-7 h-7 grid place-items-center rounded-lg bg-black/40 border border-[var(--line)] text-[color:var(--accent)]">
                <Plus className="w-4 h-4" strokeWidth={2.5} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white">Add your own MCP</div>
                <div className="mono text-[10px] text-[color:var(--muted-2)]">discovered from the server · routes in chat</div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-7 h-7 grid place-items-center rounded-lg text-[color:var(--muted)] hover:text-white hover:bg-white/5 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[68vh] overflow-y-auto px-5 py-4 space-y-4">
              {/* URL + discover */}
              <div>
                <label className="block text-[11px] font-medium text-[color:var(--muted)] mb-1.5">MCP server URL</label>
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[color:var(--muted-2)]" />
                    <input
                      type="url"
                      placeholder="https://your-mcp-server.com/mcp"
                      value={url}
                      autoFocus
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          discover()
                        }
                      }}
                      className="w-full pr-3 py-2.5 rounded-xl bg-[var(--surf-1)] border border-[var(--line)] text-white placeholder-[color:var(--muted-2)] text-xs focus:outline-none focus:border-[var(--line-2)] transition-colors"
                      style={{ paddingLeft: 34 }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={discover}
                    disabled={!url || fetching}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[var(--surf-2)] text-white text-xs font-medium hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    {fetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                    {fetching ? 'Discovering…' : 'Discover'}
                  </button>
                </div>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-[color:var(--muted-2)]">
                  Tools are read from the server&apos;s own <span className="mono">tools/list</span> — free MCPs land in
                  the Free tab, ready to route.
                  {note && <span className="block mt-0.5 text-[color:var(--muted)]">{note}</span>}
                </p>
              </div>

              {/* Identity */}
              {(tools !== null || name) && (
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[color:var(--muted)] mb-1.5">Name</label>
                    <input
                      type="text"
                      value={name}
                      placeholder="My MCP"
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-[var(--surf-1)] border border-[var(--line)] text-white placeholder-[color:var(--muted-2)] text-xs focus:outline-none focus:border-[var(--line-2)] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[color:var(--muted)] mb-1.5">Description</label>
                    <textarea
                      rows={2}
                      value={description}
                      placeholder="What does this MCP do?"
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-[var(--surf-1)] border border-[var(--line)] text-white placeholder-[color:var(--muted-2)] text-xs focus:outline-none focus:border-[var(--line-2)] transition-colors resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[color:var(--muted)] mb-1.5">
                      Logo <span className="text-[color:var(--muted-2)] font-normal">— auto-pulled, or link your own</span>
                    </label>
                    <div className="flex items-center gap-2.5">
                      <span className="w-9 h-9 flex-shrink-0 grid place-items-center rounded-lg border border-[var(--line)] bg-black/30 overflow-hidden">
                        {logoUrl && !logoError ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logoUrl}
                            alt=""
                            className="w-full h-full object-contain"
                            onError={() => setLogoError(true)}
                            draggable={false}
                          />
                        ) : (
                          <span className="mono text-[13px] font-bold text-[color:var(--muted-2)]">
                            {name.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || '?'}
                          </span>
                        )}
                      </span>
                      <input
                        type="url"
                        value={logoUrl}
                        placeholder="https://…/logo.svg"
                        onChange={(e) => {
                          setLogoError(false)
                          setLogoUrl(e.target.value)
                        }}
                        className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-[var(--surf-1)] border border-[var(--line)] text-white placeholder-[color:var(--muted-2)] text-xs focus:outline-none focus:border-[var(--line-2)] transition-colors"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Tool starring — the "ping first" picks */}
              {tools !== null && tools.length > 0 && (
                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[11px] font-medium text-[color:var(--muted)]">Ping first for new accounts</span>
                    <span className="mono text-[10px] text-[color:var(--muted-2)]">{starredCount} starred</span>
                  </div>
                  <p className="text-[10.5px] leading-relaxed text-[color:var(--muted-2)] mb-2">
                    Starred tools are called the moment a wallet connects — they fill the quick-view card and tell the
                    router where to start. Pick the reads that best show what this MCP knows about an account.
                  </p>
                  <ul className="space-y-1 rounded-xl border border-[var(--line)] bg-black/20 p-1.5 max-h-[220px] overflow-y-auto">
                    {tools.map((t) => {
                      const on = starred.has(t.name)
                      const personal = isPersonalTool(t)
                      return (
                        <li key={t.name}>
                          <button
                            type="button"
                            onClick={() => toggleStar(t.name)}
                            aria-pressed={on}
                            className={cn(
                              'w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors',
                              on ? 'bg-[var(--surf-2)]' : 'hover:bg-white/[0.04]',
                            )}
                          >
                            <Star
                              className={cn(
                                'w-3.5 h-3.5 mt-0.5 flex-shrink-0 transition-colors',
                                on ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted-2)]',
                              )}
                              fill={on ? 'currentColor' : 'none'}
                            />
                            <span className="flex-1 min-w-0">
                              <span className="flex items-center gap-2">
                                <span className="mono text-[11px] text-white truncate">{t.name}</span>
                                {personal && (
                                  <span className="mono text-[9px] px-1.5 py-px rounded-full border border-[var(--line)] text-[color:var(--accent)] flex-shrink-0">
                                    wallet-aware
                                  </span>
                                )}
                                {!t.plannable && (
                                  <span className="mono text-[9px] px-1.5 py-px rounded-full border border-[var(--line)] text-[color:var(--muted-2)] flex-shrink-0">
                                    display-only
                                  </span>
                                )}
                              </span>
                              {(t.description || t.title) && (
                                <span className="block text-[10.5px] text-[color:var(--muted-2)] truncate">
                                  {t.description || t.title}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {/* Guest hint */}
              {status === 'guest' && (
                <p className="text-[11px] leading-relaxed text-[color:var(--muted)] rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-3 py-2.5">
                  Adding to the shared directory needs a signed-in wallet.{' '}
                  <button
                    type="button"
                    onClick={() => connectAndSignIn()}
                    className="text-[color:var(--accent)] hover:underline font-medium"
                  >
                    Connect &amp; sign in
                  </button>
                </p>
              )}

              {error && <p className="text-[11px] text-red-400">{error}</p>}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-t border-[var(--line)]">
              <div className="flex-1" />
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors',
                  canSubmit
                    ? 'bg-white text-zinc-950 hover:bg-zinc-200'
                    : 'bg-[var(--surf-2)] text-[color:var(--muted-2)] cursor-not-allowed',
                )}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />}
                {saving ? 'Adding…' : 'Add to my set'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    body,
  )
}
