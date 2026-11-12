// What one record page (and its share image) is drawn from: the record
// answer, the daily closes its line is drawn with, the chart's unit and the
// avatar (squad called-it, lane RECORD).
//
// The record comes from lib/called-it/record readRecord, the same function
// the API route answers with: a page never fetches its own API. The closes
// are loaded the way readRecord loads its candles (the deep daily series), so
// the line under the pins is the line the calls were judged on.
//
// Nothing here throws: a record read that fails is a named refusal with
// somewhere to go, and a chart that does not answer is an empty line.
import { cache } from 'react'
import { loadCandleSeries } from '@/lib/candles-server'
import { chartUnitOf, type ChartUnit } from '@/lib/charts'
import { SYMBOL_RE, parsePins, readRecord } from '@/lib/called-it/record'
import { SCAN_WINDOW_DAYS, normalizeHandle, normalizeSide, type CalledSide, type RecordResponse } from '@/lib/called-it/spec'
import { plotFromSec, type ClosePoint } from '@/lib/called-it/card-layout'
import { avatarDataUri } from './avatar'

export interface RecordView {
  /** The handle the URL named, normalized. Null when it is not a handle. */
  handle: string | null
  /** The market the URL named, upper-cased. Null when it is not a symbol. */
  symbol: string | null
  side: CalledSide
  /** The URL's own pins (valid ids only). */
  pins: string[]
  http: number
  body: RecordResponse
  /** Daily closes, date ascending. Empty when the chart did not answer or the URL named none. */
  closes: ClosePoint[]
  unit: ChartUnit
  /** The account's avatar as a data URI, when X's image host answered in time. */
  avatar: string | null
  /** Where the scans' coverage starts (ms), when a scan has finished. The pictures dim what lies before it. */
  readFrom: number | null
}

async function loadCloses(symbol: string): Promise<{ closes: ClosePoint[]; unit: ChartUnit }> {
  try {
    const loaded = await loadCandleSeries(symbol, '1d', { deep: true })
    if (!loaded) return { closes: [], unit: 'usd' }
    return { closes: loaded.series.candles.filter((c) => c.c > 0).map((c) => ({ t: c.t, c: c.c })), unit: chartUnitOf(loaded.pair) }
  } catch {
    return { closes: [], unit: 'usd' }
  }
}

async function load(handleRaw: string, symbolRaw: string, sideRaw: string, pinsRaw: string): Promise<RecordView> {
  const handle = normalizeHandle(handleRaw)
  const symTrim = symbolRaw.trim()
  const symbol = SYMBOL_RE.test(symTrim) ? symTrim.toUpperCase() : null
  const side = normalizeSide(sideRaw)
  const pins = parsePins(pinsRaw)

  const [answer, chart] = await Promise.all([
    readRecord({ handle: handleRaw, symbol: symbolRaw, side: sideRaw, pins: pinsRaw }).catch(() => ({
      http: 503,
      body: { status: 'refused' as const, reason: 'The record did not load. Try again in a moment.', next: [{ label: 'Plot a handle', href: '/x' }] },
    })),
    handle && symbol ? loadCloses(symbol) : Promise.resolve({ closes: [] as ClosePoint[], unit: 'usd' as ChartUnit }),
  ])

  // The line is drawn over the stretch a pin can stand on (card-layout plotFromSec), inside the record's window.
  // That is the CHART's window, never a claim about what was read: the record's own coverage line says that, and
  // where the scans read less than what is drawn the pictures dim the rest (card-layout unreadShare).
  let closes = chart.closes
  if (answer.body.status === 'ready') {
    const rec = answer.body.record
    const fromSec = plotFromSec(rec.window.from, rec.window.to, rec.calls.length ? rec.calls[0].barTime : null, SCAN_WINDOW_DAYS)
    const cut = closes.filter((p) => p.t >= fromSec)
    if (cut.length >= 2) closes = cut
  } else if (closes.length > SCAN_WINDOW_DAYS) {
    closes = closes.slice(-SCAN_WINDOW_DAYS)
  }
  const avatar = answer.body.status === 'ready' ? await avatarDataUri(answer.body.record.profile.avatarUrl) : null
  const readFrom = answer.body.status === 'ready' ? (answer.body.record.coverage?.from ?? null) : null
  return { handle, symbol, side, pins, http: answer.http, body: answer.body, closes, unit: chart.unit, avatar, readFrom }
}

/** One read per request: the page and its metadata share it. */
export const loadRecordView = cache(load)
