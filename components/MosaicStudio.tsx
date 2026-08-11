'use client'

// ─────────────────────────────────────────────────────────────────────────
//  The Mosaic studio — editor, mint, and the wall, one client component.
//
//  The editor's one invariant: WHAT YOU SEE IS THE WIRE. The live sentence
//  is mosaicAskString(slices, chain) — the exact string the mint writes —
//  and it's validated by re-parsing with parseMosaicAsk right here, so the
//  problem line a broken shape shows in the studio is the SAME verbatim
//  refusal the API would return (the fail-closed round-trip, made visible
//  before the request instead of after). Token inputs are sanitized to the
//  grammar's own alphabet (alpha 2–12) at the keystroke, because a symbol
//  the slice regex can't match would silently compose a DIFFERENT sentence
//  than the tiles on screen.
//
//  Auth follows rule 6: the mint's 401 renders CreateAccountButton (the
//  unified door) when cdpEnabled, session.connectAndSignIn otherwise —
//  never raw RainbowKit. Reading an allocation needs no auth at all: the
//  read endpoint is the same public exposure class as /w/<address>.
//
//  Tile colors are an 8-step color-mix(in oklch, var(--accent) N%, var(--bg))
//  ramp so both themes come free. Label ink flips between var(--bg) and
//  var(--fg) at the ramp midpoint: a high-accent tile is ~the accent color,
//  and bg-on-accent has exactly the contrast the theme already guarantees
//  for accent-on-bg — no hardcoded hexes, no per-theme branches.
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { Check, Copy, GitFork, Loader2, LogIn, Plus, ScanLine, Wand2, X } from 'lucide-react'
import { useSession } from '@/lib/session'
import { cdpEnabled } from '@/lib/cdp-embedded'
import CreateAccountButton from '@/components/CreateAccountButton'
import { absoluteUrl } from '@/lib/site-url'
import {
  MOSAIC_CHAIN_LABELS,
  MOSAIC_STABLE,
  mosaicAskString,
  parseMosaicAsk,
  type MosaicChainWord,
  type MosaicSlice,
} from '@/lib/mosaic'

// ── Shared bits ─────────────────────────────────────────────────────────────

type ChainChoice = 'auto' | MosaicChainWord

const CHAIN_OPTIONS: { value: ChainChoice; label: string }[] = [
  { value: 'auto', label: 'Auto — each wallet’s dominant chain' },
  { value: 'base', label: 'Base' },
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'arbitrum', label: 'Arbitrum' },
]

/** Accent share per tile index. Descends so the first (usually biggest)
 *  tile reads loudest; ≥55 gets bg-colored ink (see the header comment). */
const TILE_RAMP = [92, 76, 62, 50, 38, 28, 20, 14]
const tileBg = (i: number) => `color-mix(in oklch, var(--accent) ${TILE_RAMP[i % TILE_RAMP.length]}%, var(--bg))`
const tileInk = (i: number) => (TILE_RAMP[i % TILE_RAMP.length] >= 55 ? 'var(--bg)' : 'var(--fg)')

