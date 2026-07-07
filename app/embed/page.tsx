import EmbedChat from '@/components/EmbedChat'

// The embeddable chat route — third-party sites iframe this (frame-ancestors *
// is set for /embed in next.config.ts; contract + params in /docs/embed).
// Reading searchParams opts the route out of static rendering, which is
// correct: the MCP scope / address / host differ per embedding page.
export default async function EmbedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const mcps = (one(sp.mcps) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return (
    <EmbedChat
      mcps={mcps}
      address={one(sp.address)}
      theme={one(sp.theme)}
      host={one(sp.host)}
      embedKey={one(sp.key)}
      page={one(sp.page)}
    />
  )
}
