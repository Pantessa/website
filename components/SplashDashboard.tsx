'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, Clock, ExternalLink, RefreshCw, Repeat, Vote, Wallet } from 'lucide-react'
import BrandIcon from '@/components/BrandIcon'
import { useYeetfulStore, type McpServer } from '@/lib/store'
import { chainById } from '@/lib/chains'
import ChatLoader from '@/components/ChatLoader'
import { splashCapable } from '@/lib/splash/types'
import type { ActivityTile, ErrorTile, HoldingsTile, ProposalsTile, RowsTile, SplashTile, SuggestedPrompt } from '@/lib/splash/types'

/**
 * The connected-wallet splash: when someone jumps into the chat with a wallet
 * and connected MCPs, we scan the address and paint a per-MCP dashboard
 * (Uniswap portfolio, Snapshot proposals, …) instead of an empty box. The
 * cards are part of the chat flow — typing never dismisses them; they scroll
 * up with the conversation like any other turn, and ChatInterface renders a
 * fresh instance (a "batch") when new MCPs join mid-conversation.
 *
 * Everything below the fold is data-driven off SplashTile.render — a new MCP
 * that returns one of these shapes gets a tile with no new code here.
 */
export function SplashDashboard({
  address,
  servers,
  manualSlugs = [],
  onPick,
  chrome = true,
  hint = false,
  onResolve,
}: {
  address?: string
  servers: McpServer[]
  /** Slugs the user explicitly toggled on — these MCPs always get a card
   *  (a preview when the wallet has no activity on them). */
  manualSlugs?: string[]
  onPick: (prompt: string, slug?: string) => void
  /** Show the "Connected · 0x…" wallet eyebrow — the boot batch only; cards
   *  added mid-conversation skip it. */
  chrome?: boolean
  /** Show the "Start typing…" footer — only on a still-empty chat. */
  hint?: boolean
  /** Reports how many tiles resolved (0 → caller shows its normal empty state). */
  onResolve?: (count: number) => void
}) {
  const [tiles, setTiles] = useState<SplashTile[] | null>(null)
  const [loading, setLoading] = useState(false)
  // Bumped by a tile's Retry button to force a fresh scan.
  const [reload, setReload] = useState(0)
  // The chain picker's selection — cards re-scan scoped to it (null = all).
  const selectedChainId = useYeetfulStore((s) => s.selectedChainId)
  const chainKey = selectedChainId ? chainById(selectedChainId)?.key ?? '' : ''

  // Sources that can contribute, plus anything the user hand-picked — a manual
  // selection always earns a card, splash-capable or not.
  const relevant = useMemo(
    () => servers.filter((s) => splashCapable(s) || manualSlugs.includes(s.slug)),
    [servers, manualSlugs],
  )
  const relevantManual = useMemo(
    () => relevant.filter((s) => manualSlugs.includes(s.slug)).map((s) => s.slug),
    [relevant, manualSlugs],
  )
  // A stable string key so the scan re-runs only when the wallet or the set of
  // dashboard-capable MCPs actually changes — not on every render (relevant is
  // a fresh array each time). Depending on the string (not the array) also
  // keeps React 18 StrictMode's mount→cleanup→mount from aborting the only
  // in-flight fetch and leaving the skeleton up forever.
  const key = `${address ?? ''}|${relevant.map((s) => s.id).sort().join(',')}|${relevantManual.slice().sort().join(',')}|${chainKey}`

  useEffect(() => {
    if (!address || relevant.length === 0) {
      setTiles(null)
      return
    }
    let alive = true
    setLoading(true)
    setTiles(null)
    fetch('/api/splash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, servers: relevant, manualSlugs: relevantManual, ...(chainKey ? { chain: chainKey } : {}) }),
    })
      .then((r) => r.json())
      .then((data: { tiles?: SplashTile[] }) => {
        if (!alive) return
        const next = Array.isArray(data.tiles) ? data.tiles : []
        setTiles(next)
        onResolve?.(next.length)
      })
      .catch(() => {
        if (!alive) return
        setTiles([])
        onResolve?.(0)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload])

  // Nothing to show — let the caller render its normal empty state.
  if (!address || relevant.length === 0) return null
  if (!loading && tiles && tiles.length === 0) return null

  return (
    <div className="w-full">
      <div className={`mx-auto w-full max-w-[1600px] px-1 md:px-4 ${chrome ? 'py-6' : 'py-2'}`}>
        {chrome && (
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-4 w-4 text-[color:var(--muted-2)]" />
            <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
              Connected · {shortAddr(address)}
            </span>
          </div>
        )}

        {loading || !tiles ? (
          <ChatLoader inline />
        ) : (
          // A strict grid: every card is the same size (auto-rows-fr equalizes
          // every row to one shared height), so six cards on a big screen read
          // as one composed surface instead of a masonry scatter. Cards absorb
          // any extra height internally — bodies stretch, prompt chips pin to
          // the bottom edge. Mobile stays natural-height (1 col, nothing to
          // align with).
          <div className="grid grid-cols-1 gap-4 md:auto-rows-fr md:grid-cols-2 xl:grid-cols-3">
            {groupBySlug(tiles).map((group) => (
              <div key={group[0].mcpSlug} className="min-w-0">
                <TileCard tiles={group} onPick={onPick} onRetry={() => setReload((n) => n + 1)} />
              </div>
            ))}
          </div>
        )}

        {hint && (
          <p className="mt-4 text-center text-[11px] text-[color:var(--muted-2)]">
            Start typing to ask about any of this.
          </p>
        )}
      </div>
    </div>
  )
}

/** Group tiles by their MCP, preserving first-seen order — the grid renders
 *  one card per MCP. */
function groupBySlug(tiles: SplashTile[]): SplashTile[][] {
  const bySlug = new Map<string, SplashTile[]>()
  for (const t of tiles) {
    const arr = bySlug.get(t.mcpSlug) ?? []
    arr.push(t)
    bySlug.set(t.mcpSlug, arr)
  }
  return [...bySlug.values()]
}

// ── Tile router ──────────────────────────────────────────────────────────────
// Exported so other splash surfaces can render the same tiles.

/** One tile's content: caption row (what this section is + its scope), the
 *  render-primitive body, and the tile's prompt chips. */
function TileSection({
  tile,
  onRetry,
}: {
  tile: SplashTile
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-1 flex-col">
      {((tile.title && tile.title !== tile.mcpName) || tile.subtitle) && (
        <div className="mb-3 flex items-baseline justify-between gap-2">
          {tile.title && tile.title !== tile.mcpName ? (
            <p className="mono text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">{tile.title}</p>
          ) : (
            <span />
          )}
          {tile.subtitle && <span className="mono flex-shrink-0 text-[10px] text-[color:var(--muted-2)]">{tile.subtitle}</span>}
        </div>
      )}
      {tile.render === 'holdings' && <HoldingsBody tile={tile} />}
      {tile.render === 'proposals' && <ProposalsBody tile={tile} />}
      {tile.render === 'rows' && <RowsBody tile={tile} />}
      {tile.render === 'activity' && <ActivityBody tile={tile} />}
      {tile.render === 'empty' && <p className="flex-1 text-xs leading-relaxed text-[color:var(--muted)]">{tile.message}</p>}
      {tile.render === 'error' && <ErrorBody tile={tile} onRetry={onRetry} />}
    </div>
  )
}

/** ONE card per MCP: branded header (logo + name → the server page) and every
 *  tile that MCP contributed stacked as sections — an MCP with a portfolio
 *  AND an activity tile is one card with two sections, never two cards with
 *  the same header (read as duplicates, live 2026-07-10). */
export function TileCard({
  tile,
  tiles,
  onPick,
  onRetry,
}: {
  /** Single-tile call sites pass `tile`… */
  tile?: SplashTile
  /** …the splash grid passes the MCP's whole tile group. */
  tiles?: SplashTile[]
  onPick: (p: string, slug?: string) => void
  onRetry?: () => void
}) {
  const group = tiles && tiles.length > 0 ? tiles : tile ? [tile] : []
  // The card belongs to an MCP — its header IS that MCP: logo + name, linking
  // to the server page. The store row carries the logo; a minimal stand-in
  // covers rows not in the loaded catalog (BrandIcon falls back to a mark).
  const head = group[0]
  const server = useYeetfulStore((s) => (head ? s.servers.find((x) => x.slug === head.mcpSlug) : undefined))
  if (!head) return null
  const iconServer = server ?? ({ id: head.mcpSlug, slug: head.mcpSlug, name: head.mcpName } as McpServer)
  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4 text-left transition-colors hover:border-[var(--line-2)]">
      {/* Hairline sheen along the top edge — the site's accent language. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link
          href={`/servers/${head.mcpSlug}`}
          className="group/head flex min-w-0 items-center gap-2"
          title={`Open ${head.mcpName}'s server page`}
        >
          <BrandIcon server={iconServer} size={20} />
          <h3 className="truncate text-sm font-semibold text-white underline-offset-4 group-hover/head:underline">
            {head.mcpName}
          </h3>
          <ExternalLink className="h-3 w-3 flex-shrink-0 text-[color:var(--muted-2)] opacity-0 transition-opacity group-hover/head:opacity-100" />
        </Link>
      </div>
      {group.map((t, i) => (
        <div key={t.id} className={i > 0 ? 'mt-4 border-t border-[var(--line)] pt-4' : undefined}>
          <TileSection tile={t} onRetry={onRetry} />
        </div>
      ))}
      {/* ONE chip row per card, pinned to the bottom edge (mt-auto): in the
          equal-height grid every card's chips sit on the same baseline, and a
          multi-section card doesn't pay a divider+chips band per section.
          Capped at 4 so a multi-tile card's union stays a tidy row. */}
      <PromptChips prompts={dedupePrompts(group.flatMap((t) => t.prompts)).slice(0, 4)} slug={head.mcpSlug} onPick={onPick} />
    </div>
  )
}

