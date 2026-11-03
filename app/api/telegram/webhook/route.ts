import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { TELEGRAM_REPLIES, linkTelegramChat, parseTelegramUpdate, sendTelegram, telegramCommand, unlinkTelegram } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/telegram/webhook — the bot's inbox (squad five-million, PERPS).
// Telegram calls it with every update once the owner ran setWebhook with a
// `secret_token`; the SAME token must arrive in X-Telegram-Bot-Api-Secret-Token
// or the request is refused 401 before the body is read. Three verbs:
//   /start <code>  bind this chat to the owner behind the code (single-use,
//                  15 min — lib/telegram linkTelegramChat)
//   /stop          unlink this chat
//   anything else  one line of help
// Always 200 to Telegram once authenticated (a non-2xx makes it retry the
// same update for a day); the reply to the chat is best-effort.

function secretMatches(got: string | null): boolean {
  const want = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!want || !got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  const update = await req.json().catch(() => null)
  const inbound = parseTelegramUpdate(update)
  if (!inbound) return NextResponse.json({ ok: true, action: 'ignored' })

  const command = telegramCommand(inbound.text)
  let action: 'linked' | 'refused' | 'unlinked' | 'help' = 'help'
  let reply: string = TELEGRAM_REPLIES.help
  if (command.cmd === 'start' && command.code) {
    const r = await linkTelegramChat(command.code, inbound.chatId).catch(() => ({ ok: false as const, reason: 'unknown' as const }))
    if (r.ok) {
      action = 'linked'
      reply = TELEGRAM_REPLIES.linked
    } else {
      action = 'refused'
      reply = TELEGRAM_REPLIES.badCode
    }
  } else if (command.cmd === 'stop') {
    const removed = await unlinkTelegram({ chatId: inbound.chatId }).catch(() => 0)
    action = 'unlinked'
    reply = removed > 0 ? TELEGRAM_REPLIES.unlinked : TELEGRAM_REPLIES.nothingToUnlink
  }
  void sendTelegram(inbound.chatId, reply)
  return NextResponse.json({ ok: true, action })
}
