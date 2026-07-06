#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────
//  eval:conversations — the WATER-SPRINT scoreboard (RR16).
//
//  Scripted multi-TURN, multi-MCP conversations run against the REAL
//  planner path (plannerPrompt → direct Claude → parsePlannerPicks →
//  buildSmartRequest) with context vars offered like production. Scores
//  per turn: right SERVICE picked, right TOOL, params filled correctly
//  (incl. $USER_ADDRESS substitution and values carried from earlier
//  turns). Construction-only — nothing is paid, executed, or signed.
//
//  Cases tagged `pending: 'RR17'|'RR18'|'RR19'` encode behavior a later
//  water-sprint card delivers: they REPORT today but only FAIL once their
//  feature is added to UNLOCKED (flip it in the same PR that ships the
//  feature). Everything untagged must stay green from RR16 onward
//  (invariant 7: eval-driven routing changes only).
//
//  Run:  DATABASE_URL=… ANTHROPIC_API_KEY=… npx tsx scripts/eval-conversations.ts [--json] [--only=<name-substr>]
// ─────────────────────────────────────────────────────────────────────────
import prisma from '../lib/db'
import {
  loadPlannableEndpoints,
  plannerPrompt,
  parsePlannerPicks,
  buildSmartRequest,
  type PlannableEndpoint,
  type ConversationTurn,
} from '../lib/endpoint-planner'
import { parseClarify, type ClarifyRequest } from '../lib/clarify'

const PLANNER_MODEL = process.env.PLANNER_MODEL || 'claude-haiku-4-5-20251001'
/** The connected wallet the harness simulates ($USER_ADDRESS resolves to it). */
const TEST_ADDR = '0x1111111111111111111111111111111111111111'

/** Water-sprint features that have LANDED — their pending cases become mandatory.
 *  Flip the flag in the same PR that ships the feature. */
const UNLOCKED = new Set<string>(['RR17'])

// ── Case model ───────────────────────────────────────────────────────────────
/** The tool arguments after buildSmartRequest (tools/call args, or query/body). */
type Args = Record<string, unknown>

interface TurnExpect {
  /** Server slug the pick must come from. */
  service: string
  /** Matched against the picked endpoint's url (e.g. /mcp\/list_proposals$/). */
  tool: RegExp
  /** Returns null when the constructed args are right, else the failure reason. */
  params?: (args: Args) => string | null
}

interface Turn {
  user: string
  /** What the assistant "said" after this turn — scripted, entity-rich, so the
   *  next turn's history reads like a real chat (ids/symbols available in prose). */
  assistantNote: string
  /** Expect a PICK from this service/tool with these params… */
  expect?: TurnExpect
  /** …or expect the planner to ASK (RR17): returns null when the clarify
   *  payload is right, else the failure reason. */
  expectClarify?: (c: ClarifyRequest) => string | null
  /** Water-sprint gate: reported-not-failing until the feature is UNLOCKED. */
  pending?: 'RR17' | 'RR18' | 'RR19'
}

interface Conversation {
  name: string
  /** The user's saved shortlist for this chat (≤3 MCPs — the product surface). */
  shortlist: string[]
  turns: Turn[]
}

// Helpers for param assertions.
const has = (args: Args, k: string, v?: unknown): string | null => {
  if (!(k in args) || args[k] === undefined || args[k] === '') return `missing param "${k}" (got ${JSON.stringify(args)})`
  if (v !== undefined && String(args[k]).toLowerCase() !== String(v).toLowerCase()) {
    return `param "${k}" = ${JSON.stringify(args[k])}, expected ${JSON.stringify(v)}`
  }
  return null
}
const contains = (args: Args, k: string, sub: string): string | null => {
  const val = String(args[k] ?? '')
  return val.toLowerCase().includes(sub.toLowerCase()) ? null : `param "${k}" (${val.slice(0, 80)}) does not contain "${sub}"`
}

// Real ids so scripted history reads like production output.
const PROPOSAL_ID = '0xd8c3ad14ac67d8d736753f5595600a30460b15570a8618851dced94122b81aa4'

