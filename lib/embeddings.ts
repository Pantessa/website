// Embeddings for semantic routing (R2). OpenAI text-embedding-3-small (1536-dim).
// Embeddings ≠ inference — this only turns text into vectors for similarity;
// chat/answers stay on Claude. Shared by the catalog embed script and the
// query-time retriever so the text recipe stays consistent.

export const EMBED_MODEL = 'text-embedding-3-small'
export const EMBED_DIM = 1536

export function hasOpenAI(): boolean {
  return !!process.env.OPENAI_API_KEY
}

/** The text we embed for one endpoint — capability-forward (tags + examples
 *  carry the most retrieval signal), then description + path. */
export function endpointText(r: {
  name: string
  tags: string[] | null
  example_queries: string[] | null
  category: string | null
  description: string | null
  url: string
}): string {
  let path = ''
  try {
    path = new URL(r.url).pathname.replace(/[^a-zA-Z]+/g, ' ').trim()
  } catch {
    /* ignore */
  }
  const tags = (r.tags ?? []).join(', ')
  const examples = (r.example_queries ?? []).join(' ')
  return [`${r.name}${tags ? ` (${tags})` : ''}.`, examples, r.description ?? '', r.category ?? '', path]
    .filter(Boolean)
    .join(' ')
    .slice(0, 2000)
}

/** Embed a batch of strings via OpenAI; returns vectors in input order. */
export async function embed(inputs: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  })
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { data: { embedding: number[]; index: number }[] }
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

/** Embed a single string → vector (or null on failure/no key). */
export async function embedOne(input: string): Promise<number[] | null> {
  if (!hasOpenAI()) return null
  try {
    return (await embed([input]))[0] ?? null
  } catch {
    return null
  }
}
