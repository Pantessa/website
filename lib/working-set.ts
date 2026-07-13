import prisma from '@/lib/db'

/// The saved per-wallet chat WORKING SET — the full active MCP set the wallet
/// last had on the bare /chat surface, so the set follows a signed-in user
/// across devices (the localStorage cache in store.walletSets is same-browser
/// only; this is its DB mirror). Distinct from the shortlist (a curated ≤3
/// default that seeds new chats): the working set has NO cap — it records
/// whatever the user toggled on. See model WalletWorkingSet + /api/working-set.

// Defensive bound on how many ids we'll even look at — far above any real
// working set (the whole catalog is ~70 services). Excess is ignored rather
// than 400'd: this is a cache write-through, not a user-facing form.
const MAX_IDS = 100

/** The wallet's saved working set as an ordered list of McpServer ids ([] if none). */
export async function getWorkingSet(ownerAddress: string): Promise<string[]> {
  const row = await prisma.walletWorkingSet.findUnique({
    where: { ownerAddress: ownerAddress.toLowerCase() },
    select: { serviceIds: true },
  })
  return row?.serviceIds ?? []
}

/**
 * Persist the wallet's working set. Sanitizes the input: de-dupes, preserves
 * order, and drops ids that aren't real McpServer rows (a stale cached id from
 * a deleted custom MCP must not ghost across devices). An empty list clears
 * the row. Returns the stored ids.
 */
export async function setWorkingSet(
  ownerAddress: string,
  ids: string[],
): Promise<string[]> {
  const addr = ownerAddress.toLowerCase()

  // De-dupe while preserving order.
  const unique = [
    ...new Set(ids.filter((x) => typeof x === 'string' && x.length > 0).slice(0, MAX_IDS)),
  ]

  // Keep only ids that correspond to real services, preserving the caller's order.
  let valid: string[] = unique
  if (unique.length > 0) {
    const rows = await prisma.mcpServer.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    })
    const known = new Set(rows.map((r) => r.id))
    valid = unique.filter((id) => known.has(id))
  }

  const stored = await prisma.walletWorkingSet.upsert({
    where: { ownerAddress: addr },
    create: { ownerAddress: addr, serviceIds: valid },
    update: { serviceIds: valid },
    select: { serviceIds: true },
  })
  return stored.serviceIds
}
