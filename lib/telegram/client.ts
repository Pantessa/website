// THE ONE OUTBOUND DOOR to Telegram's Bot API (lane TELEGRAM, 2026-11-09).
// Every call the app ever makes to api.telegram.org goes through
// `telegramCaller(token, fetchImpl)`: the pins hand it a recording fetch, the
// routes hand it nothing (global fetch).
//
// Best-effort by contract: resolves a result, never throws. The token rides
// only in the request URL; it is never logged, and neither is a response
// body beyond Telegram's own short `description`.

const BOT_API = 'https://api.telegram.org'
export const TG_CALL_TIMEOUT_MS = 5_000

/** The methods this app calls. Anything else is refused before a socket opens. */
export const TG_METHODS = ['sendMessage', 'getChatMember', 'pinChatMessage', 'answerCallbackQuery', 'getMe', 'setWebhook', 'getWebhookInfo', 'deleteWebhook', 'setMyCommands'] as const
export type TgMethod = (typeof TG_METHODS)[number]

export interface TgResult {
  ok: boolean
  result?: unknown
  /** Telegram's error_code (or the HTTP status when the body was not JSON). 0 = the call never reached Telegram. */
  errorCode?: number
  description?: string
}

export type TgCall = (method: TgMethod, params: Record<string, unknown>) => Promise<TgResult>

export function telegramCaller(token: string, fetchImpl: typeof fetch = globalThis.fetch, timeoutMs = TG_CALL_TIMEOUT_MS): TgCall {
  return async (method, params) => {
    if (!token || !(TG_METHODS as readonly string[]).includes(method)) return { ok: false, errorCode: 0, description: 'refused before sending' }
    try {
      const res = await fetchImpl(`${BOT_API}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      })
      const body = (await res.json().catch(() => null)) as { ok?: unknown; result?: unknown; error_code?: unknown; description?: unknown } | null
      if (res.ok && body?.ok === true) return { ok: true, result: body.result }
      const out: TgResult = {
        ok: false,
        errorCode: typeof body?.error_code === 'number' ? body.error_code : res.status,
        description: typeof body?.description === 'string' ? body.description.slice(0, 200) : undefined,
      }
      console.warn(`[telegram] ${method} refused: ${out.errorCode} ${out.description ?? ''}`.trim())
      return out
    } catch (e) {
      // A fetch error's message can carry the request URL (and so the token) on some runtimes: log its NAME only.
      console.warn(`[telegram] ${method} did not reach Telegram (${e instanceof Error ? e.name : 'error'})`)
      return { ok: false, errorCode: 0, description: 'network' }
    }
  }
}

/** The chat is gone for this bot: it was removed, blocked, or the chat no
 *  longer exists under that id. The caller unlinks; nothing else retries. */
export function chatIsGone(r: TgResult): boolean {
  if (r.ok) return false
  const d = (r.description ?? '').toLowerCase()
  if (r.errorCode === 403) return true
  return r.errorCode === 400 && (d.includes('chat not found') || d.includes('group chat was upgraded') || d.includes('chat was deactivated') || d.includes('bot was kicked'))
}

/** getChatMember → may this user link the chat? creator or administrator only. */
export function isChatAdmin(r: TgResult): boolean {
  if (!r.ok || !r.result || typeof r.result !== 'object') return false
  const status = (r.result as { status?: unknown }).status
  return status === 'creator' || status === 'administrator'
}
