// /api/broker/mcp — the agent desk. Pantessa's transaction layer, opened to
// OTHER agents over MCP (Streamable HTTP).
//
// An external agent says "I need $15 of AAPL" and the desk talks back:
// which guarded layer will build it, which dapps ride along, whether the
// wallet can fund it (real multi-chain scan), and which funding routes
// exist — every option a resume-sentence that re-enters the same parse
// ladder human asks use. Close = a durable sign link for the agent's human
// (connect-to-act; their wallet is the only signer), then broker_status
// reports the server-truth funnel back so the agent finally learns whether
// its human signed. The desk NEVER returns transaction material — that is
// pinned mechanically (assertNoTxMaterial) on every outbound payload.
import { NextRequest, NextResponse } from 'next/server'
import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'
import { openIntent, chooseOption, handoffIntent, intentStatus, closeIntent, executeIntent, tileIntent, sendToInbox } from '@/lib/broker-exec'
import { clientIpFrom, bumpAndCheckBrokerCall } from '@/lib/turn-limits'
import { pricingBlock } from '@/lib/broker-pricing'
import { isInternalRun } from '@/lib/internal-run'

export const maxDuration = 60

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] }
}

/** The per-call desk options, read off the MCP request the transport hands
 *  every tool callback (`extra.requestInfo.headers`): our own harness/drill
 *  calls carry x-yf-internal-run so the rows they mint never read as growth. */
function callOpts(extra: unknown) {
  const headers = (extra as { requestInfo?: { headers?: Record<string, string | string[] | undefined> } } | undefined)?.requestInfo?.headers
  return { internal: isInternalRun(headers ?? null) }
}

async function guarded<T>(run: () => Promise<T>) {
  try {
    return ok(await run())
  } catch (e) {
    return {
      content: [{ type: 'text' as const, text: e instanceof Error ? e.message : 'Call failed.' }],
      isError: true,
    }
  }
}

