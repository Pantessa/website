import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { TELEGRAM_CODE_TTL_MS, mintTelegramCode, telegramBotName, telegramEnabled, telegramStartUrl, telegramStatus, unlinkTelegram } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// /api/alerts/telegram — the owner's Telegram link (squad five-million, PERPS).
// Owner-gated like /api/alerts (SIWE session or a yf_ key).
//   GET    → { enabled, bot, linked, chats }
//   POST   → mints a single-use /start code → { url, expiresInSec }
//            (503 by name when the server has no bot)
//   DELETE → unlinks every chat → { ok, removed }

export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const status = await telegramStatus(addr)
  return NextResponse.json({ enabled: telegramEnabled() && !!telegramBotName(), bot: telegramBotName(), ...status }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const bot = telegramBotName()
  if (!telegramEnabled() || !bot) {
    return NextResponse.json({ error: 'Telegram alerts are not configured on this server (TELEGRAM_BOT_TOKEN + TELEGRAM_BOT_NAME).' }, { status: 503 })
  }
  const { code, expiresAt } = await mintTelegramCode(addr)
  return NextResponse.json({ url: telegramStartUrl(bot, code), bot, expiresInSec: Math.round(TELEGRAM_CODE_TTL_MS / 1000), expiresAt: expiresAt.toISOString() }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const removed = await unlinkTelegram({ owner: addr })
  return NextResponse.json({ ok: true, removed })
}
