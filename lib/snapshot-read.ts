// Free, read-only Snapshot hub access used by the chat orchestrator to RESOLVE a
// proposal reference into an id before the (paid) prepare_vote call. Resolution
// reads are free public data — only the typed-data construction is monetized
// through the snapshot MCP, so we don't charge the user twice to find a proposal.

const HUB = process.env.SNAPSHOT_HUB_URL ?? 'https://hub.snapshot.org'

export interface ActiveProposal {
  id: string
  title: string
  space: { id: string; name: string }
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${HUB}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  })
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (body.errors?.length) throw new Error(body.errors[0].message)
  if (!body.data) throw new Error('Snapshot returned no data')
  return body.data
}

/** Active proposals, optionally scoped to one space. Most recent first. */
export async function listActiveProposals(space?: string, first = 20): Promise<ActiveProposal[]> {
  const where: Record<string, unknown> = { state: 'active' }
  if (space) where.space_in = [space]
  const data = await gql<{ proposals: ActiveProposal[] }>(
    `query ($first: Int!, $where: ProposalWhere) {
      proposals(first: $first, orderBy: "created", orderDirection: desc, where: $where) {
        id title space { id name }
      }
    }`,
    { first, where },
  )
  return data.proposals ?? []
}

/**
 * Resolve a vote target to a single proposal id.
 * Returns { id } on success, or { candidates } when it can't pick one.
 */
export async function resolveProposal(opts: {
  proposalId?: string
  spaceHint?: string
  titleHint?: string
}): Promise<{ id: string } | { candidates: ActiveProposal[] }> {
  if (opts.proposalId) return { id: opts.proposalId }

  const active = await listActiveProposals(opts.spaceHint)
  if (active.length === 0) return { candidates: [] }
  if (active.length === 1) return { id: active[0].id }

  if (opts.titleHint) {
    const needle = opts.titleHint.toLowerCase()
    const hits = active.filter((p) => p.title.toLowerCase().includes(needle))
    if (hits.length === 1) return { id: hits[0].id }
  }
  return { candidates: active }
}
