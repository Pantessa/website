// Pins for Called it's TARGET judging and the "since" line (2026-11-16).
// A call that names a level is judged on the level: reached within
// TARGET_DAYS before the price goes the same distance the other way (capped at
// TARGET_STOP_MAX). The model only points at the words; code reads the number.
// Pure. Wired into test-api.
//   npx tsx scripts/called-target-pins.ts            (npm run pins:called-target)
import { readFileSync } from 'node:fs'
import type { Candle } from '../lib/charts'
import {
  DEAD_BAND,
  METHOD_LINE,
  TARGET_DAYS,
  TARGET_STOP_MAX,
  buildRecord,
  judgeTarget,
  judgedLine,
  moveLine,
  parseTargetSpan,
  sinceLine,
  targetPrice,
  type LabeledPost,
} from '../lib/called-it/spec'
import { readAnswer, validTarget } from '../lib/called-it/classify'
import { pickSupply } from '../lib/called-it/supply'

type Check = (name: string, ok: boolean, extra?: string) => void
const DAY = 86_400_000
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/** Daily bars from 2026-01-01, one per entry: [high, low, close]. */
function bars(rows: [number, number, number][]): Candle[] {
  const t0 = Date.UTC(2026, 0, 1) / 1000
  return rows.map(([h, l, c], i) => ({ t: t0 + i * 86_400, o: c, h, l, c, v: 1 }))
}
const T0 = Date.UTC(2026, 0, 1, 12)

