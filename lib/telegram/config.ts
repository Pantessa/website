// ─────────────────────────────────────────────────────────────────────────
//  TELEGRAM — the bot's configuration, read in ONE place (squad community,
//  lane TELEGRAM, 2026-11-09).
//
//  Four env vars, all optional. Absent = the feature says so BY NAME (a 503
//  carrying `unconfigured`) and nothing else in the app changes:
//    TELEGRAM_BOT_TOKEN       BotFather's token. Signs nothing we send; it is
//                             the HMAC key Telegram signs identities with and
//                             the credential of every outbound Bot API call.
//    TELEGRAM_BOT_NAME        the bot's @username (no @). Every deep link.
//    TELEGRAM_WEBHOOK_SECRET  the `secret_token` given to setWebhook; the
//                             webhook refuses anything that does not carry it.
//    TELEGRAM_APP_NAME        optional: the Mini App short name (BotFather
//                             /newapp). With it the group's join button opens
//                             the room INSIDE Telegram in one tap.
//  One optional switch: TELEGRAM_LOGIN_WIDGET=1 says the owner ran BotFather's
//  /setdomain, so the web Login Widget may render (it shows "Bot domain
//  invalid" without that step, and nothing here can detect it).
//
//  Pure over the env it is handed (the pins pass a fake one). Nothing here
//  ever prints a value.
// ─────────────────────────────────────────────────────────────────────────

export type TelegramEnvName = 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_BOT_NAME' | 'TELEGRAM_WEBHOOK_SECRET' | 'TELEGRAM_APP_NAME'

/** `<bot id>:<secret>` as BotFather prints it. */
export const BOT_TOKEN_RE = /^\d{1,20}:[A-Za-z0-9_-]{1,128}$/
/** A bot @username: 5-32 word chars ending in "bot" (Telegram's own rule). */
export const BOT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{1,28}bot$/i
/** setWebhook's secret_token alphabet. */
export const WEBHOOK_SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/
/** A Mini App short name. */
export const APP_NAME_RE = /^[A-Za-z0-9_]{3,32}$/

export interface TelegramConfig {
  token: string | null
  bot: string | null
  secret: string | null
  app: string | null
  loginWidget: boolean
}

type EnvLike = Record<string, string | undefined>

const read = (env: EnvLike, name: string, re: RegExp, strip?: RegExp): string | null => {
  let raw = (env[name] ?? '').trim()
  if (strip) raw = raw.replace(strip, '')
  return raw && re.test(raw) ? raw : null
}

/** A malformed value reads as unset: a `t.me/undefined` link or a webhook
 *  that accepts an empty secret is worse than a feature that says it is off. */
export function telegramConfig(env: EnvLike = process.env): TelegramConfig {
  return {
    token: read(env, 'TELEGRAM_BOT_TOKEN', BOT_TOKEN_RE),
    bot: read(env, 'TELEGRAM_BOT_NAME', BOT_NAME_RE, /^@/),
    secret: read(env, 'TELEGRAM_WEBHOOK_SECRET', WEBHOOK_SECRET_RE),
    app: read(env, 'TELEGRAM_APP_NAME', APP_NAME_RE),
    loginWidget: (env.TELEGRAM_LOGIN_WIDGET ?? '').trim() === '1',
  }
}

export interface TelegramStatus {
  /** Token AND bot name are set: identities can be verified and links built. */
  configured: boolean
  /** The bot's @username without the @ (public by nature), or null. */
  bot: string | null
  /** The join button opens the room inside Telegram (TELEGRAM_APP_NAME set). */
  miniApp: boolean
  /** The web Login Widget may render (the owner ran /setdomain and said so). */
  loginWidget: boolean
}

/** What a page may know about the bot. Never a secret. */
export function telegramStatus(env: EnvLike = process.env): TelegramStatus {
  const c = telegramConfig(env)
  const configured = !!(c.token && c.bot)
  return { configured, bot: configured ? c.bot : null, miniApp: configured && !!c.app, loginWidget: configured && c.loginWidget }
}

/** The first missing name among the ones a path needs, or null. */
export function missingEnv(cfg: TelegramConfig, needs: readonly ('token' | 'bot' | 'secret')[]): TelegramEnvName | null {
  const names: Record<'token' | 'bot' | 'secret', TelegramEnvName> = { token: 'TELEGRAM_BOT_TOKEN', bot: 'TELEGRAM_BOT_NAME', secret: 'TELEGRAM_WEBHOOK_SECRET' }
  for (const k of needs) if (!cfg[k]) return names[k]
  return null
}

/** The body of every "this deployment has no bot yet" refusal. */
export function unconfiguredBody(name: TelegramEnvName): { error: string; unconfigured: TelegramEnvName } {
  return { error: `Telegram is not set up on this deployment yet (${name} is unset).`, unconfigured: name }
}
