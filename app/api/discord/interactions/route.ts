// POST /api/discord/interactions — Discord's HTTP interactions endpoint (lane DISCORD).
//
// The raw body is read as text and capped BEFORE any parse; the Ed25519
// signature is checked over `timestamp + rawBody` with DISCORD_PUBLIC_KEY.
// A bad or missing signature is 401 (Discord probes this when the endpoint
// URL is saved). Unset key = 503 naming DISCORD_PUBLIC_KEY. Only after the
// signature holds is the payload parsed and handed to the pure handler.
import { NextResponse } from 'next/server'
import { verifyDiscordSignature } from '@/lib/discord/verify'
import { handleInteraction, type InteractionDeps } from '@/lib/discord/interactions'
import { discordPublicKey } from '@/lib/discord/env'
import { SITE_URL } from '@/lib/site-url'
import { communityOfChannel, listFeed, listMembers, redeemLinkCode } from '@/lib/community/store'
import { resolveChartPair } from '@/lib/charts'
import { readQuotes } from '@/lib/quotes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 10

const MAX_BODY = 64 * 1024

const deps: InteractionDeps = {
  site: SITE_URL,
  communityOfChannel: (id) => communityOfChannel('discord', id),
  listFeed: (q) => listFeed(q),
  listMembers: (slug, opts) => listMembers(slug, opts),
  redeemLinkCode: (code, chat) => redeemLinkCode(code, 'discord', chat),
  chartQuote: async (symbol) => {
    const pair = await resolveChartPair(symbol)
    if (!pair) return null
    const { quotes } = await readQuotes([pair.symbol])
    const q = quotes[pair.symbol] ?? Object.values(quotes)[0]
    return { symbol: pair.symbol, label: pair.label, last: q?.last ?? null, chgPct: q?.chgPct ?? null }
  },
}

export async function POST(req: Request) {
  const key = discordPublicKey()
  if (!key) return NextResponse.json({ error: 'Discord is not connected yet: DISCORD_PUBLIC_KEY is not set.', unconfigured: 'DISCORD_PUBLIC_KEY' }, { status: 503 })
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY) return NextResponse.json({ error: 'Body too large.' }, { status: 413 })
  const raw = await req.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) return NextResponse.json({ error: 'Body too large.' }, { status: 413 })
  const ok = verifyDiscordSignature(key, req.headers.get('x-signature-ed25519'), req.headers.get('x-signature-timestamp'), raw)
  if (!ok) return NextResponse.json({ error: 'Bad signature.' }, { status: 401 })
  let interaction: unknown
  try {
    interaction = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Not JSON.' }, { status: 400 })
  }
  const res = await handleInteraction(interaction, deps)
  if (!res) return NextResponse.json({ error: 'Not an interaction.' }, { status: 400 })
  return NextResponse.json(res)
}
