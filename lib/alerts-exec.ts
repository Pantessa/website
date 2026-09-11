// lib/alerts-exec.ts — the price-alert sweep behind /api/cron/alerts
// (MARKETS/WATCH, 2026-09-11). ONE quote read per SYMBOL per pass serves
// every alert on that symbol — the dedup that makes "unlimited alerts" free
// (BUSINESS-MODEL-chart-first §6). The response carries `reads` so the
// harness pins the number, not the comment.
//
// Firing is a state change plus a notification row; it NEVER sends the
// alert's `actionAsk` — the signature is the gate. The rail surfaces the
// chip; the owner sends it. Email rides lib/email's Resend mailer when the
// alert named an address (best-effort, never fails the sweep).
//
// Fixture prices: the harness proves "an alert fires on a fixture price"
// without waiting for AAPL to move. A fixture is honored ONLY for alerts
// stamped is_internal (harness rows) — a real owner's alert is only ever
// evaluated against the live quote, whatever the caller sends.

import prisma from '@/lib/db'
import { mintSlug } from '@/lib/intent-links'
import { sendEmail } from '@/lib/email'
import { SITE_URL } from '@/lib/site-url'
import { readQuotes, type QuoteMap } from '@/lib/quotes'
import { alertFires, alertLabel, fmtQuotePrice, groupAlertsBySymbol, type AlertCondition } from '@/lib/watchlists'

export interface SweepOptions {
  /** symbol → price, applied to INTERNAL alerts only. */
  fixture?: Record<string, number>
  /** Injection seam for tests; defaults to the live batched reader. */
  quotes?: (symbols: string[]) => Promise<QuoteMap>
  now?: Date
}

export interface SweepSummary {
  /** Active alerts evaluated. */
  evaluated: number
  /** Distinct symbols read from the feed this pass (the dedup number). */
  reads: number
  /** Symbols with active alerts. */
  symbols: string[]
  fired: { id: string; symbol: string; price: number; owner: string }[]
  /** Symbols no feed answered for (alerts on them stay active, untouched). */
  unquoted: string[]
  at: string
}

const liveQuotes = async (symbols: string[]): Promise<QuoteMap> => (await readQuotes(symbols)).quotes

export async function runAlertSweep(opts: SweepOptions = {}): Promise<SweepSummary> {
  const now = opts.now ?? new Date()
  const active = await prisma.priceAlert.findMany({ where: { status: 'active' }, take: 5000 })
  const bySymbol = groupAlertsBySymbol(active)
  const symbols = [...bySymbol.keys()]
  const fixture = opts.fixture ?? {}
  // Symbols where EVERY alert is internal AND the fixture names a price need
  // no feed read at all; anything else is read once.
  const needFeed = symbols.filter((s) => !(Number(fixture[s]) > 0 && (bySymbol.get(s) ?? []).every((a) => a.isInternal)))
  const quotes = needFeed.length ? await (opts.quotes ?? liveQuotes)(needFeed) : {}
  const fired: SweepSummary['fired'] = []
  const unquoted: string[] = []

  for (const [symbol, alerts] of bySymbol) {
    const live = quotes[symbol]?.last
    for (const a of alerts) {
      const price = a.isInternal && Number(fixture[symbol]) > 0 ? Number(fixture[symbol]) : live
      if (!(price != null && price > 0)) continue
      const rule = { symbol, condition: a.condition as AlertCondition, value: a.value, basePrice: a.basePrice }
      if (!alertFires(rule, price)) {
        await prisma.priceAlert.update({ where: { id: a.id }, data: { lastChecked: now, lastPrice: price } })
        continue
      }
      // Fire: flip the row first (a crashed notification write must not
      // re-fire next minute), then the notification, then the mail.
      const flipped = await prisma.priceAlert.updateMany({
        where: { id: a.id, status: 'active' },
        data: { status: 'fired', firedAt: now, firedPrice: price, lastChecked: now, lastPrice: price },
      })
      if (flipped.count === 0) continue // a concurrent pass got it
      const title = `${alertLabel(rule)} — now $${fmtQuotePrice(price)}`
      const body = a.actionAsk
        ? `Your alert fired at $${fmtQuotePrice(price)}. The action you set up is ready to send — it moves nothing until you sign.`
        : `Your alert fired at $${fmtQuotePrice(price)}.`
      await prisma.alertNotification.create({
        data: { id: mintSlug(10), owner: a.owner, alertId: a.id, symbol, title, body, actionAsk: a.actionAsk, price, isInternal: a.isInternal },
      })
      fired.push({ id: a.id, symbol, price, owner: a.owner })
      if (a.email && !a.isInternal) {
        const href = `${SITE_URL}/t/${encodeURIComponent(symbol)}`
        void sendEmail({
          to: a.email,
          subject: `${symbol} alert: ${title}`,
          text: `${body}\n\nOpen the chart: ${href}${a.actionAsk ? `\nReady to send: "${a.actionAsk}"` : ''}`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:480px"><h2>${title}</h2><p>${body}</p>${a.actionAsk ? `<p>Ready to send: <strong>${a.actionAsk}</strong></p>` : ''}<p><a href="${href}">Open the ${symbol} chart</a></p></div>`,
        })
      }
    }
    if (!(live != null && live > 0) && !alerts.every((a) => a.isInternal && Number(fixture[symbol]) > 0)) unquoted.push(symbol)
  }

  return { evaluated: active.length, reads: needFeed.length, symbols, fired, unquoted, at: now.toISOString() }
}
