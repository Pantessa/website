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

/** Escape for an HTML mail body — every interpolated field is either
 *  user-authored (actionAsk) or derived from one; the mail must never carry
 *  markup a stranger typed (integration review, 2026-09-11). */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** The alert mail, pure: subject + text + escaped html. Exported for the pin. */
export function renderAlertEmail(input: { symbol: string; title: string; body: string; actionAsk: string | null; href?: string }): { subject: string; text: string; html: string } {
  const symbol = input.symbol.replace(/[^A-Z0-9]/g, '')
  // A print alert (lib/print-alerts) points at the tape filtered to its
  // market; a price alert at the chart. Same-site paths only.
  const href = input.href && /^\/[A-Za-z0-9/_?=&%.:-]*$/.test(input.href) ? `${SITE_URL}${input.href}` : `${SITE_URL}/t/${encodeURIComponent(symbol)}`
  const ask = input.actionAsk ? input.actionAsk.replace(/[\r\n]+/g, ' ') : null
  return {
    subject: `${symbol} alert: ${input.title.replace(/[\r\n]+/g, ' ')}`,
    text: `${input.body}\n\n${input.href ? 'Open the tape' : 'Open the chart'}: ${href}${ask ? `\nReady to send: "${ask}"` : ''}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px"><h2>${escapeHtml(input.title)}</h2><p>${escapeHtml(input.body)}</p>${ask ? `<p>Ready to send: <strong>${escapeHtml(ask)}</strong></p>` : ''}<p><a href="${href}">${input.href ? 'Open the tape' : `Open the ${escapeHtml(symbol)} chart`}</a></p></div>`,
  }
}

/** ONE write site for "an alert fired": the in-app row the bell reads and,
 *  when the rule named a verified address, the mail — the price sweep
 *  below and the print-alert sweep (lib/print-alerts-exec) both land here,
 *  so the bell and the inbox carry a stream rule exactly as a price rule.
 *  Internal (harness) rows never mail. Returns the notification id. */
export async function notifyAlertFired(n: { owner: string; alertId: string; symbol: string; title: string; body: string; actionAsk: string | null; price: number; isInternal: boolean; email: string | null; href?: string }): Promise<string> {
  const id = mintSlug(10)
  await prisma.alertNotification.create({
    data: { id, owner: n.owner.toLowerCase(), alertId: n.alertId, symbol: n.symbol, title: n.title, body: n.body, actionAsk: n.actionAsk, price: n.price, isInternal: n.isInternal },
  })
  if (n.email && !n.isInternal) {
    void sendEmail({ to: n.email, ...renderAlertEmail({ symbol: n.symbol, title: n.title, body: n.body, actionAsk: n.actionAsk, href: n.href }) })
  }
  return id
}

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
      const title = `${alertLabel(rule)} — hit $${fmtQuotePrice(price)}`
      const body = a.actionAsk
        ? `Your alert fired at $${fmtQuotePrice(price)}. The action you set up is ready to send — it moves nothing until you sign.`
        : `Your alert fired at $${fmtQuotePrice(price)}.`
      await notifyAlertFired({ owner: a.owner, alertId: a.id, symbol, title, body, actionAsk: a.actionAsk, price, isInternal: a.isInternal, email: a.email })
      fired.push({ id: a.id, symbol, price, owner: a.owner })
    }
    if (!(live != null && live > 0) && !alerts.every((a) => a.isInternal && Number(fixture[symbol]) > 0)) unquoted.push(symbol)
  }

  return { evaluated: active.length, reads: needFeed.length, symbols, fired, unquoted, at: now.toISOString() }
}