const CONVERSATIONS: Conversation[] = [
  {
    name: 'governance-flow (mine → detail → voters)',
    shortlist: ['snapshot-free', 'uniswap-free'],
    turns: [
      {
        user: 'do I have any open proposals?',
        assistantNote: `You follow 3 spaces. 2 active proposals in them: 1. "Fee switch pilot" (${PROPOSAL_ID}) in balancer.eth · 2. "Treasury refill" (0xaaa1) in sparkfi.eth.`,
        expect: {
          service: 'snapshot-free',
          tool: /list_proposals$/,
          // The headline check of RR12: identity via the context token + the follower join.
          params: (a) => has(a, 'follower', TEST_ADDR) ?? has(a, 'state', 'active'),
        },
      },
      {
        user: 'show me the details of the first one',
        assistantNote: `"Fee switch pilot" (${PROPOSAL_ID}): single-choice, choices For/Against, ends in 2 days, 4.1M vp cast.`,
        expect: {
          service: 'snapshot-free',
          tool: /get_proposal$/,
          // The id lives in the prior assistant message — prose carry.
          params: (a) => has(a, 'id', PROPOSAL_ID),
        },
      },
      {
        user: 'who has voted on it so far?',
        assistantNote: `Top voters: 0xbeef… (1.2M vp, For), 0xcafe… (0.8M vp, Against).`,
        expect: {
          service: 'snapshot-free',
          tool: /list_votes$/,
          params: (a) => has(a, 'proposal', PROPOSAL_ID),
        },
      },
    ],
  },
  {
    name: 'research-to-swap (votes → price → build)',
    shortlist: ['snapshot-free', 'uniswap-free'],
    turns: [
      {
        user: 'any live votes in aave.eth?',
        assistantNote: 'One active proposal in aave.eth: "Risk parameter update" (0xbbb2), ends tomorrow.',
        expect: {
          service: 'snapshot-free',
          tool: /list_proposals$/,
          params: (a) => {
            const space = String(a.space ?? '')
            return space.toLowerCase() === 'aave.eth' ? null : `param "space" = ${JSON.stringify(a.space)}, expected aave.eth`
          },
        },
      },
      {
        user: 'what is the price of UNI in USDC on uniswap?',
        assistantNote: 'UNI/USDC on Uniswap v3 (Base): 1 UNI ≈ 9.42 USDC.',
        expect: {
          service: 'uniswap-free',
          tool: /\/(price|quote)$/,
          params: (a) => {
            const all = JSON.stringify(a).toUpperCase()
            return all.includes('UNI') && all.includes('USDC') ? null : `pair not filled: ${JSON.stringify(a)}`
          },
        },
      },
      {
        user: 'ok swap 2 USDC for UNI',
        assistantNote: 'Built the swap: 2 USDC → ~0.212 UNI, min 0.211 (50bps). Sign in the card below.',
        expect: {
          service: 'uniswap-free',
          tool: /build_swap$/,
          // from must be the USER's address via the context token — never invented.
          params: (a) => has(a, 'from', TEST_ADDR) ?? has(a, 'sellToken', 'USDC') ?? has(a, 'buyToken', 'UNI') ?? has(a, 'amount', '2'),
        },
      },
    ],
  },
  {
    name: 'quote-then-build (carry the pair from history)',
    shortlist: ['uniswap-free', 'snapshot-free'],
    turns: [
      {
        user: 'quote 100 USDC to WETH',
        assistantNote: '100 USDC → ~0.0332 WETH (30bps pool, best of 4 tiers).',
        expect: {
          service: 'uniswap-free',
          tool: /\/quote$/,
          params: (a) => has(a, 'sellToken', 'USDC') ?? has(a, 'buyToken', 'WETH') ?? has(a, 'amount', '100'),
        },
      },
      {
        user: 'looks good — build that swap for me',
        assistantNote: 'Built: 100 USDC → min 0.0330 WETH. Sign below.',
        expect: {
          service: 'uniswap-free',
          tool: /build_swap$/,
          params: (a) => has(a, 'from', TEST_ADDR) ?? has(a, 'sellToken', 'USDC') ?? has(a, 'buyToken', 'WETH') ?? has(a, 'amount', '100'),
        },
      },
    ],
  },
  {
    name: 'escape-hatch (follows via raw GraphQL)',
    shortlist: ['snapshot-free', 'uniswap-free'],
    turns: [
      {
        user: 'which snapshot spaces does 0xeF8305E140ac520225DAf050e2f71d5fBcC543e7 follow?',
        assistantNote: 'That address follows balancer.eth, sparkfi.eth and 1 more space.',
        expect: {
          service: 'snapshot-free',
          // Either the escape hatch or a curated tool that can answer counts —
          // but ONLY graphql_query can express follows-for-arbitrary-address.
          tool: /graphql_query$/,
          params: (a) => contains(a, 'query', 'follows'),
        },
      },
    ],
  },
  {
    name: 'utility-actions (wrap + convert)',
    shortlist: ['uniswap-free', 'snapshot-free'],
    turns: [
      {
        user: 'wrap 0.1 ETH for me',
        assistantNote: 'Built the wrap: 0.1 ETH → WETH. Sign below.',
        expect: {
          service: 'uniswap-free',
          tool: /build_wrap$/,
          params: (a) => has(a, 'from', TEST_ADDR) ?? has(a, 'amount', '0.1'),
        },
      },
      {
        user: 'how many atoms is 1.5 USDC?',
        assistantNote: '1.5 USDC = 1500000 atoms (6 decimals).',
        expect: {
          service: 'uniswap-free',
          tool: /convert_amount$/,
          params: (a) => has(a, 'token', 'USDC') ?? has(a, 'amount', '1.5'),
        },
      },
    ],
  },
  {
    name: 'three-mcp turn (price + governance in one message)',
    shortlist: ['snapshot-free', 'uniswap-free', 'coingecko'],
    turns: [
      {
        user: 'what is the current price of ETH, and are there any live votes in ens.eth?',
        assistantNote: 'ETH ≈ $3,412. One active vote in ens.eth: "Steward elections" (0xccc3).',
        // Two picks expected — assert the governance one; the price pick is
        // whichever price MCP the router judged best (coingecko or uniswap).
        expect: {
          service: 'snapshot-free',
          tool: /list_proposals$/,
          params: (a) => {
            const space = String(a.space ?? '')
            return space.toLowerCase() === 'ens.eth' ? null : `param "space" = ${JSON.stringify(a.space)}, expected ens.eth`
          },
        },
      },
      {
        user: 'search coingecko for the PEPE token',
        assistantNote: 'CoinGecko: PEPE (pepe) — top pool on Base at 0xdead…',
        expect: {
          service: 'coingecko',
          tool: /onchain\/search/,
          params: (a) => contains(a, 'query', 'pepe'),
        },
      },
    ],
  },
  {
    name: 'ambiguous-money asks (RR17 clarify)',
    shortlist: ['snapshot-free', 'uniswap-free'],
    turns: [
      {
        user: 'how do UNI and BAL compare on uniswap right now?',
        assistantNote: 'On Uniswap v3 (Base): UNI ≈ 9.42 USDC, BAL ≈ 4.87 USDC. UNI pools are ~6× deeper.',
        // Read-only turn — ANY uniswap read tool is fine; must NOT clarify.
        expect: { service: 'uniswap-free', tool: /\/(price|quote|pool_info)$/ },
      },
      {
        user: 'ok swap 5 USDC for the better one',
        assistantNote: 'Which one should I buy?',
        // MONEY + ambiguous target ("the better one" — better how?) → the
        // planner must ASK, not guess. Options must resolve to UNI/BAL swaps.
        expectClarify: (c) => {
          if (c.options.length < 2) return `only ${c.options.length} option(s)`
          const resumes = c.options.map((o) => o.resume.toUpperCase())
          const coversBoth = resumes.some((r) => r.includes('UNI')) && resumes.some((r) => r.includes('BAL'))
          if (!coversBoth) return `options do not cover UNI and BAL: ${JSON.stringify(c.options)}`
          const resumable = c.options.every((o) => /swap/i.test(o.resume) && /5\s*USDC/i.test(o.resume))
          return resumable ? null : `resume strings are not fully-resolved swap requests: ${JSON.stringify(c.options.map((o) => o.resume))}`
        },
      },
    ],
  },
  {
    name: 'entity-carry across MCPs (RR18 target)',
    shortlist: ['snapshot-free', 'uniswap-free'],
    turns: [
      {
        user: 'find the DAO called Balancer on snapshot',
        assistantNote: 'balancer.eth — 312k followers, token BAL (0xba100000625a3754423978a60c9317c58a424e3D on mainnet; BAL on Base).',
        expect: {
          service: 'snapshot-free',
          tool: /\/(get_space|list_spaces|graphql_query)$/,
        },
      },
      {
        user: 'swap 1 USDC for its token',
        assistantNote: 'Built: 1 USDC → BAL.',
        // "its token" = BAL, named only in the prior turn's result prose. Prose
        // carry sometimes works; RR18's resolvedEntities makes it reliable.
        pending: 'RR18',
        expect: {
          service: 'uniswap-free',
          tool: /build_swap$/,
          params: (a) => has(a, 'from', TEST_ADDR) ?? has(a, 'sellToken', 'USDC') ?? has(a, 'buyToken', 'BAL'),
        },
      },
    ],
  },
]

