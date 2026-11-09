// TELEGRAM LINKS — every URL the bot or a page hands out, built in one place
// (lane TELEGRAM, 2026-11-09). Pure + client-safe.
//
// A message carries only OUR urls: the site (SITE_URL), our own bot on
// t.me, and Telegram's share sheet wrapping one of those two. `isOurUrl` is
// that rule as a predicate; the pins run every built message through it.

import { joinPayload } from '@/lib/community/spec'

export interface LinkCtx {
  /** Canonical origin, no trailing slash (lib/site-url SITE_URL). */
  site: string
  /** The bot's @username without the @. */
  bot: string
  /** The Mini App short name, when one is registered. */
  app: string | null
}

/** Telegram's group picker: adds the bot to the chosen group and sends
 *  `/start@<bot> <code>` there. */
export function addToGroupUrl(bot: string, code: string): string {
  return `https://t.me/${bot}?startgroup=${code}`
}
/** The same door asking for ONE admin right, so the bot can pin the join
 *  button itself. The owner sees the right and confirms it in Telegram. */
export function addToGroupAsAdminUrl(bot: string, code: string): string {
  return `https://t.me/${bot}?startgroup=${code}&admin=pin_messages`
}
/** Opens the bot's private chat; pressing START sends `/start <payload>`
 *  from the user's own account. */
export function botStartUrl(bot: string, payload: string): string {
  return `https://t.me/${bot}?start=${payload}`
}
/** A Mini App direct link: opens /tg inside Telegram with the payload signed
 *  into initData. */
export function miniAppUrl(bot: string, app: string, payload: string): string {
  return `https://t.me/${bot}/${app}?startapp=${payload}`
}
/** The Mini App entry on our own origin (a `web_app` button's URL). */
export function tgEntryUrl(site: string, payload: string): string {
  return `${site}/tg?startapp=${payload}`
}

/**
 * The join door for a room, fewest taps first: the Mini App direct link when
 * a short name is registered (one tap, opens inside Telegram), else the bot's
 * private chat (tap, then START). Both prove the Telegram id; neither asks
 * for a wallet.
 */
export function joinUrlFor(ctx: Pick<LinkCtx, 'bot' | 'app'>, slug: string, invite?: string | null): string {
  const payload = joinPayload(slug, invite)
  return ctx.app ? miniAppUrl(ctx.bot, ctx.app, payload) : botStartUrl(ctx.bot, payload)
}

/** Telegram's own share sheet for one of our links. */
export function shareUrl(url: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
}

export const roomUrl = (site: string, slug: string) => `${site}/g/${slug}`
export const roomInviteUrl = (site: string, slug: string, code: string) => `${site}/g/${slug}?via=${encodeURIComponent(code)}`

function isSiteOrBot(url: string, ctx: LinkCtx): boolean {
  if (url === ctx.site || url.startsWith(`${ctx.site}/`)) return true
  const bot = `https://t.me/${ctx.bot}`
  return url === bot || url.startsWith(`${bot}?`) || url.startsWith(`${bot}/`)
}

/** True for a URL on our site, on our bot, or Telegram's share sheet
 *  carrying one of those. Anything else never rides a message. */
export function isOurUrl(url: string, ctx: LinkCtx): boolean {
  if (isSiteOrBot(url, ctx)) return true
  if (!url.startsWith('https://t.me/share/url?')) return false
  try {
    const inner = new URL(url).searchParams.get('url') ?? ''
    return isSiteOrBot(inner, ctx)
  } catch {
    return false
  }
}
