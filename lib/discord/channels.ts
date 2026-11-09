// A room's own Discord channels, server-only (lane DISCORD).
//
// The settings panel lists them by title and the unlink route picks one of
// them; the external id always comes from THIS read of the room's own rows,
// never from a request body, so a body can never unlink another room's
// channel. The secret is read only to say whether one exists; it never leaves.
// (Ask for CORE: a `channelsOf(slug, platform)` in lib/community/store would
// replace this read; the shape below is what it should answer.)
import prisma from '@/lib/db'

import type { RoomChannel } from './pick'
export type { RoomChannel } from './pick'

export async function roomDiscordChannels(slug: string): Promise<RoomChannel[]> {
  const rows = await prisma.communityChannel.findMany({
    where: { communitySlug: slug, platform: 'discord' },
    select: { externalId: true, title: true, secret: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  })
  return rows.map((r) => ({ externalId: r.externalId, title: r.title, webhook: !!r.secret }))
}