const CAPABILITIES = [
  'Buy tokenized stocks (AAPL, TSLA, NVDA…) on Robinhood Chain — with automatic cross-chain funding when the money sits on Base/Ethereum/Arbitrum',
  "Swap tokens (Uniswap v3/v4, CoW incl. MEV-protected + limit orders) — dollar-denominated asks welcome ('swap $5 of ETH')",
  "Recurring buys — 'buy $10 of AAPL every week' becomes a DCA schedule",
  'Protect a Hyperliquid position — stop-loss / take-profit the Guardian watches every minute',
  'Cross-chain moves (NEAR Intents), Robinhood Chain bridging, Aave, Lido staking, NFT transfers + Seaport listings, Snapshot votes',
]

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'broker_capabilities',
      {
        title: 'The desk, and how to trade with it',
        description:
          'START HERE. What the guarded transaction layer can compile a plain-English ask into, and the negotiation loop: ' +
          'broker_open (parse + quote + funding scan) → broker_choose (rewrite the working sentence via offered options) → ' +
          'broker_handoff (mint the sign link for your human) → broker_status (server-truth funnel: opened, connected, built, signed, settled). ' +
          'Sentences in, sentences and links out — nothing this desk returns can execute by itself.',
        inputSchema: {},
      },
      async () =>
        guarded(async () => ({
          capabilities: CAPABILITIES,
          loop: ['broker_open', 'broker_choose (optional, repeatable)', 'broker_handoff', 'broker_status'],
          tools: ['broker_open', 'broker_choose', 'broker_handoff', 'broker_execute', 'broker_send', 'broker_tile', 'broker_status', 'broker_close'],
          pricing: pricingBlock(),
          contract:
            'Non-custodial by construction: deterministic builders write every transaction (no model writes calldata), ' +
            'each build is guard-checked fail-closed and receipted, and the human wallet on the other side of the sign link is the only signer. ' +
            'The desk never returns calldata, typed data, or deposit addresses to a calling agent.',
        })),
    )

    server.registerTool(
      'broker_open',
      {
        title: 'Open a brokered intent',
        description:
          'Open the negotiation for one plain-sentence ask (e.g. "Buy $15 of AAPL"). Optional wallet (the human wallet ' +
          'this intent is for — pass their 0x address, never a guess) triggers a REAL multi-chain funding scan, and a short wallet gets ' +
          'funding-route options. Returns the quote (which guarded layer claims the ask, the dapp set, funding verdict) plus options and next steps.',
        inputSchema: {
          ask: z.string().min(3).max(400).describe('The action as one plain sentence.'),
          wallet: z
            .string()
            .regex(/^0x[0-9a-fA-F]{40}$/)
            .optional()
            .describe('The human wallet this intent is for (funding scan is read-only).'),
          agent: z.string().max(40).optional().describe('Your agent name, shown as the byline on the sign link.'),
          agent_key: z
            .string()
            .min(6)
            .max(80)
            .optional()
            .describe(
              'Your desk identity string. Required ONLY for the agent-signed broker_execute path (it binds the ' +
                'intent to you and is capped); human handoff needs none. (Later becomes your x402-payer identity.)',
            ),
          callback_url: z
            .string()
            .url()
            .optional()
            .describe(
              'Optional https webhook. Signed/settled events for this intent POST here (HMAC-signed with a secret ' +
                'returned once in the response) so you learn your human signed without polling. broker_status stays the fallback.',
            ),
        },
      },
      async ({ ask, wallet, agent, agent_key, callback_url }, extra) =>
        guarded(() => openIntent({ ask, wallet, agent, agentKey: agent_key, callbackUrl: callback_url }, callOpts(extra))),
    )

    server.registerTool(
      'broker_choose',
      {
        title: 'Choose an option',
        description:
          'Pick one offered option by id (funding route, proceed, or walk away). The option rewrites the working sentence and the desk re-quotes — ' +
          'there is no other negotiation channel, by design.',
        inputSchema: {
          intent_id: z.string().min(4).max(24),
          option_id: z.string().min(1).max(24),
        },
      },
      async ({ intent_id, option_id }) => guarded(() => chooseOption(intent_id, option_id)),
    )

    server.registerTool(
      'broker_handoff',
      {
        title: 'Mint the sign link',
        description:
          'Close the negotiation into a durable pantessa.com/i/<slug> sign link carrying the working sentence. Hand it to your human: ' +
          'they connect their own wallet, the guarded layer rebuilds and checks the ask from scratch, and only their signature moves anything. Idempotent.',
        inputSchema: { intent_id: z.string().min(4).max(24) },
      },
      async ({ intent_id }, extra) => guarded(() => handoffIntent(intent_id, callOpts(extra))),
    )

    server.registerTool(
      'broker_execute',
      {
        title: 'Execute it yourself (agent-signed, sequenced)',
        description:
          'The x402-payer path: when YOUR wallet holds the funds and the key, the desk compiles the working ask into a multi-leg job ' +
          'owned by that wallet and returns the job id + capability token + drive recipe. You fetch each leg from the job API as the runner ' +
          'builds it (guarded, policy-checked, one leg at a time), sign and broadcast it with your own key, and post completion; wait legs verify ' +
          'on-chain arrival before the next leg builds, so the order stays synced around settlement. Only compiles SEQUENCED flows ' +
          '(fund → wait → act); the intent must have been opened with your wallet. Completion is advancement, not proof — lying fails the job ' +
          'closed one leg later. No transaction material travels through this MCP surface. ' +
          'wallet_signature PROVES the wallet: personal_sign (EIP-191) over the exact consent text ' +
          '"Pantessa agent desk — execute consent\\nIntent: <intent_id>\\nWallet: <lowercased wallet>\\nSigning lets the desk compile this intent into a job owned by this wallet. It moves nothing by itself; every leg still needs this wallet\'s own signature." ' +
          '— the desk recovers the signer and refuses any wallet but the one the intent was opened for.',
        inputSchema: {
          intent_id: z.string().min(4).max(24),
          wallet_signature: z
            .string()
            .regex(/^0x[0-9a-fA-F]{130}$/)
            .describe('personal_sign over the consent text (see description) by the wallet this intent was opened for.'),
        },
      },
      async ({ intent_id, wallet_signature }, extra) => guarded(() => executeIntent(intent_id, wallet_signature, callOpts(extra))),
    )

    server.registerTool(
      'broker_tile',
      {
        title: 'Hand your human a portfolio (MOSAIC)',
        description:
          'Mint a portfolio SHAPE as a sign link: pass 2–8 percentage slices summing to 100 (letters-only token symbols — ETH, USDC, ' +
          'wstETH, cbBTC… — tokenized stocks like AAPL/TSLA on robinhood, where USDG is the rail) and an optional chain ' +
          '(base/ethereum/arbitrum/robinhood; omitted = each wallet tiles its own dominant chain). The desk ' +
          'composes the canonical tile sentence, proves it through the same grammar the sign side runs, and returns a durable /i link plus ' +
          'a fork door. Every wallet that opens the link gets the SAME sentence compiled into ITS OWN batch — sells then buys, one ' +
          'signature chain, personalized by the deterministic planner. Sentences and links out, as always; poll broker_status for the funnel.',
        inputSchema: {
          slices: z
            .array(z.object({ pct: z.number().positive().max(100), token: z.string().regex(/^[A-Za-z]{2,12}$/) }))
            .min(2)
            .max(8)
            .describe('The shape: [{pct, token}, …], pcts summing to 100.'),
          chain: z.enum(['base', 'ethereum', 'arbitrum', 'robinhood']).optional(),
          agent: z.string().max(40).optional().describe('Your agent name — the byline on the link.'),
        },
      },
      async ({ slices, chain, agent }, extra) => guarded(() => tileIntent({ slices, chain, agent }, callOpts(extra))),
    )

    server.registerTool(
      'broker_send',
      {
        title: 'Send an intent to a wallet (the inbox)',
        description:
          'Address an intent TO a recipient — a 0x wallet or a claimed @handle — instead of handing back a link. It lands ' +
          'in their pantessa.com/inbox where one tap opens the guarded runtime; only their own signature moves anything, ' +
          'and they never had to ask. Phrase the ask as one plain sentence with amounts. Returns the inbox URL + the /i ' +
          'link; poll broker_status to learn when they sign. No transaction material crosses this surface.',
        inputSchema: {
          ask: z.string().min(3).max(400).describe('The action as one plain sentence, amounts included.'),
          recipient: z.string().min(2).max(64).describe('Who it is for: a 0x wallet address, or a claimed @handle.'),
          sender_label: z.string().max(60).optional().describe('Who it is from — shown in the recipient’s inbox (e.g. your agent or app name).'),
          agent: z.string().max(40).optional().describe('Your agent name, the byline on the link.'),
          agent_key: z.string().min(6).max(80).optional().describe('Your desk identity — attributes this send to your track record.'),
        },
      },
      async ({ ask, recipient, sender_label, agent, agent_key }, extra) =>
        guarded(() => sendToInbox({ ask, recipient, senderLabel: sender_label, agent, agentKey: agent_key }, callOpts(extra))),
    )

    server.registerTool(
      'broker_close',
      {
        title: 'Walk away',
        description:
          'Close the intent at any stage before a signature: revokes the bound sign link (it refuses new opens and leaves every board). ' +
          'Signed or settled intents stay as they are.',
        inputSchema: { intent_id: z.string().min(4).max(24) },
      },
      async ({ intent_id }) => guarded(() => closeIntent(intent_id)),
    )

    server.registerTool(
      'broker_status',
      {
        title: 'Did my human sign?',
        description:
          'The feedback loop: server-truth funnel for the sign link (opened → connected → built → signed → settled, with signed USD from ' +
          'guardrail-priced turns). Poll after handoff; states only move forward.',
        inputSchema: { intent_id: z.string().min(4).max(24) },
      },
      async ({ intent_id }) => guarded(() => intentStatus(intent_id)),
    )
  },
  {},
  { basePath: '/api/broker' },
)

// The MCP surface is unauthenticated by design (any agent negotiates), so
// tool CALLS (POST) ride an hourly per-IP fence — one script can't spam
// intent rows or amplify the funding scan. Loopback (harness/dev) is exempt.
// GET/DELETE (the SSE stream + cancel) pass through untouched. Fail-open: a
// limiter hiccup never takes the desk down.
async function limitedPost(req: NextRequest): Promise<Response> {
  const tripped = await bumpAndCheckBrokerCall(clientIpFrom(req.headers))
  if (tripped) {
    return NextResponse.json(
      { error: 'The agent desk hourly rate limit for this connection is reached. Try again within the hour.' },
      { status: 429 },
    )
  }
  return handler(req)
}

export { handler as GET, limitedPost as POST, handler as DELETE }
