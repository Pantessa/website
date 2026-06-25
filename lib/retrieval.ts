// R2 — hybrid retrieval for routing. Fuses the lexical keyword rank
// (lib/router.rankByKeyword) with pgvector semantic search (OpenAI query
// embedding) via Reciprocal Rank Fusion, so the right MCP surfaces even with
// zero keyword overlap ("transcribe audio" → Deepgram). Falls back to
// keyword-only when OPENAI_API_KEY is absent or the vector query fails — the
// router never breaks on a missing embedding.

import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { capShortlist, rankByKeyword } from '@/lib/router'
import type { PlannableEndpoint } from '@/lib/endpoint-planner'
import { embedOne, hasOpenAI } from '@/lib/embeddings'

const RRF_K = 60 // standard RRF damping
const VECTOR_TOPK = 50

/**
 * The shortlist the planner sees: hybrid (keyword ∪ vector) → ≤3/service → top
 * `limit`. Async (embeds the query). Safe fallback to keyword-only.
 */
export async function hybridShortlist(
  message: string,
  endpoints: PlannableEndpoint[],
  limit = 14,
): Promise<PlannableEndpoint[]> {
  const keywordRanked = rankByKeyword(message, endpoints) // excludes inference
  if (!hasOpenAI() || endpoints.length === 0) return capShortlist(keywordRanked, limit)

  const qvec = await embedOne(message)
  if (!qvec) return capShortlist(keywordRanked, limit)

  // Vector search restricted to THIS turn's plannable, non-inference candidates.
  const candidateIds = endpoints.filter((e) => e.category !== 'Inference').map((e) => e.id)
  if (candidateIds.length === 0) return capShortlist(keywordRanked, limit)

  let vectorIds: string[] = []
  try {
    const lit = `[${qvec.join(',')}]`
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM mcp_endpoints
      WHERE id IN (${Prisma.join(candidateIds)}) AND embedding IS NOT NULL
      ORDER BY embedding <=> ${lit}::vector
      LIMIT ${VECTOR_TOPK}`
    vectorIds = rows.map((r) => r.id)
  } catch {
    return capShortlist(keywordRanked, limit) // vector unavailable → keyword only
  }
  if (vectorIds.length === 0) return capShortlist(keywordRanked, limit)

  // Reciprocal Rank Fusion: an endpoint ranked well by EITHER signal rises;
  // one ranked well by BOTH rises most. Parameter-light + robust to scale
  // differences between BM25-ish keyword scores and cosine similarity.
  const fused = new Map<string, number>()
  keywordRanked.forEach((e, i) => fused.set(e.id, (fused.get(e.id) ?? 0) + 1 / (RRF_K + i)))
  vectorIds.forEach((id, i) => fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + i)))

  const byId = new Map(endpoints.map((e) => [e.id, e]))
  const ranked = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id))
    .filter((e): e is PlannableEndpoint => !!e && e.category !== 'Inference')

  return capShortlist(ranked, limit)
}
