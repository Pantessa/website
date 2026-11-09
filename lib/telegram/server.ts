// THE BOT, WIRED — the real dependencies behind lib/telegram/handler (lane
// TELEGRAM, 2026-11-09). Server-only: the store, the quote feeds.
// The routes import from here; the pins import the pure modules and hand
// the handler fakes.

import { chartPairFor, resolveChartPair } from '@/lib/charts'
import { readQuotes } from '@/lib/quotes'
import { SITE_URL } from '@/lib/site-url'
import { linkedWallet, normalizeIdentity } from '@/lib/community/identity'
import { providerKey, walletKey, type Actor } from '@/lib/community/spec'
import * as store from '@/lib/community/store'
import { telegramCaller, type TgCall } from './client'
import { telegramConfig, type TelegramConfig } from './config'
import type { BotDeps } from './handler'
import type { LinkCtx } from './links'
import type { QuoteLine } from './messages'
import type { InUser } from './update'

export function linkCtx(cfg: TelegramConfig): LinkCtx | null {
  return cfg.bot ? { site: SITE_URL, bot: cfg.bot, app: cfg.app } : null
}

/** The seat a PROVEN Telegram account acts from. Same rule as
 *  lib/community/identity getActor: an identity linked to a wallet acts as
 *  that wallet's key, so one person keeps one seat. */
export async function actorForTelegramUser(user: Pick<InUser, 'id' | 'name' | 'username'>): Promise<Actor> {
  const identity = normalizeIdentity({ p: 'tg', id: user.id, name: user.name, username: user.username })
  if (!identity) throw new Error('telegram: not a user id')
  const provider = { p: identity.p, id: identity.id, name: identity.name, username: identity.username }
  const linked = await linkedWallet(identity)
  return linked ? { key: walletKey(linked), wallet: linked, provider } : { key: providerKey('tg', identity.id), wallet: null, provider }
}

/** One quote through the reader the alerts cron uses (lib/quotes readQuotes:
 *  cached per symbol, in-flight reads shared). */
export async function quoteLine(symbol: string): Promise<QuoteLine | null> {
  const { quotes } = await readQuotes([symbol])
  const q = quotes[symbol] ?? Object.values(quotes)[0]
  return q && q.last > 0 ? { last: q.last, chgPct: Number.isFinite(q.chgPct) ? q.chgPct : null, feed: q.feed } : null
}

async function market(raw: string): Promise<{ symbol: string; label: string } | null> {
  const pair = chartPairFor(raw) ?? (await resolveChartPair(raw).catch(() => null))
  return pair ? { symbol: pair.symbol, label: pair.label } : null
}

/** The handler's dependencies for a live request, or null while the bot is unconfigured. */
export function botDeps(opts: { isInternal: boolean; cfg?: TelegramConfig; call?: TgCall | null }): BotDeps | null {
  const cfg = opts.cfg ?? telegramConfig()
  const links = linkCtx(cfg)
  if (!links || !cfg.token) return null
  return { links, store, call: opts.call === undefined ? telegramCaller(cfg.token) : opts.call, quote: quoteLine, market, actorFor: actorForTelegramUser, isInternal: opts.isInternal }
}

/** A room's linked Telegram chat ids, for the server's own use (unlinking).
 *  They never leave the server: a page gets titles only. */
export async function telegramChatsOf(slug: string): Promise<{ externalId: string }[]> {
  return (await store.channelsOf(slug)).filter((c) => c.platform === 'telegram').map((c) => ({ externalId: c.externalId }))
}
