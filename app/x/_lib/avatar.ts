// An X avatar, fetched by the SERVER and handed to the page or the share
// image as a data URI (squad called-it, lane RECORD). A visitor's browser
// never asks X for it, and the server only ever asks one of X's two image
// hosts (lib/called-it/card-layout avatarFetchUrl: https, the host exactly, no
// port, no credentials), follows no redirect, waits two seconds, takes a
// small JPEG/PNG/GIF and nothing else. Every miss is a null: the caller draws
// the account's initial instead.
import { AVATAR_MAX_BYTES, AVATAR_TIMEOUT_MS, AVATAR_TYPES, avatarFetchUrl } from '@/lib/called-it/card-layout'

const HIT_TTL_MS = 60 * 60_000
const MISS_TTL_MS = 5 * 60_000
const MAX_ENTRIES = 200

const memo = new Map<string, { at: number; uri: string | null }>()
const inflight = new Map<string, Promise<string | null>>()

async function fetchAvatar(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS), headers: { accept: 'image/jpeg,image/png,image/gif' } })
    if (res.status !== 200) return null
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!AVATAR_TYPES.has(type)) return null
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > AVATAR_MAX_BYTES) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > AVATAR_MAX_BYTES) return null
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** The avatar as a data URI, or null (not one of X's image hosts, slow, missing, too big, not an image). Held an hour per process. */
export async function avatarDataUri(raw: string | null | undefined): Promise<string | null> {
  const url = avatarFetchUrl(raw)
  if (!url) return null
  const hit = memo.get(url)
  if (hit && Date.now() - hit.at < (hit.uri ? HIT_TTL_MS : MISS_TTL_MS)) return hit.uri
  const running = inflight.get(url)
  if (running) return running
  const p = fetchAvatar(url)
    .then((uri) => {
      if (memo.size >= MAX_ENTRIES) {
        const oldest = memo.keys().next().value
        if (oldest !== undefined) memo.delete(oldest)
      }
      memo.set(url, { at: Date.now(), uri })
      return uri
    })
    .finally(() => inflight.delete(url))
  inflight.set(url, p)
  return p
}
