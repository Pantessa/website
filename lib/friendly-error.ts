// What a caught error may say on screen (pre-gtm POLISH r3). A server's own
// refusal ("That handle is taken") is already words and passes through; the
// browser's transport errors ("Failed to fetch", "Load failed",
// "NetworkError when attempting to fetch resource.") and parser noise
// ("Unexpected token < in JSON…") never reach a stranger — they get the
// caller's fallback, or one plain line about the connection.

const TRANSPORT = /failed to fetch|load failed|networkerror|network request failed|the internet connection appears to be offline|err_|econn|etimedout|aborted|timed? ?out/i
const NOISE = /unexpected token|json|is not a function|cannot read propert|undefined|null|\[object |^\s*\d{3}\s*$|^http \d{3}/i

export const CONNECTION_LINE = 'Couldn’t reach Pantessa. Check your connection and try again.'

export function friendlyError(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  if (!msg.trim()) return fallback
  if (TRANSPORT.test(msg)) return CONNECTION_LINE
  if (NOISE.test(msg) || msg.length > 220) return fallback
  return msg
}
