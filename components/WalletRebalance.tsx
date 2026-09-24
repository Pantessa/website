'use client'

// "Rebalance for me" — the Mosaic editor inside the wallet window.
//
// Nate, 2026-09-14: "In the wallet should we offer a rebalance for me option
// where it shows the mosaic interface, maybe we offer a choose for me."
//
// The wallet window already holds every priced row per chain, so the shape
// starts from what the wallet HOLDS (suggestMosaicShape — the same rules the
// studio's "Read my allocation" uses) with no extra read. "Choose for me" is
// a deterministic tidy-up (chooseMosaicShape: 5% steps, ≥10% dry powder,
// no tile above 70%), never a model picking a portfolio; the rules print
// beside the result. What you see is the wire: the sentence under the tiles
// is mosaicAskString(slices, chain), re-parsed live, and the preview under
// it is planMosaic over the wallet's own rows — the sells and buys the
// batch will carry, priced as of this read. Pressing Rebalance SENDS that
// sentence (the chip-send contract); the mosaic gate re-reads the wallet,
// plans again fresh, and every leg is built and guard-checked at its sign
// step. A shape, not a promise.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, Plus, Wand2, X } from 'lucide-react'
import TileBar from '@/components/MosaicTileBar'
import {
  chooseMosaicShape,
  composeMosaicAsk,
  MOSAIC_CHAIN_IDS,
  MOSAIC_CHAIN_LABELS,
  mosaicPresets,
  mosaicStableFor,
  mosaicValueRows,
  planMosaic,
  suggestMosaicShape,
  type MosaicChainWord,
  type MosaicHolding,
  type MosaicSlice,
} from '@/lib/mosaic'
import type { WalletChainView, WalletView } from '@/lib/wallet-view'
import { cn } from '@/lib/utils'

export type RebalancePick = 'hand' | 'chosen' | 'preset'

interface EditorRow {
  id: number
  token: string
  pct: string
}

/** A shape needs this much movable value in its own tiles (lib/mosaic's
 *  planner floor) — chains under it are listed but can't be tiled. */
const MIN_TILE_USD = 10

const MOSAIC_WORDS = Object.keys(MOSAIC_CHAIN_IDS) as MosaicChainWord[]

