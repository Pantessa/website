'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, animate, motion, useReducedMotion } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, Clock, ExternalLink, RefreshCw, Repeat, Vote, Wallet } from 'lucide-react'
import BrandIcon from '@/components/BrandIcon'
import SwapPanel from '@/components/panels/SwapPanel'
import GovernancePanel from '@/components/panels/GovernancePanel'
import { useYeetfulStore, type McpServer } from '@/lib/store'
import { chainById } from '@/lib/chains'
import { splashCapable } from '@/lib/splash/types'
import type { ActivityTile, HoldingsTile, ProposalsTile, RowsTile, SplashTile } from '@/lib/splash/types'
import { PANEL_TITLES, derivePanels, tilePanelKind, type PanelKind } from '@/lib/panels/types'

/**
 * App Mode: the working set rendered as a persistent structured workspace —
 * portfolio, swap, governance, earn, positions — instead of a transcript.
 * Data rides the SAME pipeline as the splash (/api/splash → SplashTile),
 * mapped into panels by lib/panels/types. Chat stays docked below as the
 * command bar (ChatInterface owns the input in both modes).
 *
 * Motion charter (Nate): animation only ever shows real data or a real
 * transition — panel entrances are spatial (the mode switch), totals count
 * up from live values, refreshes sweep. Nothing idles, everything honors
 * prefers-reduced-motion, transform/opacity only.
 */