/** Union of a card group's prompts, first-seen order, deduped by label. */
function dedupePrompts(prompts: SuggestedPrompt[]): SuggestedPrompt[] {
  const seen = new Set<string>()
  return prompts.filter((p) => (seen.has(p.label) ? false : (seen.add(p.label), true)))
}

// ── Error (a source that failed — retryable, never silent) ───────────────────

function ErrorBody({ tile, onRetry }: { tile: ErrorTile; onRetry?: () => void }) {
  return (
    <div className="flex-1">
      <p className="text-xs text-[color:var(--muted)]">{tile.message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[color:var(--muted)] transition-colors hover:border-[var(--line-2)] hover:bg-white/5 hover:text-white"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      )}
    </div>
  )
}

// ── Activity (recent transactions, multichain) ───────────────────────────────

function ActivityBody({ tile }: { tile: ActivityTile }) {
  return (
    <div className="flex-1 space-y-1">
      {tile.rows.map((r) => {
        const Icon = r.direction === 'out' ? ArrowUpRight : r.direction === 'in' ? ArrowDownLeft : Repeat
        const verb = r.direction === 'out' ? 'Sent' : r.direction === 'in' ? 'Received' : 'Self'
        return (
          <a
            key={r.chain + r.hash}
            href={r.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group -mx-1 flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-xs transition-colors hover:bg-white/5"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                  r.direction === 'in' ? 'bg-[color:var(--accent)]/15 text-[color:var(--accent)]' : 'bg-white/5 text-[color:var(--muted)]'
                }`}
              >
                <Icon className="h-3 w-3" />
              </span>
              <div className="min-w-0">
                <div className="truncate font-medium text-white">
                  {verb} {r.amount && `${r.amount} `}
                  {r.asset}
                </div>
                <div className="truncate text-[10px] text-[color:var(--muted-2)]">
                  {r.chain} · {r.direction === 'out' ? 'to' : 'from'} {r.counterparty}
                  {r.timestamp ? ` · ${ago(r.timestamp)}` : ''}
                </div>
              </div>
            </div>
            <ExternalLink className="h-3 w-3 shrink-0 text-[color:var(--muted-2)] opacity-0 transition-opacity group-hover:opacity-70" />
          </a>
        )
      })}
    </div>
  )
}

// ── Rows (generic account-state list: positions, orders, fills) ─────────────

function RowsBody({ tile }: { tile: RowsTile }) {
  return (
    <div className="flex-1">
      {tile.headline && (
        <div className="mb-3">
          <span className="text-2xl font-semibold tracking-tight text-white">{tile.headline.value}</span>
          <span className="ml-2 text-[11px] text-[color:var(--muted-2)]">{tile.headline.caption}</span>
        </div>
      )}
      <div className="space-y-1.5">
        {tile.rows.map((r, i) => (
          <div key={`${r.label}-${i}`} className="flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0">
              <div className="truncate font-medium text-white">{r.label}</div>
              {r.sub && <div className="text-[10px] text-[color:var(--muted-2)]">{r.sub}</div>}
            </div>
            {r.value && (
              <span
                className={
                  r.tone === 'pos'
                    ? 'text-[color:var(--accent)]'
                    : r.tone === 'neg'
                      ? 'text-red-400'
                      : 'text-white'
                }
              >
                {r.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Holdings (portfolio) ─────────────────────────────────────────────────────

function HoldingsBody({ tile }: { tile: HoldingsTile }) {
  return (
    <div className="flex-1">
      {tile.totalUsd !== null && (
        <div className="mb-3">
          <span className="text-2xl font-semibold tracking-tight text-white">{usd(tile.totalUsd)}</span>
          <span className="ml-2 text-[11px] text-[color:var(--muted-2)]">
            {tile.chain.includes('·') ? 'total portfolio' : `total on ${tile.chain}`}
          </span>
        </div>
      )}
      <div className="space-y-1.5">
        {tile.holdings.map((h) => (
          <div key={(h.chain ?? '') + h.address + h.symbol} className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-white/5 text-[10px] font-semibold text-[color:var(--muted)]">
                {h.symbol.slice(0, 3)}
              </span>
              <span className="font-medium text-white">{h.symbol}</span>
              {h.native && <span className="mono text-[9px] text-[color:var(--muted-2)]">native</span>}
              {h.chain && <span className="rounded bg-white/5 px-1 py-0.5 text-[9px] text-[color:var(--muted-2)]">{h.chain}</span>}
            </div>
            <div className="text-right">
              <div className="text-white">{h.valueUsd !== null ? usd(h.valueUsd) : '—'}</div>
              <div className="text-[10px] text-[color:var(--muted-2)]">{trimNum(h.balance)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Proposals (governance) ───────────────────────────────────────────────────

function ProposalsBody({ tile }: { tile: ProposalsTile }) {
  return (
    <div className="flex-1">
      {tile.spaces.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {tile.spaces.slice(0, 8).map((s) => (
            <span key={s.id} className="flex items-center gap-1 rounded-full bg-white/5 py-0.5 pl-0.5 pr-2">
              <Avatar url={s.avatarUrl} label={s.name} size={16} />
              <span className="text-[10px] text-[color:var(--muted)]">{s.name}</span>
            </span>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {tile.proposals.slice(0, 4).map((p) => (
          <div key={p.id} className="flex items-start gap-2">
            <Avatar url={p.avatarUrl} label={p.spaceName} size={22} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-white" title={p.title}>
                {p.title}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[color:var(--muted-2)]">
                <span className="flex items-center gap-1">
                  <Vote className="h-3 w-3" /> {p.spaceName}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {endsIn(p.endsAt)}
                </span>
                {p.leadingChoice && <span className="text-[color:var(--accent)]">{p.leadingChoice} leading</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function PromptChips({
  prompts,
  slug,
  onPick,
}: {
  prompts: SuggestedPrompt[]
  slug: string
  onPick: (p: string, slug?: string) => void
}) {
  if (prompts.length === 0) return null
  return (
    // mt-auto pins the row to the card's bottom in the equal-height grid;
    // pt-4 keeps a minimum gap when the card sits at its natural height.
    <div className="mt-auto pt-4">
      <div className="flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3">
        {prompts.map((p) => (
          <button
            key={p.label}
            type="button"
            title={p.prompt}
            onClick={() => onPick(p.prompt, slug)}
            className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[color:var(--muted)] transition-colors hover:border-[var(--line-2)] hover:bg-white/5 hover:text-white"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Avatar({ url, label, size }: { url: string; label: string; size: number }) {
  const [failed, setFailed] = useState(false)
  if (failed || !url) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-full bg-white/10 text-[9px] font-semibold text-[color:var(--muted)]"
        style={{ height: size, width: size }}
      >
        {label.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={label}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full object-cover"
      style={{ height: size, width: size }}
    />
  )
}

export function SkeletonTiles({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: Math.max(1, Math.min(count, 2)) }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4">
          <div className="mb-3 h-3 w-24 animate-pulse rounded bg-white/10" />
          <div className="mb-4 h-7 w-32 animate-pulse rounded bg-white/10" />
          <div className="space-y-2">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-4 w-full animate-pulse rounded bg-white/5" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── formatters ───────────────────────────────────────────────────────────────

function usd(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(n < 0.01 ? 4 : 2)}`
}

function trimNum(s: string): string {
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

function endsIn(unixSec: number): string {
  const ms = unixSec * 1000 - Date.now()
  if (ms <= 0) return 'ended'
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m left`
  if (h < 48) return `${h}h left`
  return `${Math.floor(h / 24)}d left`
}

/** Relative "time ago" for a past unix-seconds timestamp. */
function ago(unixSec: number): string {
  const s = Math.floor((Date.now() - unixSec * 1000) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`
}
