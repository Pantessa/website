import { NextRequest, NextResponse } from 'next/server'
import { parseTradingViewExport } from '@/lib/watchlists'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/watchlists/import { text } → the parsed TradingView export:
// { tradable, notYet, sections, entries, skipped }. Pure (no DB, no auth —
// a guest previews the import before deciding to keep it); the caller then
// POSTs the symbols to /api/watchlists or keeps them locally. 64KB cap on
// the text (lib/watchlists slices it) — a TradingView list is a few KB.
export async function POST(req: NextRequest) {
  let text = ''
  try {
    const b = (await req.json()) as { text?: unknown }
    text = typeof b.text === 'string' ? b.text : ''
  } catch {
    return NextResponse.json({ error: 'Malformed body — send { text }.' }, { status: 400 })
  }
  if (!text.trim()) return NextResponse.json({ error: 'Paste the exported list.' }, { status: 400 })
  const parsed = parseTradingViewExport(text)
  return NextResponse.json({
    tradable: parsed.tradable,
    notYet: parsed.notYet,
    sections: parsed.sections,
    skipped: parsed.skipped,
    entries: parsed.entries.map((e) => ({ input: e.input, exchange: e.exchange, symbol: e.symbol, section: e.section, tradable: e.tradable, source: e.pair?.source ?? null })),
  })
}
