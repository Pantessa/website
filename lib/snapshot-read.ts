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

export interface SpaceRef {
  id: string
  name: string
}

/**
 * Resolve a DAO/space REFERENCE (a name like "Nate DAO", or an id like
 * "nategeier.dcl.eth") to a concrete space id. Names are looked up via the hub's
 * `ranking` search; an input that already looks like an id (has a dot / .eth) is
 * verified directly. Returns the best match, or null if nothing fits.
 */
export async function resolveSpaceByName(query: string): Promise<SpaceRef | null> {
  const q = query.trim()
  if (!q) return null

  const idLike = /\.(eth|xyz|io|com|org|dao)$|\w+\.\w+/.test(q)

  // Looks like a space id already (ENS-style or has a dot) → verify directly.
  if (idLike) {
    try {
      const data = await gql<{ space: SpaceRef | null }>(
        `query ($id: String!) { space(id: $id) { id name } }`,
        { id: q },
      )
      if (data.space?.id) return data.space
    } catch {
      /* fall through to search */
    }
  }

  // Name search via the explore ranking. An id-looking input that didn't resolve
  // directly (e.g. "aave.eth" when the live space is "aavedao.eth") is searched by
  // its base label too — the ranking search treats the ".eth" suffix literally and
  // would otherwise return nothing.
  const base = idLike ? q.split('.')[0] : ''
  const terms = base && base.toLowerCase() !== q.toLowerCase() ? [q, base] : [q]
  for (const term of terms) {
    try {
      const data = await gql<{ ranking: { items: SpaceRef[] } }>(
        `query ($search: String) { ranking(first: 8, where: { search: $search }) { items { id name } } }`,
        { search: term },
      )
      const items = data.ranking?.items ?? []
      if (items.length === 0) continue
      const needle = q.toLowerCase()
      const baseNeedle = base.toLowerCase()
      // Prefer an exact name/id match, then a base-label match, else top-ranked.
      return (
        items.find((s) => s.name?.toLowerCase() === needle || s.id?.toLowerCase() === needle) ??
        (base
          ? items.find(
              (s) => s.name?.toLowerCase() === baseNeedle || s.id?.toLowerCase().startsWith(baseNeedle),
            )
          : undefined) ??
        items[0]
      )
    } catch {
      /* try next term */
    }
  }
  return null
}

export interface ProposalResults {
  id: string
  title: string
  state: string
  type: string
  choices: string[]
  scores: number[]
  scoresTotal: number
}

/** Live tally for one proposal — choices + per-choice scores + total. */
export async function getProposalResults(id: string): Promise<ProposalResults | null> {
  const data = await gql<{ proposal: (ProposalResults & { scores_total: number }) | null }>(
    `query ($id: String!) {
      proposal(id: $id) { id title state type choices scores scores_total }
    }`,
    { id },
  )
  const p = data.proposal
  if (!p) return null
  return {
    id: p.id, title: p.title, state: p.state, type: p.type,
    choices: p.choices ?? [], scores: p.scores ?? [], scoresTotal: p.scores_total ?? 0,
  }
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
