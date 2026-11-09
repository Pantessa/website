// Pure + client-safe (QA-SECURITY-2 T1). Pinned by scripts/community-coord-pins.ts.
/** Is this page inside one of Telegram's own apps? The bridges the native
 *  clients inject (iOS / Android / macOS: `TelegramWebviewProxy`; Telegram
 *  Desktop: `window.external.notify`) are the only signal a link cannot forge:
 *  `platform`, `version` and the launch data itself all come from the URL. */
export function inTelegramApp(w: { TelegramWebviewProxy?: unknown; external?: unknown; parent?: unknown; self?: unknown }): boolean {
  if (w.parent !== undefined && w.self !== undefined && w.parent !== w.self) return false // framed: no cookie would be kept (Lax)
  if (w.TelegramWebviewProxy !== undefined && w.TelegramWebviewProxy !== null) return true
  const ext = w.external as { notify?: unknown } | null | undefined
  return !!ext && typeof ext === 'object' && typeof ext.notify === 'function'
}
