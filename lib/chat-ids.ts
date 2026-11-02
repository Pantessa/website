// Chat id provenance. DB chat rows carry Prisma cuids ('c' + 24 base36
// chars); guest/ephemeral chats get short random base36 ids minted
// client-side (lib/store's localId). Persistence calls must gate on THIS,
// not on authedAddress alone: a SIWE session that settles MID-turn flips
// authedAddress after a local chat was already minted, and every
// /api/chats/<localId>/* call then 404s (observed live on /i 2026-07-22).
// Local chats are intentionally ephemeral — skip the write, don't retry.

/** True when the id has the shape of a real DB chat row (Prisma cuid). */
export const isDbChatId = (id: string) => /^c[a-z0-9]{20,}$/.test(id)

/**
 * Where a chat lives in the address bar. A DB thread has an address of its
 * own, /chat/<id>: an open thread, the signed-in app's (lib/app-entry
 * isPublicAppPath — the spine's gate sends a signed-out visitor home from
 * it, AppSpine). A LOCAL thread has none: it lives on the bare /chat, which
 * is public to look at (#978) and where the guest trial answers
 * (lib/guest-trial, "Ask anything — no wallet needed"). The first send used
 * to write /chat/<localId> for a guest too; the gate read that as an open
 * thread and sent them home mid-send, answer unseen (2026-10-20,
 * scripts/guest-chat-drive.mjs). The KEEP moment (lib/store adoptLocalChat)
 * gives an adopted thread its address.
 */
export const chatHrefFor = (id: string) => (isDbChatId(id) ? `/chat/${id}` : '/chat')
