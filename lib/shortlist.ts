import prisma from '@/lib/db'

/// The saved per-wallet MCP shortlist — the 1–3 services a user wants to talk
/// to. Distinct from approvals (payment allowlist) and a chat's activeServerIds
/// (per-chat working set). This is the default that seeds a new chat. Empty =
/// no shortlist → current whole-catalog behavior. See model McpShortlist.

export const MAX_SHORTLIST = 3

/** The wallet's shortlist as an ordered list of McpServer ids ([] if none). */
export async function getShortlist(ownerAddress: string): Promise<string[]> {
  const row = await prisma.mcpShortlist.findUnique({
    where: { ownerAddress: ownerAddress.toLowerCase() },
    select: { serviceIds: true },
  })
  return row?.serviceIds ?? []
}

/**
 * Persist the wallet's shortlist. Sanitizes the input: de-dupes, preserves
 * order, drops ids that aren't real McpServer rows, and caps at MAX_SHORTLIST.
 * An empty list clears the shortlist (falls back to whole-catalog behavior).
 * Returns the stored ids. Throws `TOO_MANY` if more than MAX_SHORTLIST *valid*
 * ids are supplied, so the caller can 400 rather than silently truncate.
 */
export async function setShortlist(
  ownerAddress: string,
  ids: string[],
): Promise<string[]> {
  const addr = ownerAddress.toLowerCase()

  // De-dupe while preserving order.
  const unique = [...new Set(ids.filter((x) => typeof x === 'string' && x.length > 0))]

  // Keep only ids that correspond to real services (guards against stale/bogus
  // ids), preserving the caller's order.
  let valid: string[] = unique
  if (unique.length > 0) {
    const rows = await prisma.mcpServer.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    })
    const known = new Set(rows.map((r) => r.id))
    valid = unique.filter((id) => known.has(id))
  }

  if (valid.length > MAX_SHORTLIST) {
    throw new Error('TOO_MANY')
  }

  const stored = await prisma.mcpShortlist.upsert({
    where: { ownerAddress: addr },
    create: { ownerAddress: addr, serviceIds: valid },
    update: { serviceIds: valid },
    select: { serviceIds: true },
  })
  return stored.serviceIds
}