export default function AppModeWorkspace({
  address,
  onPick,
}: {
  address?: string
  /** Prefill the command bar (same contract as the splash's prompt chips). */
  onPick: (prompt: string, slug?: string) => void
}) {
  const { servers, activeServerIds, manualSlugs, selectedChainId } = useYeetfulStore()
  const [tiles, setTiles] = useState<SplashTile[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const reduced = useReducedMotion()

  const activeServers = useMemo(
    () => servers.filter((s) => activeServerIds.includes(s.id)),
    [servers, activeServerIds],
  )
  const relevant = useMemo(
    () => activeServers.filter((s) => splashCapable(s) || manualSlugs.includes(s.slug)),
    [activeServers, manualSlugs],
  )
  const panels = useMemo(() => derivePanels(activeServers), [activeServers])
  const chainKey = selectedChainId ? chainById(selectedChainId)?.key ?? '' : ''

  // Same stable-key scan discipline as SplashDashboard: refetch only when the
  // wallet, the relevant set, or the chain scope actually changes.
  const key = `${address ?? ''}|${relevant.map((s) => s.id).sort().join(',')}|${chainKey}`
  useEffect(() => {
    if (!address || relevant.length === 0) {
      setTiles(null)
      return
    }
    let alive = true
    setLoading(true)
    fetch('/api/splash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        address,
        servers: relevant,
        manualSlugs: manualSlugs.filter((slug) => relevant.some((s) => s.slug === slug)),
        ...(chainKey ? { chain: chainKey } : {}),
      }),
    })
      .then((r) => r.json())
      .then((data: { tiles?: SplashTile[] }) => {
        if (alive) setTiles(Array.isArray(data.tiles) ? data.tiles : [])
      })
      .catch(() => {
        if (alive) setTiles([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload])

  if (!address) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <Wallet className="mx-auto mb-3 h-6 w-6 text-[color:var(--muted-2)]" />
          <p className="text-sm text-[color:var(--muted)]">
            Connect a wallet to open your workspace — balances, swaps and votes, live.
          </p>
        </div>
      </div>
    )
  }

  // Tiles routed into their panel slots (a panel with no data yet still gets
  // its frame — skeleton while loading, honest empty text after).
  const byPanel = new Map<PanelKind, SplashTile[]>()
  for (const t of tiles ?? []) {
    const kind = tilePanelKind(t)
    if (!kind) continue
    byPanel.set(kind, [...(byPanel.get(kind) ?? []), t])
  }
  const errorTiles = (tiles ?? []).filter((t) => t.render === 'error')

  return (
    <div className="mx-auto w-full max-w-[1600px] px-1 py-4 md:px-4">
      <div className="mb-4 flex items-center gap-2">
        <Wallet className="h-4 w-4 text-[color:var(--muted-2)]" />
        <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
          Workspace · {shortAddr(address)}
        </span>
        {loading && tiles && (
          <RefreshCw className="h-3 w-3 animate-spin text-[color:var(--muted-2)]" aria-label="Refreshing" />
        )}
      </div>
      {/* Entrance + layout springs only — NO exit animation: AnimatePresence
          exit-gating leaves ghost panels wherever rAF is starved (hidden
          tabs, headless verification), so a panel whose MCP left the set
          must unmount instantly. */}
      <div className="grid grid-cols-1 gap-4 md:auto-rows-fr md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence initial={false}>
          {panels.map((p, i) => (
            <motion.div
              key={p.kind}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34, delay: reduced ? 0 : i * 0.05 }}
              className={p.span === 2 ? 'min-w-0 md:col-span-2' : 'min-w-0'}
            >
              <PanelFrame
                kind={p.kind}
                slugs={p.slugs}
                servers={servers}
                tiles={byPanel.get(p.kind) ?? []}
                loading={loading && !tiles}
                errors={errorTiles.filter((t) => p.slugs.includes(t.mcpSlug))}
                onRetry={() => setReload((n) => n + 1)}
                onPick={onPick}
                reduced={!!reduced}
                address={address}
                chainId={selectedChainId}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Panel frame ──────────────────────────────────────────────────────────────

function PanelFrame({
  kind,
  slugs,
  servers,
  tiles,
  loading,
  errors,
  onRetry,
  onPick,
  reduced,
  address,
  chainId,
}: {
  kind: PanelKind
  slugs: string[]
  servers: McpServer[]
  tiles: SplashTile[]
  loading: boolean
  errors: SplashTile[]
  onRetry: () => void
  onPick: (prompt: string, slug?: string) => void
  reduced: boolean
  address?: string
  chainId: number | null
}) {
  const feeders = slugs
    .map((slug) => servers.find((s) => s.slug === slug))
    .filter((s): s is McpServer => !!s)
  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4 transition-colors hover:border-[var(--line-2)]">
      <div aria-hidden className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="mono text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-2)]">
          {PANEL_TITLES[kind]}
        </h3>
        <div className="flex items-center -space-x-1.5">
          {feeders.slice(0, 3).map((s) => (
            <Link
              key={s.slug}
              href={`/servers/${s.slug}`}
              title={s.name}
              className="grid h-5 w-5 place-items-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surf-2)]"
            >
              <BrandIcon server={s} size={12} />
            </Link>
          ))}
        </div>
      </div>
      {loading ? (
        <PanelSkeleton />
      ) : kind === 'swap' ? (
        address ? (
          <SwapPanel address={address} chainId={chainId} />
        ) : (
          <p className="flex-1 text-xs leading-relaxed text-[color:var(--muted)]">{emptyCopy(kind)}</p>
        )
      ) : tiles.length === 0 ? (
        errors.length > 0 ? (
          <div className="flex-1">
            <p className="text-xs text-[color:var(--muted)]">{(errors[0] as { message?: string }).message ?? 'Failed to load.'}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[color:var(--muted)] transition-colors hover:border-[var(--line-2)] hover:bg-white/5 hover:text-white"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </div>
        ) : (
          <p className="flex-1 text-xs leading-relaxed text-[color:var(--muted)]">{emptyCopy(kind)}</p>
        )
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          {tiles.map((t) => (
            <PanelTileBody key={t.id} tile={t} reduced={reduced} />
          ))}
          {/* Earn/positions actions ride the tiles' own suggested prompts —
              real per-MCP asks (stake, supply, close) into the command bar.
              The guarded inline builds (like the swap panel's) are the v2
              upgrade; a prefill through chat's proven flow ships first. */}
          {(kind === 'earn' || kind === 'positions') && (
            <div className="mt-auto flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3">
              {dedupeBy(
                tiles.flatMap((t) => t.prompts.map((pr) => ({ ...pr, slug: t.mcpSlug }))),
                (pr) => pr.label,
              )
                .slice(0, 3)
                .map((pr) => (
                  <button
                    key={pr.label}
                    type="button"
                    title={pr.prompt}
                    onClick={() => onPick(pr.prompt, pr.slug)}
                    className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[color:var(--muted)] transition-colors hover:border-[var(--line-2)] hover:bg-white/5 hover:text-white"
                  >
                    {pr.label}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((t) => (seen.has(key(t)) ? false : (seen.add(key(t)), true)))
}

function emptyCopy(kind: PanelKind): string {
  switch (kind) {
    case 'portfolio':
      return 'No holdings found for this wallet on the selected chain.'
    case 'governance':
      return 'No open proposals in the spaces this wallet follows.'
    case 'earn':
      return 'No staking or lending positions yet — ask the command bar to stake or supply.'
    case 'positions':
      return 'No open positions or orders.'
    case 'activity':
      return 'No recent transactions.'
    case 'swap':
      return 'Pick two tokens to quote a guarded swap.'
  }
}

function PanelTileBody({ tile, reduced }: { tile: SplashTile; reduced: boolean }) {
  switch (tile.render) {
    case 'holdings':
      return <HoldingsBody tile={tile} reduced={reduced} />
    case 'proposals':
      return <GovernancePanel tile={tile} />
    case 'rows':
      return <RowsBody tile={tile} reduced={reduced} />
    case 'activity':
      return <ActivityBody tile={tile} />
    default:
      return null
  }
}

// ── Portfolio ────────────────────────────────────────────────────────────────

function HoldingsBody({ tile, reduced }: { tile: HoldingsTile; reduced: boolean }) {
  return (
    <div className="flex-1">
      {tile.totalUsd !== null && (
        <div className="mb-3">
          <CountUpUsd value={tile.totalUsd} reduced={reduced} className="text-3xl font-semibold tracking-tight text-white" />
          <span className="ml-2 text-[11px] text-[color:var(--muted-2)]">
            {tile.chain.includes('·') ? 'total portfolio' : `total on ${tile.chain}`}
          </span>
        </div>
      )}
      {/* Two columns on wide screens — the portfolio panel is double-width,
          so a single column of rows would read as a stripe of dead space. */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-x-8">
        {tile.holdings.map((h, i) => {
          // Share-of-portfolio bar — real data only (skip when unpriced).
          const share =
            tile.totalUsd && tile.totalUsd > 0 && h.valueUsd !== null
              ? Math.min(1, h.valueUsd / tile.totalUsd)
              : null
          return (
            <div key={(h.chain ?? '') + h.address + h.symbol}>
              <div className="flex items-center justify-between gap-2 text-xs">
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
              {share !== null && (
                <div className="ml-8 mt-1 h-0.5 overflow-hidden rounded-full bg-white/5">
                  <motion.div
                    initial={reduced ? { width: `${share * 100}%` } : { width: 0 }}
                    animate={{ width: `${share * 100}%` }}
                    transition={{ duration: 0.7, ease: 'easeOut', delay: reduced ? 0 : 0.15 + i * 0.06 }}
                    className="h-full rounded-full bg-[color:var(--accent)]/70"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Animated USD headline: counts from the previous value to the new one on
 *  every data refresh — a number that never jumps. Real values only. */
function CountUpUsd({ value, reduced, className }: { value: number; reduced: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // First paint shows the real number instantly — the count-up runs only on
    // live data CHANGES ("numbers never jump" is about transitions, and a
    // 0-to-value spin-up on mount would be animation without new data).
    if (reduced || prev.current === null) {
      el.textContent = usd(value)
      prev.current = value
      return
    }
    if (prev.current === value) return
    const controls = animate(prev.current, value, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: (v) => {
        el.textContent = usd(v)
      },
    })
    prev.current = value
    return () => controls.stop()
  }, [value, reduced])
  return <span ref={ref} className={className} />
}

// ── Earn / Positions (generic rows) ──────────────────────────────────────────

function RowsBody({ tile, reduced }: { tile: RowsTile; reduced: boolean }) {
  return (
    <div className="flex-1">
      {tile.headline && (
        <div className="mb-3">
          {/* Headline values arrive pre-formatted; only pure-USD ones count up. */}
          {parseUsd(tile.headline.value) !== null ? (
            <CountUpUsd value={parseUsd(tile.headline.value)!} reduced={reduced} className="text-2xl font-semibold tracking-tight text-white" />
          ) : (
            <span className="text-2xl font-semibold tracking-tight text-white">{tile.headline.value}</span>
          )}
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
              <span className={r.tone === 'pos' ? 'text-[color:var(--accent)]' : r.tone === 'neg' ? 'text-red-400' : 'text-white'}>
                {r.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Activity ─────────────────────────────────────────────────────────────────

function ActivityBody({ tile }: { tile: ActivityTile }) {
  return (
    <div className="flex-1 space-y-1">
      {tile.rows.slice(0, 6).map((r) => {
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

// ── Shared bits ──────────────────────────────────────────────────────────────

function PanelSkeleton() {
  return (
    <div className="flex-1">
      <div className="mb-4 h-7 w-32 animate-pulse rounded bg-white/10" />
      <div className="space-y-2">
        {[0, 1, 2].map((j) => (
          <div key={j} className="h-4 w-full animate-pulse rounded bg-white/5" />
        ))}
      </div>
    </div>
  )
}

// ── formatters (mirrors SplashDashboard's) ───────────────────────────────────

function usd(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(n < 0.01 ? 4 : 2)}`
}

/** "$1,204.55" → 1204.55; anything non-USD → null (rendered verbatim).
 *  Tile values are pre-formatted strings by contract, but a source that leaks
 *  a raw number must degrade to "rendered verbatim" — not take the page down
 *  with it (the lido card shipped numbers here and .match crashed /chat). */
export function parseUsd(s: string): number | null {
  if (typeof s !== 'string') return null
  const m = s.match(/^\$([\d,]+(?:\.\d+)?)$/)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
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
