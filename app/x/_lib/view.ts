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
import { normalizeHandle, normalizeSide, type CalledSide, type RecordResponse } from '@/lib/called-it/spec'
import type { ClosePoint } from '@/lib/called-it/card-layout'
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

  // The line is the record's window: nothing older than its first bar.
  let closes = chart.closes
  if (answer.body.status === 'ready') {
    const fromSec = Math.floor(answer.body.record.window.from / 1000)
    const cut = closes.filter((p) => p.t >= fromSec)
    if (cut.length >= 2) closes = cut
  }
  const avatar = answer.body.status === 'ready' ? await avatarDataUri(answer.body.record.profile.avatarUrl) : null
  return { handle, symbol, side, pins, http: answer.http, body: answer.body, closes, unit: chart.unit, avatar }
}

/** One read per request: the page and its metadata share it. */
export const loadRecordView = cache(load)
