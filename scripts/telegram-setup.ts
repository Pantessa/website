// OWNER SCRIPT — point a Telegram bot at this deployment (squad community,
// lane TELEGRAM, 2026-11-09). DRY by default: it prints what it would send.
//
//   TELEGRAM_BOT_TOKEN=… TELEGRAM_BOT_NAME=… TELEGRAM_WEBHOOK_SECRET=… \
//     npx tsx scripts/telegram-setup.ts                 # dry: prints the plan
//   … npx tsx scripts/telegram-setup.ts --apply         # calls Telegram
//   … npx tsx scripts/telegram-setup.ts --apply --site=https://staging.example.com
//   … npx tsx scripts/telegram-setup.ts --info          # getMe + getWebhookInfo only
//
// With --apply it calls, in order:
//   getMe           the token works, and the bot's username is TELEGRAM_BOT_NAME
//   setWebhook      <site>/api/telegram/webhook, the secret, three update kinds
//   setMyCommands   the group menu and the private menu (lib/telegram/commands)
//   getWebhookInfo  reads back what Telegram stored
//
// It never prints the token or the secret. What it CANNOT do is in the
// "BotFather" block it prints at the end (creating the bot, the Login
// Widget's domain, the Mini App's short name).

import { SITE_URL } from '../lib/site-url'
import { telegramCaller, type TgCall } from '../lib/telegram/client'
import { ALLOWED_UPDATES, groupCommands, privateCommands, webhookUrl } from '../lib/telegram/commands'
import { telegramConfig } from '../lib/telegram/config'

const arg = (name: string): string | null => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

function botFatherSteps(bot: string | null, site: string, app: string | null): string {
  const host = new URL(site).host
  return [
    '',
    'BotFather steps this script cannot do (open @BotFather in Telegram):',
    `  1. /newbot            create the bot. Its username becomes TELEGRAM_BOT_NAME${bot ? ` (now: ${bot})` : ''}; the token becomes TELEGRAM_BOT_TOKEN.`,
    `  2. /setdomain         choose the bot, send ${host}. Only for the web Login Widget; then set TELEGRAM_LOGIN_WIDGET=1.`,
    `  3. /newapp            choose the bot, Web App URL ${site}/tg, pick a short name. That short name is TELEGRAM_APP_NAME${app ? ` (now: ${app})` : ''}.`,
    '                        Optional: without it the join button opens the bot chat (two taps) instead of the room (one tap).',
    '  4. /setjoingroups     must be Enabled (it is by default), or the bot cannot be added to a group.',
    '  5. Privacy mode       leave it ON. Commands reach the bot in privacy mode. In a group with several bots,',
    '                        members pick the command from the menu (it sends /chart@<bot>), or the bot is an admin.',
    '',
  ].join('\n')
}

async function main() {
  const cfg = telegramConfig()
  const site = (arg('site') ?? SITE_URL).replace(/\/+$/, '')
  const apply = flag('apply')
  const info = flag('info')

  const missing = [!cfg.token && 'TELEGRAM_BOT_TOKEN', !cfg.bot && 'TELEGRAM_BOT_NAME', !cfg.secret && 'TELEGRAM_WEBHOOK_SECRET'].filter(Boolean)
  console.log(`site:    ${site}`)
  console.log(`bot:     ${cfg.bot ? `@${cfg.bot}` : '(TELEGRAM_BOT_NAME unset or malformed)'}`)
  console.log(`token:   ${cfg.token ? 'set' : '(TELEGRAM_BOT_TOKEN unset or malformed)'}`)
  console.log(`secret:  ${cfg.secret ? `set, ${cfg.secret.length} chars${cfg.secret.length < 24 ? ' (short: use `openssl rand -hex 32`)' : ''}` : '(TELEGRAM_WEBHOOK_SECRET unset or malformed)'}`)
  console.log(`miniapp: ${cfg.app ?? '(TELEGRAM_APP_NAME unset: the join button opens the bot chat)'}`)

  const plan = {
    setWebhook: { url: webhookUrl(site), secret_token: cfg.secret ? '<TELEGRAM_WEBHOOK_SECRET>' : '<unset>', allowed_updates: [...ALLOWED_UPDATES], max_connections: 20, drop_pending_updates: false },
    setMyCommandsGroups: { scope: { type: 'all_group_chats' }, commands: groupCommands() },
    setMyCommandsPrivate: { scope: { type: 'all_private_chats' }, commands: privateCommands() },
  }

  if (!apply && !info) {
    console.log('\nDRY RUN. With --apply this would send:\n')
    console.log(JSON.stringify(plan, null, 2))
    console.log(botFatherSteps(cfg.bot, site, cfg.app))
    if (missing.length) console.log(`Not ready: ${missing.join(', ')}.`)
    return
  }

  if (missing.length || !cfg.token || !cfg.bot || !cfg.secret) throw new Error(`Not ready: ${missing.join(', ')}.`)
  if (!site.startsWith('https://')) throw new Error('Telegram only calls an https webhook. Pass --site=https://…')

  const call: TgCall = telegramCaller(cfg.token, fetch, 15_000)
  const must = async (label: string, method: Parameters<TgCall>[0], params: Record<string, unknown>) => {
    const r = await call(method, params)
    if (!r.ok) throw new Error(`${label} refused: ${r.errorCode ?? ''} ${r.description ?? ''}`.trim())
    console.log(`ok  ${label}`)
    return r.result
  }

  const me = (await must('getMe', 'getMe', {})) as { username?: string; can_join_groups?: boolean; can_read_all_group_messages?: boolean }
  if ((me.username ?? '').toLowerCase() !== cfg.bot.toLowerCase()) throw new Error(`TELEGRAM_BOT_NAME is ${cfg.bot} but this token belongs to @${me.username}. Fix the env before going on.`)
  if (me.can_join_groups === false) console.log('    ! this bot cannot join groups: BotFather /setjoingroups → Enable')
  console.log(`    privacy mode: ${me.can_read_all_group_messages ? 'OFF (the bot reads every group message; not needed)' : 'on (commands still reach it)'}`)

  if (apply) {
    await must('setWebhook', 'setWebhook', { ...plan.setWebhook, secret_token: cfg.secret })
    await must('setMyCommands (groups)', 'setMyCommands', plan.setMyCommandsGroups)
    await must('setMyCommands (private)', 'setMyCommands', plan.setMyCommandsPrivate)
  }

  const hook = (await must('getWebhookInfo', 'getWebhookInfo', {})) as { url?: string; pending_update_count?: number; last_error_message?: string; allowed_updates?: string[] }
  console.log(`    webhook: ${hook.url || '(none)'}`)
  console.log(`    pending: ${hook.pending_update_count ?? 0}${hook.last_error_message ? `, last error: ${hook.last_error_message}` : ''}`)
  console.log(`    updates: ${(hook.allowed_updates ?? []).join(', ') || '(Telegram default)'}`)
  console.log(botFatherSteps(cfg.bot, site, cfg.app))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