const fmtUsd = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`)
const fmtSigned = (n: number) => `${n >= 0 ? '+' : '−'}${fmtUsd(Math.abs(n))}`

/** The chain's rows as the pure planner wants them. */
function holdingsOf(chain: WalletChainView): MosaicHolding[] {
  return chain.holdings.map((h) => ({
    symbol: h.symbol.toUpperCase(),
    balance: Number(h.balance) || 0,
    priceUsd: h.priceUsd,
    valueUsd: h.valueUsd,
    native: h.native,
  }))
}

/** Value the shape can actually move on a chain: its priced rows. */
function tileValueOf(chain: WalletChainView): number {
  return chain.holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0)
}

export default function WalletRebalance({
  view,
  onRun,
  onBack,
}: {
  view: WalletView
  /** The shape's sentence, ready to send. */
  onRun: (ask: string, picked: RebalancePick, chain: MosaicChainWord) => void
  onBack: () => void
}) {
  // The wallet's chains that Mosaic tiles, in registry order, with what
  // each holds. Optimism is a wallet chain but not (yet) a Mosaic chain —
  // said out loud below when money sits there.
  const chains = useMemo(
    () =>
      MOSAIC_WORDS.map((word) => {
        const chain = view.chains.find((c) => c.id === MOSAIC_CHAIN_IDS[word])
        return chain ? { word, chain, usd: tileValueOf(chain) } : null
      }).filter((x): x is { word: MosaicChainWord; chain: WalletChainView; usd: number } => x !== null),
    [view],
  )
  const richest = chains.reduce((best, c) => (c.usd > (best?.usd ?? 0) ? c : best), chains[0] ?? null)
  const [word, setWord] = useState<MosaicChainWord>(richest?.word ?? 'base')
  const picked = chains.find((c) => c.word === word) ?? null
  const stable = mosaicStableFor(word)
  const elsewhere = view.chains.filter((c) => !MOSAIC_WORDS.some((w) => MOSAIC_CHAIN_IDS[w] === c.id) && tileValueOf(c) >= 1)

  const rows = useMemo(() => (picked ? mosaicValueRows(picked.chain.holdings) : []), [picked])
  const held = useMemo(() => suggestMosaicShape(rows, word), [rows, word])
  const presets = mosaicPresets(word)

  const nextId = useRef(0)
  const mkRow = useCallback((token: string, pct: string): EditorRow => ({ id: nextId.current++, token, pct }), [])
  const [editor, setEditor] = useState<EditorRow[]>([])
  const [how, setHow] = useState<RebalancePick>('hand')
  const [notes, setNotes] = useState<string[]>([])

  const loadShape = useCallback(
    (s: MosaicSlice[], pick: RebalancePick, why: string[] = []) => {
      setEditor(s.map((x) => mkRow(x.token, String(x.pct))))
      setHow(pick)
      setNotes(why)
    },
    [mkRow],
  )

  // A chain change starts from what the wallet holds there (or the balanced
  // preset when nothing volatile is worth a tile).
  useEffect(() => {
    if (held.slices.length > 0) loadShape(held.slices, 'hand')
    else loadShape(presets[0]?.slices ?? [], 'preset')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word])

  const slices: MosaicSlice[] = editor
    .filter((r) => r.token.length >= 2 && parseFloat(r.pct) > 0)
    .map((r) => ({ pct: parseFloat(r.pct), token: r.token.toUpperCase() }))
  const sum = editor.reduce((a, r) => a + (parseFloat(r.pct) || 0), 0)
  const sumOk = Math.abs(sum - 100) <= 0.5
  const composed = slices.length > 0 ? composeMosaicAsk(slices, word) : null
  const ask = composed && 'ask' in composed ? composed.ask : null
  const problem = composed && 'problem' in composed ? composed.problem : null

  // The preview: the pure planner over the wallet's own priced rows.
  const plan = useMemo(() => (ask && picked ? planMosaic({ slices, chainWord: word, holdings: holdingsOf(picked.chain) }) : null), [ask, picked, word, slices])

  const setToken = (id: number, v: string) =>
    setEditor((rs) => rs.map((r) => (r.id === id ? { ...r, token: v.replace(/[^A-Za-z]/g, '').slice(0, 12).toUpperCase() } : r)))
  const setPct = (id: number, v: string) => {
    setEditor((rs) => rs.map((r) => (r.id === id ? { ...r, pct: v } : r)))
    setHow('hand')
  }
  const removeRow = (id: number) => setEditor((rs) => rs.filter((r) => r.id !== id))
  const addRow = () => setEditor((rs) => (rs.length >= 8 ? rs : [...rs, mkRow('', '')]))

  /** "Make it 100": scale every non-zero tile proportionally, integers via
   *  largest remainder (the studio's own rule). */
  const normalize = () => {
    const live = editor.filter((r) => (parseFloat(r.pct) || 0) > 0)
    const total = live.reduce((a, r) => a + parseFloat(r.pct), 0)
    if (total <= 0) return
    const exact = live.map((r) => (parseFloat(r.pct) / total) * 100)
    const floors = exact.map((n) => Math.floor(n))
    let left = 100 - floors.reduce((a, n) => a + n, 0)
    for (const { i } of exact.map((n, i) => ({ i, frac: n - Math.floor(n) })).sort((a, b) => b.frac - a.frac)) {
      if (left <= 0) break
      floors[i] += 1
      left -= 1
    }
    const pctById = new Map(live.map((r, i) => [r.id, Math.max(1, floors[i])]))
    setEditor((rs) => rs.filter((r) => pctById.has(r.id)).map((r) => ({ ...r, pct: String(pctById.get(r.id)) })))
  }

  const chooseForMe = () => {
    const c = chooseMosaicShape(rows, word)
    if (c.slices.length > 0) loadShape(c.slices, 'chosen', c.notes)
    else setNotes(c.notes)
  }

  const canRun = !!ask && plan?.kind === 'plan'

  return (
    <div data-wallet-rebalance className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-3.5 py-3 space-y-3 text-[12px]">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-[11.5px] text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> back
        </button>
        <Link href="/mosaic" className="inline-flex items-center gap-1 mono text-[10.5px] uppercase tracking-wide text-[color:var(--muted-2)] hover:text-[color:var(--accent)] transition-colors">
          Mosaic studio <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Which chain — v1 tiles one chain at a time. */}
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Chain to rebalance">
        {chains.map((c) => {
          const thin = c.usd < MIN_TILE_USD
          return (
            <button
              key={c.word}
              type="button"
              role="radio"
              aria-checked={c.word === word}
              disabled={thin}
              onClick={() => setWord(c.word)}
              title={thin ? `${fmtUsd(c.usd)} on ${c.chain.name} — a shape needs at least ${fmtUsd(MIN_TILE_USD)} of movable value` : `${fmtUsd(c.usd)} on ${c.chain.name}`}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors disabled:opacity-40',
                c.word === word ? 'border-[color:var(--accent)] text-[color:var(--accent)]' : 'border-[var(--line)] text-[color:var(--muted)] hover:text-[color:var(--fg)]',
              )}
            >
              {c.chain.name} <span className="mono tabular-nums text-[color:var(--muted-2)]">{fmtUsd(c.usd)}</span>
            </button>
          )
        })}
      </div>
      {elsewhere.length > 0 && (
        <p className="text-[11px] text-[color:var(--muted-2)]">
          {elsewhere.map((c) => `${fmtUsd(tileValueOf(c))} on ${c.name}`).join(', ')} stays put — Mosaic tiles Base, Ethereum, Arbitrum and Robinhood Chain.
        </p>
      )}

      {/* What you hold there today. */}
      {picked && (
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--muted-2)]">You hold on {picked.chain.name}</span>
            <span className="mono tabular-nums text-[11px] text-[color:var(--muted)]">{fmtUsd(held.totalUsd)}</span>
          </div>
          {held.slices.length > 0 ? (
            <TileBar slices={held.slices} size="sm" />
          ) : (
            <p className="text-[11.5px] text-[color:var(--muted)]">
              {held.totalUsd > 0 ? `All ${stable} — nothing to tile yet; shape something below.` : 'Nothing priced here yet.'}
            </p>
          )}
        </div>
      )}

      {/* The shape you want. */}
      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--muted-2)]">The shape you want</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={chooseForMe}
              disabled={rows.length === 0}
              data-choose-for-me
              className="inline-flex items-center gap-1 rounded-full border tint-border-accent-50 px-2.5 py-0.5 text-[11px] text-[color:var(--accent)] hover:tint-bg-accent-8 disabled:opacity-40 transition-colors"
            >
              <Wand2 className="w-3 h-3" /> Choose for me
            </button>
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => loadShape(p.slices, 'preset')}
                title={p.slices.map((s) => `${s.pct}% ${s.token}`).join(', ')}
                className="rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[11px] text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:border-[var(--line-2)] transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {slices.length > 0 && sumOk && <TileBar slices={slices} size="sm" />}
        {notes.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[11px] text-[color:var(--muted-2)]">
            {notes.map((n) => (
              <li key={n}>· {n}</li>
            ))}
          </ul>
        )}
        <div className="mt-2 space-y-1.5">
          {editor.map((r) => (
            <div key={r.id} className="flex items-center gap-1.5">
              <input
                value={r.token}
                onChange={(e) => setToken(r.id, e.target.value)}
                placeholder="TOKEN"
                aria-label="Token symbol"
                className="mono w-24 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[12px] max-lg:text-[16px] text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
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
                className="mono w-16 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[12px] max-lg:text-[16px] text-[color:var(--fg)] tabular-nums focus:outline-none focus:border-[var(--accent)]"
              />
              <span className="mono text-[11px] text-[color:var(--muted-2)]">%</span>
              <button
                type="button"
                onClick={() => removeRow(r.id)}
                aria-label={`Remove the ${r.token || 'empty'} tile`}
                className="w-6 h-6 grid place-items-center rounded-lg text-[color:var(--muted-2)] hover:text-[color:var(--fg)] hover:bg-[var(--surf-2)] transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            onClick={addRow}
            disabled={editor.length >= 8}
            className="inline-flex items-center gap-1 mono text-[11px] text-[color:var(--muted)] hover:text-[color:var(--fg)] disabled:opacity-40 transition-colors"
          >
            <Plus className="w-3 h-3" /> add a tile
          </button>
          <span className={cn('mono text-[11px] tabular-nums', sumOk ? 'text-[color:var(--muted-2)]' : 'text-amber-400')}>Σ {Math.round(sum * 100) / 100}%</span>
          {!sumOk && sum > 0 && (
            <button type="button" onClick={normalize} className="mono text-[11px] text-[color:var(--accent)] hover:underline underline-offset-2">
              make it 100
            </button>
          )}
        </div>
      </div>

      {/* The wire, and what it would do to THIS wallet. */}
      {ask && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 space-y-1.5">
          <div className="mono text-[11px] text-[color:var(--fg)] break-words" data-wallet-rebalance-ask>
            {ask}
          </div>
          {plan?.kind === 'plan' && (
            <>
              <div className="space-y-0.5">
                {plan.rows.map((r) => (
                    <div key={r.token} className="flex items-center gap-2 text-[11px]">
                      <span className="mono w-16 truncate text-[color:var(--fg)]">{r.token}</span>
                      <span className="mono tabular-nums text-[color:var(--muted-2)]">{fmtUsd(r.heldUsd)} → {fmtUsd(r.targetUsd)}</span>
                      <span
                        className={cn(
                          'ml-auto mono tabular-nums',
                          r.action === 'buy' ? 'text-[color:var(--accent)]' : r.action === 'sell' ? 'text-[color:var(--sell)]' : 'text-[color:var(--muted-2)]',
                        )}
                      >
                        {r.action === 'buy'
                          ? `buy ${fmtSigned(r.deltaUsd)}`
                          : r.action === 'sell'
                            ? `sell ${fmtSigned(r.deltaUsd)}`
                            : r.action === 'skip'
                              ? 'within band'
                              : r.token === stable
                                ? 'the rail'
                                : 'hold'}
                      </span>
                    </div>
                  ))}
              </div>
              <div className="text-[11px] text-[color:var(--muted)]">
                {plan.legs.length} leg{plan.legs.length === 1 ? '' : 's'} · ~{fmtUsd(plan.totalMoveUsd)} moves · sells settle first, then the buys
              </div>
            </>
          )}
          {plan?.kind === 'quiet' && <div className="text-[11px] text-[color:var(--muted)]">Already in shape — nothing worth moving.</div>}
          {plan?.kind === 'problem' && <div className="text-[11px] text-amber-400">{plan.problem}</div>}
          {plan && plan.kind !== 'problem' && plan.notes.length > 0 && (
            <ul className="space-y-0.5 text-[10.5px] text-[color:var(--muted-2)]">
              {plan.notes.map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {problem && <div className="text-[11px] text-amber-400">{problem}</div>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => ask && onRun(ask, how, word)}
          disabled={!canRun}
          data-wallet-rebalance-run
          className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {plan?.kind === 'quiet' ? 'Nothing to move' : 'Rebalance — build the batch'}
        </button>
        <span className="text-[10.5px] text-[color:var(--muted-2)]">Every leg builds fresh at its sign step · a shape, not advice</span>
      </div>
    </div>
  )
}