export function calledTargetPins(check: Check): void {
  // ── Reading the number (code, never the model) ──
  const p = (s: string) => parseTargetSpan(s)
  check('called target: $5B is a market cap', p('$5B is a clear magnet')?.unit === 'mcap' && p('$5B is a clear magnet')?.value === 5e9 && p('$5B is a clear magnet')?.stated === '$5B')
  check('called target: 150k is a price', p('BTC to 150k by March')?.unit === 'price' && p('BTC to 150k by March')?.value === 150_000)
  check('called target: a percent and a multiple', p('up 50% from here')?.unit === 'pct' && p('up 50% from here')?.value === 0.5 && p('10x from here')?.unit === 'multiple' && p('10x from here')?.value === 10)
  check('called target: $3.50 and $10,000 are prices', p('$3.50 next')?.value === 3.5 && p('ETH $10,000 this cycle')?.value === 10_000)
  check('called target: a count, a year, a bare number are not levels', p('2 digits soon') === null && p('by 2027') === null && p('back to 90') === null && p('no number here') === null)
  check('called target: a cap word makes a big number a market cap, never a small one', p('market cap $2.5bn')?.unit === 'mcap' && p('mcap 4,000,000,000')?.unit === 'mcap' && p('targeting $4,000 market cap')?.unit === 'price')

  // ── The level as a price ──
  check('called target: a market cap needs supply', targetPrice({ value: 5e9, unit: 'mcap' }, 'bull', 2.77, null) === null && Math.abs(targetPrice({ value: 5e9, unit: 'mcap' }, 'bull', 2.77, 1.31e9)! - 3.817) < 0.01)
  check('called target: a level on the wrong side, or inside the dead band, is not a target', targetPrice({ value: 2, unit: 'price' }, 'bull', 3, null) === null && targetPrice({ value: 4, unit: 'price' }, 'bear', 3, null) === null && targetPrice({ value: 3 * (1 + DEAD_BAND / 2), unit: 'price' }, 'bull', 3, null) === null)
  check('called target: a bear percent goes down', Math.abs(targetPrice({ value: 0.4, unit: 'pct' }, 'bear', 100, null)! - 60) < 1e-9 && Math.abs(targetPrice({ value: 0.4, unit: 'pct' }, 'bull', 100, null)! - 140) < 1e-9)
  check('called target: a level 100x away is a misread', targetPrice({ value: 1000, unit: 'price' }, 'bull', 3, null) === null)

  // ── Judging on the bars AFTER the post's bar ──
  // Post on bar 0 at close 100, target 120 (stop 80).
  const hit = bars([[130, 70, 100], [110, 95, 105], [121, 100, 118], [90, 50, 60]])
  const jh = judgeTarget(hit, T0, 'bull', 100, 120, T0 + 300 * DAY)
  check('called target: the post\'s own bar never counts; the first bar to reach it is a hit', jh.outcome === 'hit' && jh.at === hit[2].t * 1000 && Math.abs(jh.judgedPct - 0.2) < 1e-9 && jh.stop === 80)
  const stopped = bars([[100, 100, 100], [105, 79, 85], [130, 90, 125]])
  const js = judgeTarget(stopped, T0, 'bull', 100, 120, T0 + 300 * DAY)
  check('called target: the stop first is a miss, whatever comes later', js.outcome === 'stopped' && Math.abs(js.judgedPct + 0.2) < 1e-9)
  const both = bars([[100, 100, 100], [125, 75, 100]])
  check('called target: a bar that reaches both reads stopped (never guessed in the caller\'s favour)', judgeTarget(both, T0, 'bull', 100, 120, T0 + 300 * DAY).outcome === 'stopped')
  const flat = bars(Array.from({ length: 200 }, () => [105, 95, 101] as [number, number, number]))
  check('called target: neither within the window expires', judgeTarget(flat, T0, 'bull', 100, 120, T0 + (TARGET_DAYS + 5) * DAY).outcome === 'expired' && judgeTarget(flat, T0, 'bull', 100, 120, T0 + 20 * DAY).outcome === 'open')
  check('called target: the stop is capped (a 10x call is not a free ride to zero)', judgeTarget(flat, T0, 'bull', 100, 1000, T0 + 20 * DAY).stop === 100 * (1 - TARGET_STOP_MAX))
  const bear = bars([[100, 100, 100], [105, 89, 90]])
  check('called target: a bear hit reads the low', judgeTarget(bear, T0, 'bear', 100, 90, T0 + 300 * DAY).outcome === 'hit')

  // ── The record: a target call is judged on its level, others on the 30-day close ──
  const candles = bars([[100, 100, 100], ...Array.from({ length: 40 }, (_, i) => [101 + i, 99 + i, 100 + i] as [number, number, number]), ...Array.from({ length: 20 }, () => [131, 129, 130] as [number, number, number])])
  const post = (id: string, text: string, target: string | null): LabeledPost => ({ id, handle: 'pin_target', text, postedAt: T0 + 3600_000, likes: 10, replies: 0, reposts: 0, isReply: false, source: 'fixture', origin: 'scan', label: { stance: 'bull', conviction: 3, quote: text.split(' ').slice(0, 3).join(' '), target } })
  const rec = buildRecord({ handle: 'pin_target', symbol: 'TST', side: 'all', profile: { handle: 'pin_target', name: 'pin', avatarUrl: null, followers: 1, blue: false, xUserId: null }, verified: null, posts: [post('1001', 'Going to $125 soon', '$125'), post('1002', 'Going way higher', null), post('1003', 'Going to $5B cap', '$5B cap')], candles, nowMs: candles[candles.length - 1].t * 1000 + 3600_000, scannedAt: 1, postsRead: 3 })
  const [a, b, c] = ['1001', '1002', '1003'].map((id) => rec.calls.find((x) => x.postId === id)!)
  check('called target (record): a priced level is judged on the level', a.target?.outcome === 'hit' && a.verdict === 'right' && judgedLine(a).startsWith('hit its $125 target '))
  check('called target (record): no level, the 30-day close', b.target === null && b.verdict === 'right' && judgedLine(b) === '+29.0% in 30 days')
  check('called target (record): a market cap with no supply falls back to the 30-day close, never drops the call', c.target === null && c.verdict === 'right')
  check('called target (record): every judged call says how it has gone since', moveLine(b) === '+29.0% in 30 days, +30.0% since' && sinceLine(b) === '+30.0% since')
  check('called target (lines): an open call shows its move so far and no since', moveLine({ verdict: 'open', judgedPct: 0.04, now: 0.04 }) === '+4.0% so far' && sinceLine({ verdict: 'open', judgedPct: 0.04, now: 0.04 }) === null)
  check('called target (lines): stopped and expired say so', judgedLine({ verdict: 'wrong', judgedPct: -0.377, target: { span: '$5B', unit: 'mcap', stated: '$5B', price: 3.8, stop: 1.7, outcome: 'stopped', at: 1 } }) === '-37.7% before its $5B target' && judgedLine({ verdict: 'wrong', judgedPct: 0.1, target: { span: '$5B', unit: 'mcap', stated: '$5B', price: 3.8, stop: 1.7, outcome: 'expired', at: null } }) === `$5B target not reached in ${TARGET_DAYS} days`)
  check('called target (lines): ASCII only', [moveLine(a), moveLine(b), METHOD_LINE].every((s) => /^[\x20-\x7e]*$/.test(s)))

  // ── The labeler's target: the post's own words, readable by code, or dropped without dropping the call ──
  const text = 'sheesh $NEAR looks good here $5B is a clear magnet. $10B doesn\'t feel crazy'
  check('called target (labeler): a span from the post with a level is kept', validTarget('$5B is a clear magnet', text) === '$5B is a clear magnet')
  check('called target (labeler): invented words or no level are dropped', validTarget('$7B is next', text) === null && validTarget('looks good here', text) === null && validTarget(42, text) === null)
  const ans = readAnswer(JSON.stringify([{ i: 1, stance: 'bull', conviction: 2, quote: 'looks good here', target: '$9B soon' }]), [{ id: 'x', text }])
  check('called target (labeler): a bad target keeps the label', ans?.[0].label.stance === 'bull' && ans?.[0].label.target === null)

  // ── Supply: the biggest coin, only when its price agrees with the chart ──
  check('called target (supply): the biggest coin whose price agrees', pickSupply([{ current_price: 3.17, market_cap: 4.16e9, circulating_supply: 1.31e9 }, { current_price: 0.01, market_cap: 1e5, circulating_supply: 1e7 }], 3.18) === 1.31e9)
  check('called target (supply): a coin that is not the one charted gives none', pickSupply([{ current_price: 0.5, market_cap: 1e9, circulating_supply: 2e9 }], 3.18) === null && pickSupply([], 3) === null)

  // ── Wiring ──
  const ddl = read('prisma/ddl/2026-11-16-called-it-targets.sql')
  check('called target (ddl): one additive column', /ADD COLUMN IF NOT EXISTS target text/.test(ddl) && !/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i.test(ddl.replace(/--.*$/gm, '')))
  const store = read('lib/called-it/store.ts')
  check('called target (store): read and written with the label', /c\.target/.test(store) && /target = EXCLUDED\.target/.test(store))
  check('called target (record): supply is read only for a market-cap target', /parseTargetSpan\(p\.label\.target\)\?\.unit === 'mcap'/.test(read('lib/called-it/record.ts')))
}

if (process.argv[1]?.endsWith('called-target-pins.ts')) {
  let failed = 0
  let n = 0
  calledTargetPins((name, ok, extra) => {
    n++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  })
  console.log(failed ? `\n${failed} of ${n} called-target pins failed` : `\nall ${n} called-target pins green`)
  process.exit(failed ? 1 : 0)
}
