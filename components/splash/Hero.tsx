'use client'

// The splash hero — the wallet briefing promoted from "card #1 of six" to the
// band the screen opens with. Left: what Pantessa noticed (attention rows
// with their first action as a real button, receipts of standing intents
// that fired, the calm rows folded). Right: the money map — every dollar
// the cards can see, by what it's doing. The briefing tile's rows are
// untouched (lib/briefing.ts composes them); this is a different DRAWING of
// the same tile, plus the map the route computed from the same read.

import { useState } from 'react'
import { ChevronDown, ShieldAlert, Wallet } from 'lucide-react'
import { ChartChip } from '@/components/TokenChartButton'
import { mergeMoneyMap } from '@/lib/splash/money-map'
import type { MoneyMap, RowsTile, SplashTile, StatRow, SuggestedPrompt } from '@/lib/splash/types'
import { Sparkline } from './Sparkline'
import { MoneyMapPanel } from './viz'

const shortAddr = (a: string) => (a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

/** The row's sparkline symbol — only when the row is ABOUT that token. Idle
 *  USDC rows carry chartSymbol ETH so their chip can open the ETH chart; a
 *  price line beside "USDC idle" would read as the price of the USDC. */
export const sparkSymbolFor = (r: StatRow): string | null =>
  r.chartSymbol && new RegExp(`(^|[^A-Z])${r.chartSymbol.replace(/[^A-Z0-9]/gi, '')}([^A-Z]|$)`, 'i').test(r.label) ? r.chartSymbol : null

/** The briefing's rows, split the way the hero draws them. */
export function splitBriefingRows(rows: StatRow[]): { fired: StatRow[]; attention: StatRow[]; calm: StatRow[] } {
  const fired = rows.filter((r) => r.tone === 'pos' && /while you were away/i.test(r.sub ?? ''))
  const attention = rows.filter((r) => r.tone === 'neg')
  const calm = rows.filter((r) => !fired.includes(r) && !attention.includes(r))
  return { fired, attention, calm }
}

export function SplashHero({
  address,
  briefing,
  map,
  tiles,
  onPick,
}: {
  address: string
  briefing: RowsTile | null
  map: MoneyMap | null | undefined
  /** Every settled tile — their facts fold into the map. */
  tiles: SplashTile[]
  onPick: (prompt: string, slug?: string) => void
}) {
  const merged = mergeMoneyMap(map, tiles)
  const rows = briefing?.rows ?? []
  const { fired, attention, calm } = splitBriefingRows(rows)
  const needs = attention.length
  const slug = briefing?.mcpSlug ?? 'yeetful'
  const [open, setOpen] = useState<string | null>(null)

  return (
    <section
      data-splash-hero
      data-needs={needs}
      className="relative overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surf-1)]"
    >
      {/* The accent aura — the site's hero language, kept faint so the bar
          and the numbers own the contrast. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-32 h-72 w-96 rounded-full opacity-60"
        style={{ background: 'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%)' }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      <div className="relative px-4 pb-5 pt-4 sm:px-5 md:px-6">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <Wallet className="h-4 w-4 shrink-0 text-[color:var(--muted-2)]" />
            <span className="mono truncate text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
              Connected · {shortAddr(address)} · live read
            </span>
          </div>
          {needs > 0 ? (
            <span
              className="mono inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--sell)', background: 'color-mix(in srgb, var(--sell) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--sell) 35%, transparent)' }}
            >
              <ShieldAlert className="h-3 w-3" />
              {needs} need{needs === 1 ? 's' : ''} you
            </span>
          ) : (
            <span
              className="mono inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}
            >
              all quiet
            </span>
          )}
        </header>

        <div className={`mt-4 grid gap-6 ${merged ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}`}>
          {/* ── what Pantessa noticed ── */}
          <div className="min-w-0">
            <h2 className="text-[22px] leading-tight text-white" style={{ fontFamily: 'var(--font-chat-display)', letterSpacing: '-0.01em' }}>
              What Pantessa noticed
            </h2>
            <p className="mt-0.5 text-[11px] text-[color:var(--muted-2)]">
              {briefing?.subtitle ?? 'live read of this wallet — tap a chip to act, your wallet signs'}
            </p>

            {fired.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5" aria-label="while you were away">
                {fired.map((r, i) => (
                  <li
                    key={`fired-${i}`}
                    className="mono flex items-baseline justify-between gap-3 rounded-lg border border-dashed px-3 py-1.5 text-[11px]"
                    style={{ borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)', color: 'var(--accent)' }}
                  >
                    <span className="truncate">✓ {r.label}</span>
                    <span className="shrink-0 tabular-nums">{r.value}</span>
                  </li>
                ))}
              </ul>
            )}

            {attention.length > 0 && (
              <div className="mt-3 flex flex-col gap-2" data-splash-attention>
                {attention.map((r, i) => (
                  <AttentionRow key={`att-${i}`} row={r} slug={slug} onPick={onPick} />
                ))}
              </div>
            )}

            {calm.length > 0 && (
              <ul className="mt-3 flex flex-col divide-y divide-[var(--line)] border-t border-[var(--line)]" data-splash-calm>
                {calm.map((r, i) => {
                  const id = `calm-${i}`
                  const expanded = open === id
                  const acts = r.actions ?? []
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => acts.length && setOpen(expanded ? null : id)}
                        aria-expanded={acts.length ? expanded : undefined}
                        className={`flex w-full items-center gap-3 py-2 text-left ${acts.length ? 'cursor-pointer' : 'cursor-default'}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-white">{r.label}</div>
                          {r.sub && <div className="truncate text-[10px] text-[color:var(--muted-2)]">{r.sub}</div>}
                        </div>
                        <Sparkline symbol={sparkSymbolFor(r)} width={64} height={20} className="hidden sm:block" />
                        {r.value && (
                          <span className="shrink-0 text-[11px] tabular-nums" style={{ color: r.tone === 'pos' ? 'var(--accent)' : 'var(--gold)' }}>
                            {r.value}
                          </span>
                        )}
                        {acts.length > 0 && <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[color:var(--muted-2)] transition-transform ${expanded ? 'rotate-180' : ''}`} />}
                      </button>
                      {expanded && (
                        <div className="pb-2">
                          <Chips actions={acts} chart={r.chartSymbol} slug={slug} onPick={onPick} />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {rows.length === 0 && (
              <p className="mt-3 text-xs leading-relaxed text-[color:var(--muted)]">
                Nothing needs you right now. The cards below are the live read of every connected app — tap any chip to act; your wallet signs.
              </p>
            )}
          </div>

          {/* ── the money map ── */}
          {merged && (
            <div className="min-w-0 lg:border-l lg:border-[var(--line)] lg:pl-6">
              <p className="mono mb-3 text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">Money map · what it&rsquo;s doing</p>
              <MoneyMapPanel map={merged} />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** One thing that needs the user: the row, the dollar cost, the first
 *  action as the button it deserves, the rest as chips, a sparkline when
 *  the symbol charts. */
function AttentionRow({ row, slug, onPick }: { row: StatRow; slug: string; onPick: (p: string, slug?: string) => void }) {
  const [primary, ...rest] = row.actions ?? []
  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-[var(--line)] p-3"
      style={{ borderLeft: '2px solid var(--sell)', background: 'color-mix(in srgb, var(--sell) 4%, transparent)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-sm font-medium text-white">{row.label}</span>
          {row.value && (
            <span className="mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--sell)' }}>
              {row.value}
            </span>
          )}
        </div>
        {row.sub && <p className="mt-0.5 text-[11px] leading-snug text-[color:var(--muted)]">{row.sub}</p>}
        {(primary || row.chartSymbol) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {primary && (
              <button
                type="button"
                title={primary.prompt}
                onClick={() => onPick(primary.prompt, slug)}
                className="rounded-full px-3 py-1 text-[11px] font-semibold transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent)', color: 'var(--ink)' }}
              >
                {primary.label}
              </button>
            )}
            <Chips actions={rest} chart={row.chartSymbol} slug={slug} onPick={onPick} />
          </div>
        )}
      </div>
      <Sparkline symbol={sparkSymbolFor(row)} width={96} height={32} className="hidden sm:block" />
    </div>
  )
}

function Chips({ actions, chart, slug, onPick }: { actions: SuggestedPrompt[]; chart?: string | null; slug: string; onPick: (p: string, slug?: string) => void }) {
  if (actions.length === 0 && !chart) return null
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
    </div>
  )
}