// ── Runner ───────────────────────────────────────────────────────────────────
async function planner(prompt: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: PLANNER_MODEL, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
    return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim() || null
  } catch {
    return null
  }
}

/** Tool arguments the constructed request would send (tools/call or query/body). */
function argsOf(built: { url: string; body?: string; mcp?: boolean }): Args {
  if (built.mcp && built.body) {
    try {
      const parsed = JSON.parse(built.body) as { params?: { arguments?: Args } }
      return parsed.params?.arguments ?? {}
    } catch {
      return {}
    }
  }
  const out: Args = {}
  try {
    for (const [k, v] of new URL(built.url).searchParams.entries()) out[k] = v
  } catch {
    /* ignore */
  }
  if (built.body) {
    try {
      Object.assign(out, JSON.parse(built.body) as Args)
    } catch {
      /* ignore */
    }
  }
  return out
}

interface TurnResult {
  conversation: string
  turn: number
  user: string
  ok: boolean
  pending?: string
  detail: string
}

async function runConversation(convo: Conversation, endpointCache: Map<string, PlannableEndpoint[]>): Promise<TurnResult[]> {
  const key = convo.shortlist.slice().sort().join(',')
  if (!endpointCache.has(key)) endpointCache.set(key, await loadPlannableEndpoints(convo.shortlist))
  const endpoints = endpointCache.get(key)!
  const results: TurnResult[] = []
  const history: ConversationTurn[] = []

  for (let i = 0; i < convo.turns.length; i++) {
    const turn = convo.turns[i]
    const pendingTag = turn.pending && !UNLOCKED.has(turn.pending) ? turn.pending : undefined
    const record = (ok: boolean, detail: string) =>
      results.push({ conversation: convo.name, turn: i + 1, user: turn.user, ok, pending: pendingTag, detail })

    const prompt = plannerPrompt(turn.user, endpoints, history, '', { userAddress: TEST_ADDR })
    const text = await planner(prompt)
    if (!text) {
      record(false, 'planner call failed (no text)')
    } else if (turn.expectClarify) {
      const clarify = parseClarify(text)
      if (!clarify) {
        const picked = parsePlannerPicks(text, endpoints).length
        record(false, `expected a clarify question, got ${picked} pick(s) instead`)
      } else {
        const reason = turn.expectClarify(clarify)
        record(reason === null, reason ?? `asked: "${clarify.question}" (${clarify.options.length} options)`)
      }
    } else if (turn.expect) {
      const picks = parsePlannerPicks(text, endpoints)
      const byId = new Map(endpoints.map((e) => [e.id, e]))
      const match = picks
        .map((p) => ({ p, ep: byId.get(p.endpointId)! }))
        .find(({ ep }) => ep.serverSlug === turn.expect!.service && turn.expect!.tool.test(ep.url))
      if (!match) {
        const clarified = parseClarify(text)
        const picked = picks.map((p) => byId.get(p.endpointId)?.url.split('/').slice(-2).join('/')).join(', ') || (clarified ? `a clarify question ("${clarified.question}")` : 'nothing')
        record(false, `expected ${turn.expect!.service} ${turn.expect!.tool} — planner picked: ${picked}`)
      } else {
        const built = buildSmartRequest(match.ep, match.p.params, { userAddress: TEST_ADDR })
        if ('error' in built) {
          record(false, `picked right tool but request build failed: ${built.error}`)
        } else {
          const reason = turn.expect!.params?.(argsOf(built.request)) ?? null
          record(reason === null, reason ?? 'pick + params + construction ok')
        }
      }
    } else {
      record(false, 'turn has neither expect nor expectClarify')
    }
    history.push({ role: 'user', content: turn.user })
    history.push({ role: 'assistant', content: turn.assistantNote })
  }
  return results
}

