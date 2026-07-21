'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Clock, ExternalLink, Info, RefreshCw, Repeat, Vote, Wallet } from 'lucide-react'
import BrandIcon from '@/components/BrandIcon'
import TokenIcon from '@/components/TokenIcon'
import VoteChoiceButtons from '@/components/VoteChoiceButtons'
import { useYeetfulStore, type McpServer } from '@/lib/store'
import { chainById } from '@/lib/chains'
import ChatLoader from '@/components/ChatLoader'
import { splashCapable } from '@/lib/splash/types'
import type { ActivityTile, ErrorTile, HoldingsTile, NftsTile, ProposalsTile, RowsTile, SplashTile, SuggestedPrompt } from '@/lib/splash/types'

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
            Tap a chip to run it — or just start typing.
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
  onPick,
  onRetry,
}: {
  tile: SplashTile
  onPick: (p: string, slug?: string) => void
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
      {tile.render === 'holdings' && <HoldingsBody tile={tile} onPick={onPick} />}
      {tile.render === 'proposals' && <ProposalsBody tile={tile} />}
      {tile.render === 'rows' && <RowsBody tile={tile} onPick={onPick} />}
      {tile.render === 'activity' && <ActivityBody tile={tile} />}
      {tile.render === 'nfts' && <NftsBody tile={tile} onPick={onPick} />}
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
          <TileSection tile={t} onPick={onPick} onRetry={onRetry} />
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

// ── Shared line-item shell (rows / holdings / nfts) ──────────────────────────

/** A row's optional external detail link, from the splash row contract
 *  (types.ts infoUrl/infoLabel). */
const rowInfo = (r: { infoUrl?: string | null; infoLabel?: string }) =>
  r.infoUrl ? { url: r.infoUrl, label: r.infoLabel ?? 'More info' } : null

/** One card line item: display-only, or expand-to-act. The optional `info`
 *  link is the MCP rail's ⓘ affordance carried onto card rows — dynamic cards
 *  pulling from external APIs link each line item to its detail page (OpenSea
 *  item, explorer token page). Expandable rows surface it as a labeled chip
 *  in the action drawer (an <a> can't nest inside the row's <button>);
 *  display-only rows get the rail's hover-revealed ⓘ on the row itself. */
function LineRow({
  left,
  right,
  actions,
  info,
  slug,
  onPick,
  expanded,
  onToggle,
}: {
  left: ReactNode
  right?: ReactNode
  actions: SuggestedPrompt[]
  info: { url: string; label: string } | null
  slug: string
  onPick: (p: string, slug?: string) => void
  expanded: boolean
  onToggle: () => void
}) {
  const expandable = actions.length > 0
  const inner = (
    <>
      {left}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {right}
        {!expandable && info && (
          <a
            href={info.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={info.label}
            title={info.label}
            className="grid h-6 w-6 place-items-center rounded-md text-[color:var(--muted-2)] opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100 hover:bg-white/5 hover:text-white"
          >
            <Info className="h-3.5 w-3.5" />
          </a>
        )}
        {expandable && (
          <ChevronDown className={`h-3.5 w-3.5 text-[color:var(--muted-2)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </div>
    </>
  )
  return (
    <div>
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="-mx-1 flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-xs transition-colors hover:bg-white/5"
        >
          {inner}
        </button>
      ) : (
        <div className="group -mx-1 flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-xs">{inner}</div>
      )}
      {expandable && expanded && (
        <div className="px-1 pb-1">
          <Reveal>
            <InlineActionChips actions={actions} info={info} slug={slug} onPick={onPick} />
          </Reveal>
        </div>
      )}
    </div>
  )
}

// ── Rows (generic account-state list: positions, orders, fills) ─────────────

function RowsBody({ tile, onPick }: { tile: RowsTile; onPick: (p: string, slug?: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="flex-1">
      {tile.headline && (
        <div className="mb-3">
          <span className="text-2xl font-semibold tracking-tight text-white">{tile.headline.value}</span>
          <span className="ml-2 text-[11px] text-[color:var(--muted-2)]">{tile.headline.caption}</span>
        </div>
      )}
      <div className="space-y-1">
        {tile.rows.map((r, i) => {
          const id = `${r.label}-${i}`
          const expanded = open === id
          const value = r.value ? (
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
          ) : null
          return (
            <LineRow
              key={id}
              left={
                <div className="min-w-0 text-left">
                  <div className="truncate font-medium text-white">{r.label}</div>
                  {r.sub && <div className="text-[10px] text-[color:var(--muted-2)]">{r.sub}</div>}
                </div>
              }
              right={value}
              actions={r.actions ?? []}
              info={rowInfo(r)}
              slug={tile.mcpSlug}
              onPick={onPick}
              expanded={expanded}
              onToggle={() => setOpen(expanded ? null : id)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── Holdings (portfolio) ─────────────────────────────────────────────────────

function HoldingsBody({ tile, onPick }: { tile: HoldingsTile; onPick: (p: string, slug?: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
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
      <div className="space-y-1">
        {tile.holdings.map((h) => {
          const id = (h.chain ?? '') + h.address + h.symbol
          const expanded = open === id
          return (
            <LineRow
              key={id}
              left={
                <div className="flex min-w-0 items-center gap-2">
                  <TokenIcon symbol={h.symbol} size={24} />
                  <span className="font-medium text-white">{h.symbol}</span>
                  {h.native && <span className="mono text-[9px] text-[color:var(--muted-2)]">native</span>}
                  {h.chain && <span className="rounded bg-white/5 px-1 py-0.5 text-[9px] text-[color:var(--muted-2)]">{h.chain}</span>}
                </div>
              }
              right={
                <div className="text-right">
                  <div className="text-white">{h.valueUsd !== null ? usd(h.valueUsd) : '—'}</div>
                  <div className="text-[10px] text-[color:var(--muted-2)]">{trimNum(h.balance)}</div>
                </div>
              }
              actions={h.actions ?? []}
              info={rowInfo(h)}
              slug={tile.mcpSlug}
              onPick={onPick}
              expanded={expanded}
              onToggle={() => setOpen(expanded ? null : id)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── NFTs (the OpenSea gallery) ───────────────────────────────────────────────

/** Image-led NFT rows that expand into Sell / Transfer chips — the same
 *  expand-to-act interaction as HoldingsBody, with a thumbnail instead of a
 *  TokenIcon. Floor lines arrive pre-formatted from the source. */
function NftsBody({ tile, onPick }: { tile: NftsTile; onPick: (p: string, slug?: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="flex-1">
      <div className="space-y-1">
        {tile.nfts.map((n) => {
          const id = `${n.chain}${n.contract}${n.tokenId}`
          const expanded = open === id
          return (
            <LineRow
              key={id}
              left={
                <div className="flex min-w-0 items-center gap-2">
                  <NftThumb url={n.imageUrl} label={n.name} />
                  <div className="min-w-0 text-left">
                    <div className="truncate font-medium text-white">{n.name}</div>
                    <div className="truncate text-[10px] text-[color:var(--muted-2)] capitalize">{n.collectionName}</div>
                  </div>
                </div>
              }
              right={
                <div className="text-right">
                  <div className="text-[10px] text-[color:var(--muted)]">{n.floor ?? '—'}</div>
                  <div className="text-[9px] text-[color:var(--muted-2)]">
                    {n.chain}
                    {n.standard === 'erc1155' ? ' · 1155' : ''}
                  </div>
                </div>
              }
              actions={n.actions ?? []}
              info={rowInfo(n)}
              slug={tile.mcpSlug}
              onPick={onPick}
              expanded={expanded}
              onToggle={() => setOpen(expanded ? null : id)}
            />
          )
        })}
      </div>
    </div>
  )
}

/** Square NFT thumbnail with a lettermark fallback (the Avatar's gallery twin). */
function NftThumb({ url, label }: { url: string | null; label: string }) {
  const [failed, setFailed] = useState(false)
  if (failed || !url) {
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/10 text-[10px] font-semibold text-[color:var(--muted)]">
        {label.replace(/^#/, '').slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={label} width={32} height={32} onError={() => setFailed(true)} className="h-8 w-8 shrink-0 rounded-md object-cover" loading="lazy" />
  )
}

// ── Proposals (governance) ───────────────────────────────────────────────────

/** Governance rows expand into the standard VoteChoiceButtons — the same
 *  EIP-712 build → wallet signature → /api/snapshot/relay path chat uses (the
 *  relay re-guards server-side). Tapping a proposal reveals For / Against /
 *  Abstain right there; no new signing surface, no round-trip through chat. */
function ProposalsBody({ tile }: { tile: ProposalsTile }) {
  const [open, setOpen] = useState<string | null>(null)
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
      <div className="space-y-1">
        {tile.proposals.slice(0, 4).map((p) => {
          const expanded = open === p.id
          return (
            <div key={p.id} className={expanded ? 'rounded-xl border border-[var(--line)] bg-white/[0.02] p-2' : undefined}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : p.id)}
                aria-expanded={expanded}
                className="-mx-1 flex w-full items-start gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-white/5"
              >
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
                <ChevronDown
                  className={`mt-1 h-3.5 w-3.5 flex-shrink-0 text-[color:var(--muted-2)] transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
              </button>
              {expanded && (
                <div className="mt-1 px-1 pb-1">
                  <Reveal>
                    <VoteChoiceButtons
                      proposal={{
                        id: p.id,
                        title: p.title,
                        space: p.spaceId,
                        // Rows cached before `type` shipped default to single-choice
                        // (the encoding Snapshot uses for basic proposals too).
                        type: p.type ?? 'single-choice',
                        choices: p.choices,
                      }}
                    />
                  </Reveal>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

/** Entrance for row-expand content: a short fade + settle. Entrance ONLY —
 *  exit animations get stranded mid-fade when the headless preview (and busy
 *  real tabs) starve rAF, the App Mode ghost-panel lesson. Collapse is
 *  instant unmount; useReducedMotion drops the settle entirely. */
function Reveal({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

/** The chip band revealed under an expanded holding/order row — same
 *  drop-into-composer behaviour as the card's bottom PromptChips, scoped to
 *  the one asset the user tapped. */
function InlineActionChips({
  actions,
  info,
  slug,
  onPick,
}: {
  actions: SuggestedPrompt[]
  /** External detail page for the row — rendered after the action chips as
   *  the ⓘ link chip ("View on OpenSea"), same affordance as the MCP rail. */
  info?: { url: string; label: string } | null
  slug: string
  onPick: (p: string, slug?: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          title={a.prompt}
          onClick={() => onPick(a.prompt, slug)}
          className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[color:var(--muted)] transition-colors hover:border-[var(--line-2)] hover:bg-white/5 hover:text-white"
        >
          {a.label}
        </button>
      ))}
      {info && (
        <a
          href={info.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={info.label}
          className="flex items-center gap-1 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[color:var(--muted-2)] transition-colors hover:border-[var(--line-2)] hover:bg-white/5 hover:text-white"
        >
          <Info className="h-3 w-3" />
          {info.label}
        </a>
      )}
    </div>
  )
}

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
