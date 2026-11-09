// Pure: which of a room's own Discord channels a request means (lane DISCORD).

export interface RoomChannel {
  externalId: string
  title: string | null
  /** true = announced through a stored webhook; false = linked by `/pantessa link`, needs the bot token. */
  webhook: boolean
}

/** Which of a room's channels a DELETE means. Pure; pinned. */
export function pickChannelToUnlink(rows: RoomChannel[], title: unknown): RoomChannel | null {
  if (typeof title === 'string' && title.trim()) return rows.find((r) => r.title === title.trim()) ?? null
  return rows.length === 1 ? rows[0] : null
}
