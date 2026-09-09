'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Clock, ExternalLink, Info, RefreshCw, Repeat, Vote, Wallet } from 'lucide-react'
import BrandIcon from '@/components/BrandIcon'
import TokenIcon from '@/components/TokenIcon'
import { ChartChip, ChartHoverButton } from '@/components/TokenChartButton'
import VoteChoiceButtons from '@/components/VoteChoiceButtons'
import { useYeetfulStore, type McpServer } from '@/lib/store'
import { cleanServerName } from '@/lib/utils'
import { chainById } from '@/lib/chains'
import ChatLoader from '@/components/ChatLoader'
import { splashCapable } from '@/lib/splash/types'
import type { ActivityTile, ErrorTile, HoldingsTile, MoneyMap, NftsTile, ProposalsTile, RowsTile, SplashTile, SuggestedPrompt } from '@/lib/splash/types'
import { planLayout } from '@/lib/splash/layout'
import { SplashHero } from '@/components/splash/Hero'
import { Delta24, Sparkline } from '@/components/splash/Sparkline'
import { RowProgress, TileVizBlock } from '@/components/splash/viz'

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
  // The wallet-level money map from the last FULL scan (delta scans leave it;
  // card facts fold in at render time, so a toggled-off MCP's money leaves
  // the bar the moment its card does).
  const [map, setMap] = useState<MoneyMap | null>(null)
  const [loading, setLoading] = useState(false)
  // MCPs toggled onto an ALREADY-painted grid whose scan is still in flight —
  // each renders a branded skeleton card in the slot where its real card will
  // land. The existing cards never leave the screen for a delta scan.
  const [pending, setPending] = useState<McpServer[]>([])
  // Bumped by a tile's Retry button to force a fresh full scan.
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

  // What the settled tiles actually cover: the wallet|chain surface plus each
  // server's manual status at fetch time. A set change diffs against this —
  // a server toggled OFF loses its tiles instantly (no fetch: the remaining
  // cards are still true), a server toggled ON fetches JUST its own tiles
  // (`serversOnly` skips the wallet briefing already on screen) and merges in
  // behind a placeholder card. Only a wallet/chain change — or Retry —
  // invalidates everything and takes the full-scan loader.
  const coveredRef = useRef<{ base: string; byId: Map<string, { slug: string; manual: boolean }> } | null>(null)
  // State mirror so the diff effect can read the current tiles without
  // depending on them (a tiles dep would re-run the effect on every merge).
  const tilesRef = useRef<SplashTile[] | null>(null)
  const commitTiles = (next: SplashTile[] | null) => {
    tilesRef.current = next
    setTiles(next)
  }
  const lastReloadRef = useRef(reload)

  useEffect(() => {
    if (!address || relevant.length === 0) {
      coveredRef.current = null
      commitTiles(null)
      setPending([])
      return
    }
    let alive = true
    const base = `${address}|${chainKey}`
    const covered = coveredRef.current
    const forceFull = reload !== lastReloadRef.current
    lastReloadRef.current = reload

    if (forceFull || !covered || covered.base !== base) {
      // Full scan: first paint, a different wallet, the chain picker, or an
      // error tile's Retry. Everything on screen is stale here, so the
      // clear-and-loader treatment is honest.
      setLoading(true)
      commitTiles(null)
      setPending([])
      const scanned = relevant.map((s) => ({ id: s.id, slug: s.slug }))
      fetch('/api/splash', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, servers: relevant, manualSlugs: relevantManual, ...(chainKey ? { chain: chainKey } : {}) }),
      })
        .then((r) => r.json())
        .then((data: { tiles?: SplashTile[]; map?: MoneyMap | null }) => {
          if (!alive) return
          const next = Array.isArray(data.tiles) ? data.tiles : []
          setMap(data.map && typeof data.map === 'object' ? data.map : null)
          coveredRef.current = {
            base,
            byId: new Map(scanned.map((s) => [s.id, { slug: s.slug, manual: relevantManual.includes(s.slug) }])),
          }
          commitTiles(next)
          onResolve?.(next.length)
        })
        .catch(() => {
          if (!alive) return
          // Transport failure: settle empty but leave `covered` unset, so the
          // next set change retries the whole scan instead of merging deltas
          // into a grid that never painted.
          commitTiles([])
          onResolve?.(0)
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
      return () => {
        alive = false
      }
    }

    // Same wallet + chain — only the SET changed. Removals are local and
    // instant: drop the toggled-off MCPs' tiles, keep everything else put.
    const relevantIds = new Set(relevant.map((s) => s.id))
    const removedSlugs = new Set<string>()
    for (const [id, v] of covered.byId) {
      if (!relevantIds.has(id)) {
        removedSlugs.add(v.slug)
        covered.byId.delete(id)
      }
    }
    if (removedSlugs.size > 0) {
      const next = (tilesRef.current ?? []).filter((t) => !removedSlugs.has(t.mcpSlug))
      commitTiles(next)
      onResolve?.(next.length)
    }
    // Additions — and manual-status flips, which change whether a quiet
    // wallet still earns a preview card — fetch just their own tiles.
    const fresh = relevant.filter((s) => {
      const had = covered.byId.get(s.id)
      return !had || had.manual !== relevantManual.includes(s.slug)
    })
    if (fresh.length === 0) {
      setPending((prev) => (prev.length ? [] : prev))
      return
    }
    setPending(fresh)
    // Provisional count while the placeholder is up: a delta add is a
    // hand-toggle (always earns at least a preview card), and reporting it
    // now keeps the caller's settled-empty state from sharing the screen
    // with the skeleton. The settle below re-reports the real number.
    onResolve?.((tilesRef.current?.length ?? 0) + fresh.length)
    fetch('/api/splash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        address,
        servers: fresh,
        manualSlugs: relevantManual.filter((slug) => fresh.some((s) => s.slug === slug)),
        serversOnly: true,
        ...(chainKey ? { chain: chainKey } : {}),
      }),
    })
      .then((r) => r.json())
      .then((data: { tiles?: SplashTile[] }) => {
        if (!alive) return
        const freshSlugs = new Set(fresh.map((s) => s.slug))
        // Belt on the serversOnly contract: only the asked-for MCPs' tiles
        // merge, so wallet-level tiles can never duplicate.
        const add = (Array.isArray(data.tiles) ? data.tiles : []).filter((t) => freshSlugs.has(t.mcpSlug))
        const next = [...(tilesRef.current ?? []).filter((t) => !freshSlugs.has(t.mcpSlug)), ...add]
        for (const s of fresh) covered.byId.set(s.id, { slug: s.slug, manual: relevantManual.includes(s.slug) })
        commitTiles(next)
        onResolve?.(next.length)
        setPending([])
      })
      .catch(() => {
        // The added MCP's scan failed in transport: keep the cards we have,
        // drop the placeholder. `covered` is untouched, so the next toggle
        // retries it.
        if (!alive) return
        setPending([])
        onResolve?.(tilesRef.current?.length ?? 0)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload])

  // Nothing to show — let the caller render its normal empty state.
  if (!address || relevant.length === 0) return null
  if (!loading && tiles && tiles.length === 0 && pending.length === 0) return null

  const layout = tiles ? planLayout(tiles, { hero: chrome }) : null

  return (
    <div className="w-full">
      <div className={`mx-auto w-full max-w-[1600px] px-1 md:px-4 ${chrome ? 'py-6' : 'py-2'}`}>
        {loading || !tiles || !layout ? (
          <>
            {chrome && (
              <div className="mb-4 flex items-center gap-2">
                <Wallet className="h-4 w-4 text-[color:var(--muted-2)]" />
                <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
                  Connected · {shortAddr(address)} · reading
                </span>
              </div>
            )}
            <ChatLoader inline />
          </>
        ) : (
          <>
            {/* The hero: the briefing + the money map, on the boot batch
                only. A mid-conversation batch (an MCP added later) has no
                wallet-level story to retell — its briefing, if the scan
                returned one, rides as a plain card. */}
            {chrome ? (
              layout.hero || map ? (
                <SplashHero address={address} briefing={(layout.hero as RowsTile | null) ?? null} map={map} tiles={tiles} onPick={onPick} />
              ) : (
                <div className="mb-4 flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-[color:var(--muted-2)]" />
                  <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
                    Connected · {shortAddr(address)}
                  </span>
                </div>
              )
            ) : null}
            {/* The board: three equal columns (two on tablets, one on phones),
                every card at its natural height, packed as masonry so the
                column edges line up all the way down (lib/splash/layout.ts). */}
            {(layout.cards.length > 0 || pending.length > 0) && (
              <div
                className={`grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 ${chrome && (layout.hero || map) ? 'mt-4' : ''}`}
                style={{ gridAutoRows: `${MASONRY_UNIT}px`, gridAutoFlow: 'dense' }}
                data-splash-grid
              >
                {layout.cards.map((c) => (
                  <MasonryCell key={c.group[0].mcpSlug}>
                    <TileCard tiles={c.group} onPick={onPick} onRetry={() => setReload((n) => n + 1)} />
                  </MasonryCell>
                ))}
                {/* A just-toggled MCP loads IN PLACE: its branded skeleton takes
                    a grid slot, and the settled cards around it never flinch. */}
                {pending
                  .filter((s) => !tiles.some((t) => t.mcpSlug === s.slug))
                  .map((s) => (
                    <MasonryCell key={s.id}>
                      <PendingTileCard server={s} />
                    </MasonryCell>
                  ))}
              </div>
            )}
          </>
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

// ── Masonry ──────────────────────────────────────────────────────────────────
// The grid's rows are 8px tracks; each cell measures its card and claims
// exactly that many tracks, and `grid-auto-flow: dense` drops each next card
// into the first open slot — with equal columns that is the shortest column,
// so the board packs like a pinboard: aligned edges, no voids, natural
// heights. Measured in a layout effect (before paint) and re-measured on
// every resize of the card (a row expanding to act).
const MASONRY_UNIT = 8
const MASONRY_GAP = 16 // gap-4

function MasonryCell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const measure = () => {
      const h = el.getBoundingClientRect().height
      if (!h) return
      setRows(Math.max(1, Math.ceil((h + MASONRY_GAP) / (MASONRY_UNIT + MASONRY_GAP))))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      className="min-w-0 self-start"
      style={rows ? { gridRowEnd: `span ${rows}` } : undefined}
      data-rows={rows ?? undefined}
    >
      {children}
    </div>
  )
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
        // Wraps at narrow widths: the title never breaks word-per-line and a
        // long subtitle drops to its own line instead of overflowing the card
        // (375px drill — "WHAT / PANTESSA / NOTICED" beside a clipped hint).
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          {tile.title && tile.title !== tile.mcpName ? (
            <p className="mono whitespace-nowrap text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">{tile.title}</p>
          ) : (
            <span />
          )}
          {tile.subtitle && <span className="mono min-w-0 text-[10px] text-[color:var(--muted-2)]">{tile.subtitle}</span>}
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
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4 text-left transition-colors hover:border-[var(--line-2)]" data-splash-card={head.mcpSlug}>
      {/* Hairline sheen along the top edge — the site's accent language. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link
          href={`/servers/${head.mcpSlug}`}
          className="group/head flex min-w-0 items-center gap-2"
          title={`Open ${cleanServerName(head.mcpName)}'s server page`}
        >
          <BrandIcon server={iconServer} size={20} />
          <h3 className="truncate text-sm font-semibold text-white underline-offset-4 group-hover/head:underline">
            {cleanServerName(head.mcpName)}
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

/** The in-place loading card for an MCP just toggled onto a painted grid:
 *  same card shell as TileCard, the MCP's real logo + name in the header, a
 *  pulsing body where its data will land. The rest of the grid stays put —
 *  adding an MCP never sends the whole splash back to the loader. */
function PendingTileCard({ server }: { server: McpServer }) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4 text-left">
      <div aria-hidden className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      <div className="mb-3 flex items-center gap-2">
        <BrandIcon server={server} size={20} />
        <h3 className="truncate text-sm font-semibold text-white">{cleanServerName(server.name)}</h3>
      </div>
      <div aria-hidden className="space-y-2">
        <div className="h-7 w-32 animate-pulse rounded bg-white/10" />
        <div className="h-4 w-full animate-pulse rounded bg-white/5" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-white/5" />
      </div>
      <p className="mt-auto pt-4 text-[10px] text-[color:var(--muted-2)]">Scanning your wallet…</p>
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
  chart,
  slug,
  onPick,
  expanded,
  onToggle,
}: {
  left: ReactNode
  right?: ReactNode
  actions: SuggestedPrompt[]
  info: { url: string; label: string } | null
  /** Token symbol behind the row — the uniform chart button (ⓘ contract:
   *  hover icon on display-only rows, chip in the action band otherwise).
   *  Unresolvable symbols render nothing. */
  chart?: string | null
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
        {!expandable && chart && <ChartHoverButton symbol={chart} />}
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
            <InlineActionChips actions={actions} info={info} chart={chart} slug={slug} onPick={onPick} />
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
      {tile.viz && (
        <div className="mb-3">
          <TileVizBlock viz={tile.viz} />
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
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate max-lg:whitespace-normal font-medium text-white">{r.label}</div>
                  {r.sub && <div className="text-[10px] text-[color:var(--muted-2)]">{r.sub}</div>}
                  {typeof r.progressPct === 'number' && <RowProgress pct={r.progressPct} />}
                </div>
              }
              right={value}
              actions={r.actions ?? []}
              info={rowInfo(r)}
              chart={r.chartSymbol}
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
      {tile.viz && (
        <div className="mb-3">
          <TileVizBlock viz={tile.viz} chain={tile.chain} />
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
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {/* The row's own chain when the tile is multichain, else
                      the tile's — a company mark is only right on 4663. */}
                  <TokenIcon symbol={h.symbol} size={24} chain={h.chain ?? tile.chain} />
                  <span className="font-medium text-white">{h.symbol}</span>
                  {h.native && <span className="mono text-[9px] text-[color:var(--muted-2)]">native</span>}
                  {h.chain && (
                    <span className="min-w-0 truncate whitespace-nowrap rounded bg-white/5 px-1 py-0.5 text-[9px] text-[color:var(--muted-2)]">{h.chain}</span>
                  )}
                </div>
              }
              right={
                <div className="flex items-center gap-2">
                  <Sparkline symbol={h.symbol} width={56} height={20} className="hidden sm:block" />
                  <div className="text-right">
                    <div className="flex items-baseline justify-end gap-1.5 text-white">
                      <Delta24 symbol={h.symbol} />
                      <span>{h.valueUsd !== null ? usd(h.valueUsd) : '—'}</span>
                    </div>
                    <div className="text-[10px] text-[color:var(--muted-2)]">{trimNum(h.balance)}</div>
                  </div>
                </div>
              }
              actions={h.actions ?? []}
              info={rowInfo(h)}
              chart={h.symbol}
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
  const idOf = (n: NftsTile['nfts'][number]) => `${n.chain}${n.contract}${n.tokenId}`
  const selected = tile.nfts.find((n) => idOf(n) === open) ?? null
  return (
    <div className="flex-1" data-splash-viz="gallery">
      {/* The gallery IS the chart here: the pictures, not rows about them.
          Tap one to select it; its Sell / Transfer chips land beneath. */}
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-4 2xl:grid-cols-6">
        {tile.nfts.slice(0, 12).map((n) => {
          const id = idOf(n)
          const active = open === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setOpen(active ? null : id)}
              aria-pressed={active}
              title={`${n.name} · ${n.collectionName}${n.floor ? ` · ${n.floor}` : ''}`}
              className="group relative aspect-square overflow-hidden rounded-lg bg-white/5 transition-transform focus-visible:outline-none"
              style={active ? { boxShadow: '0 0 0 2px var(--accent)' } : undefined}
            >
              <NftThumb url={n.imageUrl} label={n.name} fill />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-left text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                {n.name}
              </span>
            </button>
          )
        })}
      </div>
      {selected ? (
        <div className="mt-3 rounded-xl border border-[var(--line)] bg-white/[0.02] p-2.5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium text-white">{selected.name}</span>
            <span className="shrink-0 text-[10px] text-[color:var(--muted)]">
              {selected.floor ?? selected.collectionName} · {selected.chain}
            </span>
          </div>
          <div className="mt-2">
            <InlineActionChips actions={selected.actions ?? []} info={rowInfo(selected)} slug={tile.mcpSlug} onPick={onPick} />
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-[color:var(--muted-2)]">Tap one to sell or transfer it.</p>
      )}
    </div>
  )
}

/** Square NFT thumbnail with a lettermark fallback (the Avatar's gallery twin). */
function NftThumb({ url, label, fill = false }: { url: string | null; label: string; fill?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (failed || !url) {
    return (
      <span
        className={`grid shrink-0 place-items-center bg-white/10 font-semibold text-[color:var(--muted)] ${fill ? 'h-full w-full text-lg' : 'h-8 w-8 rounded-md text-[10px]'}`}
      >
        {label.replace(/^#/, '').slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={label}
      width={fill ? undefined : 32}
      height={fill ? undefined : 32}
      onError={() => setFailed(true)}
      className={fill ? 'h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]' : 'h-8 w-8 shrink-0 rounded-md object-cover'}
      loading="lazy"
    />
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
                    {p.leadingChoice && (
                      <span className="text-[color:var(--accent)]">
                        {p.leadingChoice} leading{typeof p.leadingPct === 'number' ? ` · ${p.leadingPct}%` : ''}
                      </span>
                    )}
                  </div>
                  {typeof p.leadingPct === 'number' && <RowProgress pct={p.leadingPct} />}
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
  chart,
  slug,
  onPick,
}: {
  actions: SuggestedPrompt[]
  /** External detail page for the row — rendered after the action chips as
   *  the ⓘ link chip ("View on OpenSea"), same affordance as the MCP rail. */
  info?: { url: string; label: string } | null
  /** Token symbol behind the row — the uniform chart chip rides after the
   *  action chips, before the ⓘ link. */
  chart?: string | null
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
      {chart && <ChartChip symbol={chart} />}
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
