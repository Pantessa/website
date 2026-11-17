// An X avatar, fetched by the SERVER and handed to the page or the share
// image as a data URI (squad called-it, lane RECORD). A visitor's browser
// never asks X for it, and the server only ever asks one of X's two image
// hosts (lib/called-it/card-layout avatarFetchUrl: https, the host exactly, no
// port, no credentials), follows no redirect (only a plain 200 is an avatar),
// waits two seconds in all, takes a small JPEG/PNG/GIF and nothing else.
// Every miss is a null: the caller draws the account's initial instead.
//
// node:https, not fetch, on purpose: the door page (/x) is cached, and inside
// a cached page the framework's fetch refuses an uncached read ("Page changed
// from static to dynamic at runtime") — which a catch here would turn into a
// silent missing avatar on every listed row. This request is nobody's cache
// entry: what it returns is held below, an hour per process.
import { request } from 'node:https'
import { AVATAR_MAX_BYTES, AVATAR_TIMEOUT_MS, AVATAR_TYPES, avatarFetchUrl } from '@/lib/called-it/card-layout'

const HIT_TTL_MS = 60 * 60_000
const MISS_TTL_MS = 5 * 60_000
const MAX_ENTRIES = 200

const memo = new Map<string, { at: number; uri: string | null }>()
const inflight = new Map<string, Promise<string | null>>()

function fetchAvatar(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (uri: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(uri)
    }
    let u: URL
    try {
      u = new URL(url)
    } catch {
      resolve(null)
      return
    }
    const req = request({ protocol: 'https:', hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', headers: { accept: 'image/jpeg,image/png,image/gif' } })
    req.on('response', (res) => {
      const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      // A redirect is never followed, and a body that is not a small image is never read to the end.
      if (res.statusCode !== 200 || !AVATAR_TYPES.has(type) || Number(res.headers['content-length'] ?? 0) > AVATAR_MAX_BYTES) {
        res.resume()
        req.destroy()
        finish(null)
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > AVATAR_MAX_BYTES) {
          req.destroy()
          finish(null)
        } else chunks.push(chunk)
      })
      res.on('end', () => finish(size > 0 ? `data:${type};base64,${Buffer.concat(chunks).toString('base64')}` : null))
      res.on('error', () => finish(null))
    })
    // Two seconds for the whole exchange, not per socket event.
    const timer = setTimeout(() => {
      req.destroy()
      finish(null)
    }, AVATAR_TIMEOUT_MS)
    req.on('error', () => finish(null))
    req.end()
  })
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
