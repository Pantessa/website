import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public "proof" feed for the /switchboard page — real routed chat turns shown
 * in the open: the question asked, the answer Switchboard returned, and the
 * on-chain tx(es) for each paid call. Grouped per turn, so a single question
 * shows every call it triggered (e.g. a Snapshot data fetch + an inference
 * phrasing call). Only SETTLED calls with a txHash are included — witnessed,
 * not self-reported.
 */
interface RawRow {
  id: string
  prompt: string | null
  answer: string
  created_at: Date
  calls: { service: string | null; price: string | null; txHash: string | null }[]
}

/** Drop our appended UI scaffolding (ℹ️ Not called…, ⚙️ Diagnostics, 💸 …). */
function cleanAnswer(s: string): string {
  return s.split(/\n\n(?:ℹ️|⚙️|💸)/)[0].trim().slice(0, 320)
}

export async function GET() {
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      a.id,
      (SELECT u.content FROM messages u
         WHERE u.chat_id = a.chat_id AND u.role = 'user' AND u.created_at < a.created_at
         ORDER BY u.created_at DESC LIMIT 1) AS prompt,
      a.content AS answer,
      a.created_at,
      jsonb_agg(jsonb_build_object(
        'service', r.value->>'name',
        'price',   r.value->>'priceUsd',
        'txHash',  r.value->>'txHash'
      ) ORDER BY (r.value->>'priceUsd')::float DESC) AS calls,
      -- a turn that called a non-inference service actually fetched live DATA —
      -- the strongest proof, so it leads the feed.
      bool_or(r.value->>'name' NOT IN
        ('ChatGPT', 'Claude', 'DeepSeek', 'Google Gemini', 'Yeetful · Claude', 'Yeetful · GPT')
      ) AS has_data
    FROM messages a
    CROSS JOIN LATERAL jsonb_array_elements(a.meta->'receipts') AS r(value)
    WHERE a.role = 'assistant'
      AND (r.value->>'ok')::boolean IS TRUE
      AND r.value->>'txHash' IS NOT NULL
    GROUP BY a.id, a.chat_id, a.content, a.created_at
    ORDER BY has_data DESC, a.created_at DESC
    LIMIT 8`

  const items = rows
    .filter((r) => r.prompt && r.prompt.trim())
    .map((r) => ({
      id: r.id,
      prompt: r.prompt!.slice(0, 200),
      answer: cleanAnswer(r.answer),
      createdAt: r.created_at,
      calls: r.calls
        .filter((c) => c.txHash)
        .map((c) => ({ service: c.service ?? 'unknown', priceUsd: c.price ?? '0', txHash: c.txHash! })),
    }))
    .filter((r) => r.calls.length > 0)

  return NextResponse.json(
    { items },
    { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } },
  )
}
