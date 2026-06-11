'use client'

// Dashboard panel for headless-agent API keys (the `yf_…` Bearer credentials
// accepted on /api/grants*). Mint shows the plaintext secret exactly ONCE —
// the server stores only its sha256 — so the reveal block stays up until the
// owner confirms they've saved it. Revocation is immediate (every Bearer
// request re-resolves the hash).

import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ApiKeyRow {
  id: string
  label: string
  prefix: string
  lastUsedAt: string | null
  createdAt: string
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? 'never' : d.toLocaleDateString()
}

export default function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null)
  const [label, setLabel] = useState('')
  const [minting, setMinting] = useState(false)
  const [minted, setMinted] = useState<{ secret: string; label: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/keys', { cache: 'no-store' })
      if (res.ok) setKeys(await res.json())
      else setKeys([])
    } catch {
      setKeys([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const mint = async () => {
    setMinting(true)
    setError('')
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Mint failed.')
      setMinted({ secret: data.secret, label: data.label })
      setCopied(false)
      setLabel('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mint failed.')
    } finally {
      setMinting(false)
    }
  }

  const copySecret = async () => {
    if (!minted) return
    try {
      await navigator.clipboard.writeText(minted.secret)
      setCopied(true)
    } catch {
      /* clipboard unavailable — the secret is selectable below */
    }
  }

  const revoke = async (id: string) => {
    if (confirmRevoke !== id) {
      setConfirmRevoke(id)
      return
    }
    setConfirmRevoke(null)
    setKeys((prev) => prev?.filter((k) => k.id !== id) ?? prev) // optimistic
    try {
      await fetch(`/api/keys/${id}`, { method: 'DELETE' })
    } finally {
      void load()
    }
  }

  return (
    // id anchors the /developers "Mint a key" deep link (scroll-mt clears the sticky nav)
    <div id="api-keys" className="scroll-mt-20 rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4 mb-6">
      <h2 className="text-sm font-semibold text-white mb-1">
        API keys
        <span className="font-normal text-[color:var(--muted-2)]">
          {' '}
          — Bearer credentials for headless agents (SDK ledger sync, scripts, CI)
        </span>
      </h2>

      {/* Show-once secret reveal */}
      {minted && (
        <div className="my-3 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] p-3">
          <p className="text-xs text-emerald-300 font-medium">
            “{minted.label}” minted — copy it now, you won&apos;t see it again.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <code className="flex-1 min-w-0 text-[11px] mono text-white bg-black/40 rounded-lg px-2.5 py-2 break-all select-all">
              {minted.secret}
            </code>
            <button
              onClick={copySecret}
              className="flex-shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setMinted(null)}
            className="mt-2 text-[11px] text-[color:var(--muted)] hover:text-white transition-colors underline underline-offset-2 decoration-dotted"
          >
            I&apos;ve saved it — dismiss
          </button>
        </div>
      )}

      {/* Mint */}
      <div className="flex items-center gap-2 mt-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !minting) void mint()
          }}
          placeholder="Label (e.g. travel-agent prod)"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-black/30 border border-[var(--line)] text-white placeholder-[color:var(--muted-2)] text-xs focus:outline-none focus:border-[var(--line-2)] transition-colors"
        />
        <button
          onClick={() => void mint()}
          disabled={minting}
          className="flex-shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-50 transition-colors"
        >
          {minting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Mint key
        </button>
      </div>
      {error && <p className="text-[11px] text-red-400 mt-2">{error}</p>}

      {/* List */}
      {!keys ? (
        <p className="text-xs text-[color:var(--muted-2)] py-4">Loading keys…</p>
      ) : keys.length === 0 ? (
        <div className="flex items-start gap-2.5 mt-4 text-[color:var(--muted-2)]">
          <KeyRound className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">
            No keys yet. A key lets a headless agent authenticate as your wallet on the grants
            API — the <span className="mono">yeetful</span> SDK uses it to sync receipts into
            this dashboard. The secret is shown once at mint; only its hash is stored.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex items-center gap-3 px-3 py-2 rounded-xl border border-[var(--line)] bg-black/20"
            >
              <span className="mono text-[11px] text-white flex-shrink-0">{k.prefix}…</span>
              <span className="text-xs text-[color:var(--muted)] truncate flex-1 min-w-0">
                {k.label}
              </span>
              <span className="text-[10px] text-[color:var(--muted-2)] mono flex-shrink-0 hidden sm:inline">
                used {fmtDate(k.lastUsedAt)} · created {fmtDate(k.createdAt)}
              </span>
              <button
                onClick={() => void revoke(k.id)}
                onBlur={() => setConfirmRevoke((c) => (c === k.id ? null : c))}
                className={cn(
                  'flex-shrink-0 flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors',
                  confirmRevoke === k.id
                    ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                    : 'text-[color:var(--muted-2)] hover:text-red-400',
                )}
              >
                <Trash2 className="w-3 h-3" />
                {confirmRevoke === k.id ? 'Confirm revoke' : 'Revoke'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
