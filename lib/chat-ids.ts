// Chat id provenance. DB chat rows carry Prisma cuids ('c' + 24 base36
// chars); guest/ephemeral chats get short random base36 ids minted
// client-side (lib/store's localId). Persistence calls must gate on THIS,
// not on authedAddress alone: a SIWE session that settles MID-turn flips
// authedAddress after a local chat was already minted, and every
// /api/chats/<localId>/* call then 404s (observed live on /i 2026-07-22).
// Local chats are intentionally ephemeral — skip the write, don't retry.

/** True when the id has the shape of a real DB chat row (Prisma cuid). */
export const isDbChatId = (id: string) => /^c[a-z0-9]{20,}$/.test(id)