const fmtUsd = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`

/** Coarse mint age — the board's idiom, no live-ticking precision theater. */
function coarseAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Where to land after sign-in: this page, query included (the
 *  ChatSignInGate.hereWithQuery pattern — a hardcoded path would drop the
 *  ?from= fork door on the post-sign-in redirect). */
function hereWithQuery(): string {
  if (typeof window === 'undefined') return '/mosaic'
  return window.location.pathname + window.location.search
}

/** The tile bar — width IS the percent (flex-grow carries it), small tiles
 *  keep a min-width and truncate so a 2% tile stays a legible sliver. */
function TileBar({ slices, size = 'lg' }: { slices: MosaicSlice[]; size?: 'lg' | 'sm' }) {
  if (slices.length === 0) return null
  const h = size === 'lg' ? 40 : 24
  return (
    <div
      className="flex w-full overflow-hidden rounded-lg border border-[var(--line)]"
      style={{ height: h }}
      aria-label={slices.map((s) => `${s.pct}% ${s.token}`).join(', ')}
    >
      {slices.map((s, i) => (
        <div
          key={`${s.token}-${i}`}
          className="flex items-center justify-center overflow-hidden px-1"
          style={{
            flexGrow: Math.max(s.pct, 0.001),
            flexBasis: 0,
            minWidth: size === 'lg' ? 38 : 26,
            background: tileBg(i),
            // Seams between tiles come from the bg itself — a border would
            // shift the widths off the percents.
            boxShadow: i > 0 ? 'inset 1px 0 0 var(--bg)' : undefined,
          }}
          title={`${s.pct}% ${s.token}`}
        >
          <span
            className={`mono truncate ${size === 'lg' ? 'text-[11px]' : 'text-[9.5px]'} font-semibold tabular-nums`}
            style={{ color: tileInk(i) }}
          >
            {s.pct}% {s.token}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Types the API contract hands back ───────────────────────────────────────

interface WallRow {
  slug: string
  ask: string
  slices: MosaicSlice[]
  chainWord: MosaicChainWord | null
  agent: string | null
  createdAt: string
  parentSlug: string | null
  forks: number
  signedUsd: number
  signedCount: number
}

interface ReadResult {
  chain: MosaicChainWord
  totalUsd: number
  slices: MosaicSlice[]
  holdings: { token: string; usd: number }[]
}

interface Minted {
  slug: string
  url: string
  ask: string
  /** OG cache-bust nonce, frozen at mint so the preview doesn't re-fetch
   *  on every render. */
  v: number
}

/** Editor rows keep pct as a STRING — a controlled number input that
 *  round-trips through parseFloat eats the user's "12." mid-keystroke. */
interface EditorRow {
  id: number
  token: string
  pct: string
}

const DEFAULT_ROWS: Omit<EditorRow, 'id'>[] = [
  { token: 'ETH', pct: '50' },
  { token: MOSAIC_STABLE, pct: '30' },
  { token: 'WSTETH', pct: '20' },
]

// ── The studio ──────────────────────────────────────────────────────────────

export default function MosaicStudio({ from }: { from?: string }) {
  const { address, isConnected } = useAccount()
  const { connectAndSignIn, signingIn } = useSession()

  const nextId = useRef(0)
  const mkRow = useCallback((token: string, pct: string): EditorRow => ({ id: nextId.current++, token, pct }), [])
  const [rows, setRows] = useState<EditorRow[]>(() => DEFAULT_ROWS.map((r) => mkRow(r.token, r.pct)))
  const [chain, setChain] = useState<ChainChoice>('auto')
  const [parentSlug, setParentSlug] = useState<string | null>(null)

  const [reading, setReading] = useState(false)
  const [readErr, setReadErr] = useState<string | null>(null)
  const [readInfo, setReadInfo] = useState<ReadResult | null>(null)

  const [minting, setMinting] = useState(false)
  const [mintErr, setMintErr] = useState<string | null>(null)
  const [needAuth, setNeedAuth] = useState(false)
  const [minted, setMinted] = useState<Minted | null>(null)
  const [copied, setCopied] = useState(false)

  const [wall, setWall] = useState<WallRow[] | null>(null)
  const [wallErr, setWallErr] = useState(false)

  const studioRef = useRef<HTMLElement>(null)

  // ── Derived: the wire, live ────────────────────────────────────────────
  // Only rows the grammar can carry compose into the sentence; the sum badge
  // counts EVERY row so a half-typed tile still shows up in the arithmetic.
  const slices: MosaicSlice[] = rows
    .filter((r) => r.token.length >= 2 && parseFloat(r.pct) > 0)
    .map((r) => ({ pct: parseFloat(r.pct), token: r.token.toUpperCase() }))
  const sum = rows.reduce((a, r) => a + (parseFloat(r.pct) || 0), 0)
  const sumOk = Math.abs(sum - 100) <= 0.5
  const chainWord = chain === 'auto' ? undefined : chain
  const ask = slices.length > 0 ? mosaicAskString(slices, chainWord) : null
  const parsed = ask ? parseMosaicAsk(ask) : null
  const problem = parsed && 'problem' in parsed ? parsed.problem : null
  const mintable = ask != null && parsed != null && !('problem' in parsed)

  // ── Editor ops ─────────────────────────────────────────────────────────
  const setToken = (id: number, v: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, token: v.replace(/[^A-Za-z]/g, '').slice(0, 12).toUpperCase() } : r)))
  const setPct = (id: number, v: string) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, pct: v } : r)))
  const removeRow = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id))
  const addRow = () => setRows((rs) => (rs.length >= 8 ? rs : [...rs, mkRow('', '')]))

  /** "Make it 100": scale every non-zero tile proportionally, integers via
   *  largest remainder — the exec-shell's own rounding discipline, so the
   *  normalized shape sums to exactly 100 and every surviving tile keeps
   *  at least its 1% floor. */
  const normalize = () => {
    const live = rows.filter((r) => (parseFloat(r.pct) || 0) > 0)
    const total = live.reduce((a, r) => a + parseFloat(r.pct), 0)
    if (total <= 0) return
    const exact = live.map((r) => (parseFloat(r.pct) / total) * 100)
    const floors = exact.map((n) => Math.floor(n))
    let left = 100 - floors.reduce((a, n) => a + n, 0)
    const order = exact
      .map((n, i) => ({ i, frac: n - Math.floor(n) }))
      .sort((a, b) => b.frac - a.frac)
    for (const { i } of order) {
      if (left <= 0) break
      floors[i] += 1
      left -= 1
    }
    const pctById = new Map(live.map((r, i) => [r.id, Math.max(1, floors[i])]))
    setRows((rs) => rs.filter((r) => pctById.has(r.id)).map((r) => ({ ...r, pct: String(pctById.get(r.id)) })))
  }

  const loadShape = useCallback(
    (s: MosaicSlice[], cw: MosaicChainWord | null | undefined) => {
      setRows(s.map((x) => mkRow(x.token, String(x.pct))))
      setChain(cw ?? 'auto')
      setMinted(null)
      setMintErr(null)
      setNeedAuth(false)
    },
    [mkRow],
  )

  const forkRow = (row: WallRow) => {
    loadShape(row.slices, row.chainWord)
    setParentSlug(row.slug)
    setReadInfo(null)
    studioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ── Read my allocation ─────────────────────────────────────────────────
  const readAllocation = async () => {
    if (!address) return
    setReading(true)
    setReadErr(null)
    try {
      const res = await fetch(`/api/mosaics/read?address=${address}`)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.slices) {
        setReadErr(json?.error ?? 'The portfolio read is unavailable right now — try again in a minute.')
        return
      }
      const info = json as ReadResult
      loadShape(info.slices, info.chain)
      setParentSlug(null)
      setReadInfo(info)
    } catch {
      setReadErr('The portfolio read is unavailable right now — try again in a minute.')
    } finally {
      setReading(false)
    }
  }

  // ── Mint ───────────────────────────────────────────────────────────────
  const mint = async () => {
    if (!mintable || minting) return
    setMinting(true)
    setMintErr(null)
    setNeedAuth(false)
    try {
      const res = await fetch('/api/mosaics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slices,
          ...(chainWord ? { chain: chainWord } : {}),
          ...(parentSlug ? { parentSlug } : {}),
        }),
      })
      if (res.status === 401) {
        setNeedAuth(true)
        return
      }
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.slug) {
        setMintErr(json?.error ?? `Mint failed (${res.status}) — nothing was created.`)
        return
      }
      setMinted({ slug: json.slug, url: json.url, ask: json.ask, v: Date.now() })
      void loadWall()
    } catch {
      setMintErr('Mint failed — the request never landed. Nothing was created.')
    } finally {
      setMinting(false)
    }
  }

  const copyUrl = (m: Minted) => {
    void navigator.clipboard.writeText(absoluteUrl(m.url)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  // ── The wall ───────────────────────────────────────────────────────────
  const loadWall = useCallback(async () => {
    try {
      const res = await fetch('/api/mosaics')
      const json = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(json?.rows)) {
        setWallErr(true)
        return
      }
      setWall(json.rows as WallRow[])
      setWallErr(false)
    } catch {
      setWallErr(true)
    }
  }, [])

  useEffect(() => {
    void loadWall()
  }, [loadWall])

  // ?from=<slug> — the fork door. One fetch for the single row so the
  // prefill carries the CURRENT stored ask, not whatever the sharer's tab
  // remembered.
  useEffect(() => {
    if (!from) return
    let stale = false
    void (async () => {
      try {
        const res = await fetch(`/api/mosaics?slug=${encodeURIComponent(from)}`)
        const json = await res.json().catch(() => null)
        const row = Array.isArray(json?.rows) ? (json.rows[0] as WallRow | undefined) : undefined
        if (stale || !row) return
        loadShape(row.slices, row.chainWord)
        setParentSlug(row.slug)
      } catch {
        /* a dead fork door just leaves the default shape — nothing to say */
      }
    })()
    return () => {
      stale = true
    }
  }, [from, loadShape])

  // ── Render ─────────────────────────────────────────────────────────────
  const sumBadge = (
    <span
      className={`mono text-[11px] tabular-nums px-2 py-0.5 rounded-full border ${
        sumOk ? 'border-emerald-400/40 text-emerald-400' : 'border-amber-400/40 text-amber-400'
      }`}
      style={{ background: 'var(--surf-1)' }}
    >
      Σ {Math.round(sum * 100) / 100}%
    </span>
  )

  const signInDoor = cdpEnabled ? (
    <CreateAccountButton
      className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--accent)] text-black text-sm font-semibold hover:opacity-90 transition-opacity"
      label={
        <>
          <LogIn className="w-4 h-4" strokeWidth={2.5} />
          <span>Sign in to mint</span>
        </>
      }
      redirectTo={hereWithQuery()}
    />
  ) : (
    <button
      onClick={() => connectAndSignIn(hereWithQuery())}
      disabled={signingIn}
      type="button"
      title="Connect a wallet and sign in — one step"
      className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--accent)] text-black text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
    >
      {signingIn ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} /> : <LogIn className="w-4 h-4" strokeWidth={2.5} />}
      <span>{signingIn ? 'Signing in…' : 'Sign in to mint'}</span>
    </button>
  )

  return (
    <div className="space-y-12 pb-16">
      {/* ── THE STUDIO ──────────────────────────────────────────────────── */}
      <section ref={studioRef} style={{ scrollMarginTop: 96 }}>
        <div className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
          <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">The studio</h2>
          {isConnected && address && (
            <button
              type="button"
              onClick={() => void readAllocation()}
              disabled={reading}
              title="Read your wallet's current allocation as a starting shape"
              className="inline-flex items-center gap-1.5 mono text-[11px] text-[color:var(--accent)] hover:underline underline-offset-2 disabled:opacity-50"
            >
              {reading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
              {reading ? 'Reading…' : 'Read my allocation'}
            </button>
          )}
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-4 sm:px-5 sm:py-5 space-y-4">
          {readErr && <p className="text-[12px] text-amber-400">{readErr}</p>}
          {readInfo && (
            <div className="text-[12px] text-[color:var(--muted)]">
              <p>
                Read {fmtUsd(readInfo.totalUsd)} on {MOSAIC_CHAIN_LABELS[readInfo.chain]} — tokens under 3% folded
                into the {MOSAIC_STABLE} tile.
              </p>
              {readInfo.holdings.length > 0 && (
                <p className="mono text-[10.5px] text-[color:var(--muted-2)] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {readInfo.holdings.map((h) => (
                    <span key={h.token} className="tabular-nums">
                      {h.token} {fmtUsd(h.usd)}
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}

          {parentSlug && (
            <p className="flex items-center gap-2 text-[12px] text-[color:var(--muted)]">
              <GitFork className="w-3.5 h-3.5 text-[color:var(--accent)]" />
              <span>
                Forking{' '}
                <a href={`/i/${parentSlug}`} className="mono text-[color:var(--accent)] hover:underline">
                  /i/{parentSlug}
                </a>{' '}
                — lineage rides the mint.
              </span>
              <button
                type="button"
                onClick={() => setParentSlug(null)}
                aria-label="Drop the fork lineage"
                className="text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </p>
          )}

          {/* Editor rows */}
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <input
                  value={r.token}
                  onChange={(e) => setToken(r.id, e.target.value)}
                  placeholder="TOKEN"
                  aria-label="Token symbol"
                  className="mono w-32 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-[13px] text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
                />
                <input
                  value={r.pct}
                  onChange={(e) => setPct(r.id, e.target.value)}
                  type="number"
                  min={1}
                  max={100}
                  step="any"
                  placeholder="%"
                  aria-label="Percent"
                  className="mono w-20 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-[13px] text-[color:var(--fg)] tabular-nums focus:outline-none focus:border-[var(--accent)]"
                />
                <span className="mono text-[12px] text-[color:var(--muted-2)]">%</span>
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  aria-label={`Remove the ${r.token || 'empty'} tile`}
                  className="w-7 h-7 grid place-items-center rounded-lg text-[color:var(--muted-2)] hover:text-[color:var(--fg)] hover:bg-[var(--surf-2)] transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={addRow}
              disabled={rows.length >= 8}
              title={rows.length >= 8 ? 'A shape keeps to 8 tiles so the batch stays signable' : 'Add a tile'}
              className="inline-flex items-center gap-1.5 mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] disabled:opacity-40 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> add a tile
            </button>
            {sumBadge}
            {!sumOk && sum > 0 && (
              <button
                type="button"
                onClick={normalize}
                title="Scale every tile proportionally to sum exactly 100"
                className="inline-flex items-center gap-1.5 mono text-[12px] text-[color:var(--accent)] hover:underline underline-offset-2"
              >
                <Wand2 className="w-3.5 h-3.5" /> make it 100
              </button>
            )}
            <label className="ml-auto inline-flex items-center gap-2 mono text-[12px] text-[color:var(--muted)]">
              chain
              <select
                value={chain}
                onChange={(e) => setChain(e.target.value as ChainChoice)}
                className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
              >
                {CHAIN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* The wire, live: the tile bar and the exact sentence the mint writes. */}
          {slices.length > 0 && <TileBar slices={slices} />}
          <div>
            <p className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)] mb-1">
              The sentence — this IS the link
            </p>
            {ask ? (
              <p
                className="text-[15px] text-[color:var(--fg)]"
                style={{ fontFamily: 'var(--font-chat-display)', letterSpacing: '-0.01em' }}
              >
                &ldquo;{ask}&rdquo;
              </p>
            ) : (
              <p className="text-[13px] text-[color:var(--muted-2)]">Name at least two tiles to shape a mosaic.</p>
            )}
            {problem && <p className="mt-1.5 text-[12px] text-amber-400">{problem}</p>}
          </div>

          {/* ── MINT ─────────────────────────────────────────────────────── */}
          {minted ? (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] px-4 py-4 space-y-3">
              <p className="text-[13px] text-[color:var(--muted)]">
                Minted. Anyone who opens it gets this shape compiled against their OWN wallet:
              </p>
              <button
                type="button"
                onClick={() => copyUrl(minted)}
                title="Copy the link"
                className="inline-flex items-center gap-1.5 mono text-[13px] text-[color:var(--accent)] hover:underline break-all text-left"
              >
                {copied ? <Check className="w-3.5 h-3.5 flex-shrink-0" /> : <Copy className="w-3.5 h-3.5 flex-shrink-0" />}
                {absoluteUrl(minted.url)}
              </button>
              {/* The REAL OG route is the preview — what the feed will show
                  is what you look at, not a mock (the #568 live-card rule). */}
              <div className="rounded-lg border border-[var(--line)] overflow-hidden max-w-[420px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/i/${minted.slug}/opengraph-image?v=${minted.v}`}
                  alt={`The share card for ${minted.ask}`}
                  className="w-full block"
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`“${minted.ask}” — open it and your wallet gets its own version. One signature chain.`)}&url=${encodeURIComponent(absoluteUrl(minted.url))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] underline"
                >
                  post it
                </a>
                <a href={minted.url} className="mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] underline">
                  open it
                </a>
                <button
                  type="button"
                  onClick={() => setMinted(null)}
                  className="mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] underline"
                >
                  edit &amp; mint another
                </button>
              </div>
            </div>
          ) : needAuth ? (
            <div className="flex flex-wrap items-center gap-3">
              {signInDoor}
              <p className="text-[12px] text-[color:var(--muted)]">
                Minting needs an account — the link is yours, and conversions credit your address.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void mint()}
                disabled={!mintable || minting}
                className="btn btn--solid text-[14px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {minting ? 'Minting…' : parentSlug ? 'Mint the fork' : 'Mint this shape as a link'}
              </button>
              {mintErr && <p className="text-[12px] text-amber-400">{mintErr}</p>}
            </div>
          )}
        </div>

        <p className="mono text-[11px] text-[color:var(--muted-2)] mt-3">
          A shape, not a promise — every leg is built and guard-checked at sign time; nothing here is
          financial advice.
        </p>
      </section>

      {/* ── THE WALL ────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
          <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">The wall</h2>
          <Link
            href="/links"
            className="mono text-[11px] text-[color:var(--accent)] hover:underline underline-offset-2"
          >
            All intent links →
          </Link>
        </div>

        {wall == null && !wallErr && (
          <p className="mono text-[12px] text-[color:var(--muted-2)]">Loading the wall…</p>
        )}
        {wallErr && (
          <p className="mono text-[12px] text-[color:var(--muted-2)]">
            The wall is unreachable right now — the studio above still works.
          </p>
        )}
        {wall != null && wall.length === 0 && (
          <p className="mono text-[12px] text-[color:var(--muted-2)]">
            No mosaics on the wall yet — mint the first shape.
          </p>
        )}

        {wall != null && wall.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {wall.map((row) => (
              <div key={row.slug} className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-3.5 space-y-2.5">
                <TileBar slices={row.slices} size="sm" />
                <p className="text-[13px] text-[color:var(--fg)] leading-snug">&ldquo;{row.ask}&rdquo;</p>
                <p className="mono text-[10.5px] text-[color:var(--muted-2)] tabular-nums flex flex-wrap gap-x-2 gap-y-0.5">
                  {row.signedUsd > 0 && <span className="text-[color:var(--accent)]">{fmtUsd(row.signedUsd)} moved</span>}
                  <span>
                    {row.signedCount} sign{row.signedCount === 1 ? '' : 's'}
                  </span>
                  <span>·</span>
                  <span>
                    {row.forks} fork{row.forks === 1 ? '' : 's'}
                  </span>
                  {row.chainWord && (
                    <>
                      <span>·</span>
                      <span>{MOSAIC_CHAIN_LABELS[row.chainWord]}</span>
                    </>
                  )}
                  {row.parentSlug && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <GitFork className="w-3 h-3" /> of /i/{row.parentSlug}
                      </span>
                    </>
                  )}
                  {row.agent && (
                    <>
                      <span>·</span>
                      <span>via {row.agent}</span>
                    </>
                  )}
                  {coarseAge(row.createdAt) && (
                    <>
                      <span>·</span>
                      <span>{coarseAge(row.createdAt)}</span>
                    </>
                  )}
                </p>
                <div className="flex items-center gap-4">
                  <a
                    href={`/i/${row.slug}`}
                    className="mono text-[12px] text-[color:var(--accent)] hover:underline underline-offset-2"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => forkRow(row)}
                    title="Load this shape into the studio — the mint carries its lineage"
                    className="inline-flex items-center gap-1.5 mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
                  >
                    <GitFork className="w-3.5 h-3.5" /> Fork this shape
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
