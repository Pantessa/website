'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  Globe,
  Loader2,
  Check,
  AlertCircle,
  Trash2,
  ExternalLink,
  Wand2,
} from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATEGORY_ICONS } from '@/lib/mcp-data'

const CATEGORIES = ['Inference', 'Data', 'Custom']

interface FormState {
  name: string
  description: string
  websiteUrl: string
  iconUrl: string
  category: string
  color: string
  configFields: { key: string; label: string; required: boolean }[]
}

export default function AddServerPage() {
  const { servers, addServer, removeServer } = useYeetfulStore()
  const customServers = servers.filter((s) => s.isCustom)

  const [form, setForm] = useState<FormState>({
    name: '',
    description: '',
    websiteUrl: '',
    iconUrl: '',
    category: 'Custom',
    color: '#6366f1',
    configFields: [],
  })
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [error, setError] = useState('')
  const [imgError, setImgError] = useState(false)

  const fetchMeta = async () => {
    if (!form.websiteUrl) return
    setFetching(true)
    setError('')
    try {
      const res = await fetch('/api/fetch-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.websiteUrl }),
      })
      const data = await res.json()
      setForm((f) => ({
        ...f,
        name: f.name || data.title || '',
        description: f.description || data.description || '',
        iconUrl: data.iconUrl || f.iconUrl,
        color: data.color || f.color,
      }))
      setImgError(false)
    } catch {
      setError('Could not fetch metadata from URL.')
    } finally {
      setFetching(false)
    }
  }

  const addConfigField = () => {
    setForm((f) => ({
      ...f,
      configFields: [...f.configFields, { key: '', label: '', required: true }],
    }))
  }

  const updateConfigField = (
    i: number,
    field: Partial<{ key: string; label: string; required: boolean }>
  ) => {
    setForm((f) => ({
      ...f,
      configFields: f.configFields.map((cf, idx) => (idx === i ? { ...cf, ...field } : cf)),
    }))
  }

  const removeConfigField = (i: number) => {
    setForm((f) => ({
      ...f,
      configFields: f.configFields.filter((_, idx) => idx !== i),
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.description || !form.category) {
      setError('Name, description, and category are required.')
      return
    }
    setSaving(true)
    setError('')
    setSuccessMsg('')

    const configSchema =
      form.configFields.length > 0
        ? Object.fromEntries(
            form.configFields
              .filter((f) => f.key)
              .map((f) => [f.key, { type: 'string', label: f.label || f.key, required: f.required }])
          )
        : null

    const resetForm = () =>
      setForm({
        name: '',
        description: '',
        websiteUrl: '',
        iconUrl: '',
        category: 'Custom',
        color: '#6366f1',
        configFields: [],
      })

    const flashSuccess = (msg: string) => {
      setSuccessMsg(msg)
      setSuccess(true)
      resetForm()
      setTimeout(() => setSuccess(false), 4000)
    }

    try {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          iconUrl: form.iconUrl || null,
          category: form.category,
          websiteUrl: form.websiteUrl || null,
          // The MCP base URL to introspect — every tool is discovered from the
          // server's own tools/list and wired as a routable endpoint.
          mcpUrl: form.websiteUrl || null,
          color: form.color,
          configSchema,
        }),
      })

      const data = await res.json().catch(() => null)

      if (res.ok && data) {
        // Persisted to the directory. Add the DB row (real id/slug) to the store.
        addServer({ ...data, iconUrl: form.iconUrl || null, isCustom: true })
        const n = data.plannableCount ?? 0
        flashSuccess(
          n > 0
            ? `Added — ${n} callable tool${n === 1 ? '' : 's'} discovered from the MCP server.`
            : data.discoveryError
              ? `Added as a listing. No tools discovered (${data.discoveryError}).`
              : 'Added to the directory.'
        )
        return
      }

      // Real, actionable server errors — surface them instead of faking success.
      if (res.status === 401) {
        setError('Sign in to add a server to the shared directory.')
        return
      }
      if (data?.error && res.status < 500) {
        setError(data.error)
        return
      }
      throw new Error(data?.error || 'Failed to save')
    } catch {
      // Network failure or missing endpoint — keep the server locally so the
      // form still works offline (this row is not persisted to the directory).
      const localServer: McpServer = {
        id: `custom-${Date.now()}`,
        name: form.name,
        slug: form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description: form.description,
        iconUrl: form.iconUrl || null,
        category: form.category,
        websiteUrl: form.websiteUrl || null,
        color: form.color,
        isDefault: false,
        isCustom: true,
        configSchema: configSchema as McpServer['configSchema'],
      }
      addServer(localServer)
      flashSuccess('Saved locally (directory unreachable).')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10"
        >
          <h1 className="text-3xl font-black text-white mb-2">Add MCP Server</h1>
          <p className="text-zinc-500 text-sm">
            Add any custom MCP server to your toolkit. Paste the website URL to auto-fill metadata.
          </p>
        </motion.div>

        {/* Form */}
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onSubmit={handleSubmit}
          className="space-y-5"
        >
          {/* URL fetch */}
          <div className="p-5 rounded-2xl border border-zinc-800/60 bg-zinc-900/40 space-y-4">
            <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
              MCP server URL
            </p>
            <p className="text-xs text-zinc-600 -mt-1">
              Paste the base URL (e.g. https://cow-mcp.yeetful.com). Auto-fill grabs
              metadata; on save every tool is discovered from the server and wired up.
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                <input
                  type="url"
                  placeholder="https://your-mcp-server.com"
                  value={form.websiteUrl}
                  onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800/60 text-white placeholder-zinc-600 text-sm max-lg:text-base focus:outline-none focus:border-zinc-600 transition-colors"
                />
              </div>
              <button
                type="button"
                onClick={fetchMeta}
                disabled={!form.websiteUrl || fetching}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {fetching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                {fetching ? 'Fetching...' : 'Auto-fill'}
              </button>
            </div>
          </div>

          {/* Main fields */}
          <div className="p-5 rounded-2xl border border-zinc-800/60 bg-zinc-900/40 space-y-4">
            <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Details</p>

            {/* Name */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5 font-medium">
                Server Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="My Custom Server"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800/60 text-white placeholder-zinc-600 text-sm max-lg:text-base focus:outline-none focus:border-zinc-600 transition-colors"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5 font-medium">
                Description <span className="text-red-400">*</span>
              </label>
              <textarea
                required
                rows={2}
                placeholder="What does this MCP server do?"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800/60 text-white placeholder-zinc-600 text-sm max-lg:text-base focus:outline-none focus:border-zinc-600 transition-colors resize-none"
              />
            </div>

            {/* Category + Color */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5 font-medium">
                  Category <span className="text-red-400">*</span>
                </label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800/60 text-white text-sm max-lg:text-base focus:outline-none focus:border-zinc-600 transition-colors"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_ICONS[c] || '📦'} {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5 font-medium">
                  Accent Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="w-10 h-10 rounded-xl border border-zinc-700 bg-zinc-900 cursor-pointer p-1"
                  />
                  <input
                    type="text"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800/60 text-white text-sm max-lg:text-base font-mono focus:outline-none focus:border-zinc-600"
                  />
                </div>
              </div>
            </div>

            {/* Icon URL */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5 font-medium">
                Icon URL
              </label>
              <div className="flex items-center gap-3">
                {form.iconUrl && !imgError && (
                  <div className="w-10 h-10 rounded-xl border border-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0 bg-zinc-900">
                    <Image
                      src={form.iconUrl}
                      alt="Icon preview"
                      width={32}
                      height={32}
                      className="object-contain"
                      onError={() => setImgError(true)}
                      unoptimized
                    />
                  </div>
                )}
                <input
                  type="url"
                  placeholder="https://example.com/icon.png"
                  value={form.iconUrl}
                  onChange={(e) => {
                    setImgError(false)
                    setForm((f) => ({ ...f, iconUrl: e.target.value }))
                  }}
                  className="flex-1 px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800/60 text-white placeholder-zinc-600 text-sm max-lg:text-base focus:outline-none focus:border-zinc-600 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Config fields */}
          <div className="p-5 rounded-2xl border border-zinc-800/60 bg-zinc-900/40 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
                Config Fields (Optional)
              </p>
              <button
                type="button"
                onClick={addConfigField}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add field
              </button>
            </div>

            <AnimatePresence>
              {form.configFields.map((field, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    placeholder="key (e.g. apiKey)"
                    value={field.key}
                    onChange={(e) => updateConfigField(i, { key: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800/60 text-white placeholder-zinc-600 text-xs focus:outline-none focus:border-zinc-600"
                  />
                  <input
                    type="text"
                    placeholder="Label"
                    value={field.label}
                    onChange={(e) => updateConfigField(i, { label: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800/60 text-white placeholder-zinc-600 text-xs focus:outline-none focus:border-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => updateConfigField(i, { required: !field.required })}
                    className={cn(
                      'px-2 py-2 rounded-lg text-xs font-medium transition-colors',
                      field.required
                        ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                        : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                    )}
                  >
                    {field.required ? 'req' : 'opt'}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeConfigField(i)}
                    className="p-2 text-zinc-700 hover:text-red-400 transition-colors rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>

            {form.configFields.length === 0 && (
              <p className="text-xs text-zinc-700 py-2">
                Add config fields for API keys or credentials users need to provide.
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </motion.div>
          )}

          {/* Success detail */}
          {success && successMsg && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm"
            >
              <Check className="w-4 h-4 flex-shrink-0" />
              {successMsg}
            </motion.div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={saving || !form.name}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all duration-200',
              success
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : success ? (
              <Check className="w-4 h-4" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {saving ? 'Saving...' : success ? 'Added!' : 'Add Server'}
          </button>
        </motion.form>

        {/* Custom servers list */}
        {customServers.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-12"
          >
            <h2 className="text-lg font-bold text-white mb-4">Your Custom Servers</h2>
            <div className="space-y-3">
              {customServers.map((server) => (
                <div
                  key={server.id}
                  className="flex items-center gap-3 p-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/40"
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                    style={{ background: `${server.color}22`, border: `1px solid ${server.color}33` }}
                  >
                    {server.iconUrl ? (
                      <Image
                        src={server.iconUrl}
                        alt={server.name}
                        width={24}
                        height={24}
                        className="object-contain rounded"
                        unoptimized
                        onError={() => {}}
                      />
                    ) : (
                      <span>{CATEGORY_ICONS[server.category] || '⚡'}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{server.name}</p>
                    <p className="text-xs text-zinc-500 truncate">{server.description}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {server.websiteUrl && (
                      <a
                        href={server.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-zinc-600 hover:text-zinc-300 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          await fetch(`/api/servers?id=${server.id}`, { method: 'DELETE' })
                        } catch {}
                        removeServer(server.id)
                      }}
                      className="p-1.5 text-zinc-700 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