async function main() {
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')))
  const only = process.argv.slice(2).find((a) => a.startsWith('--only='))?.slice(7)
  const convos = only ? CONVERSATIONS.filter((c) => c.name.includes(only)) : CONVERSATIONS

  const cache = new Map<string, PlannableEndpoint[]>()
  const all: TurnResult[] = []
  for (const convo of convos) all.push(...(await runConversation(convo, cache)))

  const required = all.filter((r) => !r.pending)
  const pendings = all.filter((r) => r.pending)
  const failed = required.filter((r) => !r.ok)

  if (flags.has('--json')) {
    console.log(JSON.stringify({ total: all.length, requiredPass: required.length - failed.length, requiredFail: failed.length, pending: pendings.map((p) => ({ ...p })), results: all }, null, 2))
  } else {
    let lastConvo = ''
    for (const r of all) {
      if (r.conversation !== lastConvo) {
        console.log(`\n━━ ${r.conversation}`)
        lastConvo = r.conversation
      }
      const mark = r.ok ? '✓' : r.pending ? `◌ pending(${r.pending})` : '✗'
      console.log(`  ${mark} T${r.turn} "${r.user}"${r.ok ? '' : ` — ${r.detail}`}`)
    }
    console.log(`\nscore: ${required.length - failed.length}/${required.length} required turns green · ${pendings.filter((p) => p.ok).length}/${pendings.length} pending already passing`)
  }
  await prisma.$disconnect()
  if (failed.length > 0) process.exit(1)
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e)
  process.exit(1)
})
