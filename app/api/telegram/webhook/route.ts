import { NextRequest, NextResponse } from 'next/server'
import { isInternalRun } from '@/lib/internal-run'
import { missingEnv, telegramConfig, unconfiguredBody } from '@/lib/telegram/config'
import { handleUpdate } from '@/lib/telegram/handler'
import { parseJsonObject, readCapped, secretHeaderOk, WEBHOOK_BODY_MAX } from '@/lib/telegram/request'
import { botDeps } from '@/lib/telegram/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

// POST /api/telegram/webhook — the community bot's inbox (squad community,
// lane TELEGRAM). Telegram calls it with every update once the owner ran
// scripts/telegram-setup.ts (setWebhook with a `secret_token`).
//
//   1. no TELEGRAM_WEBHOOK_SECRET on this deployment → 503, by name. FAIL
//      CLOSED: a webhook with no secret would take orders from anyone.
//   2. the SAME secret must arrive in X-Telegram-Bot-Api-Secret-Token or the
//      request is refused 401 before a byte of the body is read.
//   3. the body is capped and parsed defensively; junk is a quiet 200 (a
//      non-2xx makes Telegram retry the same update for a day).
//   4. lib/telegram/handler decides. One message that is the whole answer
//      rides THIS response as a Bot API method call; nothing is sent out.
//
// Nothing here logs the token, the secret, or an update's contents.

export async function POST(req: NextRequest) {
  const cfg = telegramConfig()
  if (!cfg.secret) return NextResponse.json(unconfiguredBody('TELEGRAM_WEBHOOK_SECRET'), { status: 503 })
  if (!secretHeaderOk(req.headers.get('x-telegram-bot-api-secret-token'), cfg.secret)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  const missing = missingEnv(cfg, ['token', 'bot'])
  if (missing) return NextResponse.json(unconfiguredBody(missing), { status: 503 })

  const text = await readCapped(req, WEBHOOK_BODY_MAX)
  if (text === null) return NextResponse.json({ error: 'Update too large.' }, { status: 413 })
  const update = parseJsonObject(text)
  const deps = botDeps({ isInternal: isInternalRun(req.headers), cfg })
  if (!update || !deps) return NextResponse.json({ ok: true }, { headers: { 'x-pt-action': 'ignored' } })

  const outcome = await handleUpdate(update, deps)
  return NextResponse.json(outcome.reply ?? { ok: true }, { headers: { 'x-pt-action': outcome.action, 'cache-control': 'no-store' } })
}
