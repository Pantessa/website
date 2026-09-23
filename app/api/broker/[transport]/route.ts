// /api/broker/mcp — the agent desk. Pantessa's transaction layer, opened to
// OTHER agents over MCP (Streamable HTTP).
//
// An external agent says "I need $15 of AAPL" and the desk talks back:
// which guarded layer will build it, which dapps ride along, whether the
// wallet can fund it (real multi-chain scan), and which funding routes
// exist — every option a resume-sentence that re-enters the same parse
// ladder human asks use. It then closes one of two ways.
//
// THE HUMAN LANE (default): broker_handoff mints a durable sign link for the
// agent's human (connect-to-act; their wallet is the only signer), and
// broker_status reports the server-truth funnel back so the agent finally
// learns whether its human signed. Nothing signable crosses this lane —
// pinned mechanically by assertNoTxMaterial on every outbound payload.
//
// THE AGENT LANE: broker_execute compiles a SEQUENCED ask into a job owned by
// the agent's own wallet, and broker_next / broker_done drive it leg by leg.
//
// ── M1's rule, consciously REVISED (2026-09-23) ──────────────────────
// M1 (2026-08-17) wrote "no transaction material travels through this MCP
// surface", and broker_execute therefore handed back a job id + capability
// token and sent the agent off to the Jobs API to fetch its own legs.
//
// That rule was written for an ANONYMOUS surface — broker_open takes no
// credential, by design, because negotiation should cost nothing. The execute
// path is not that surface. It carries three gates the open path does not:
//   1. a BOUND IDENTITY — execute refuses an intent opened without agent_key;
//   2. a PROVEN WALLET — the agent personal_signs a consent text naming this
//      intent id and this wallet; the desk recovers the signer before any job
//      row exists;
//   3. a CAPABILITY TOKEN — signJobToken(jobId, wallet), the exact grant the
//      Jobs API itself accepts, which the desk can mint because it knows both.
// Under those three the desk surface IS the Jobs API's trust boundary reached
// over a different transport, and withholding the artifact bought nothing: the
// same bytes sat one `GET /api/jobs/{id}?t=` away for the same caller. What it
// cost was real — an LLM-driven agent had to leave the desk mid-intent and
// learn a second protocol to finish the thing it had just been quoted.
//
// So broker_next serves the offered leg and broker_done posts its result,
// gated on the bound agent_key (timing-safe) and refusing any intent that
// never executed. Its answer carries a freshly minted job capability token in
// `drive.*` — deliberately, and reviewed: the SAME identity already received
// one at broker_execute, so re-minting leaks nothing new, and withholding it
// would strand an agent that would rather finish over REST (or hand the job
// to the SDK's driveJob) on a desk that is paused. The safety that actually holds is untouched and is relaxed
// NOWHERE: deterministic builders write every transaction, every build is
// guard-checked fail-closed at offer time, and money moves only through a
// wallet signature. Every payload that is not the offered leg still passes
// assertNoTxMaterial (lib/desk-drive sayShape), so the negotiation half of the
// desk keeps its mechanical pin. See lib/desk-drive.ts for the long form.
import { NextRequest, NextResponse } from 'next/server'
import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'
import { openIntent, chooseOption, handoffIntent, intentStatus, closeIntent, executeIntent, tileIntent, sendToInbox } from '@/lib/broker-exec'
import { deskNext, deskDone, chooseWithHistory, assertCloseAllowed } from '@/lib/desk-drive'
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
  const noLogRaw = headers?.['x-yf-no-ask-log']
  return { internal: isInternalRun(headers ?? null), noLog: (Array.isArray(noLogRaw) ? noLogRaw[0] : noLogRaw) === '1' }
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

/** The desk's own contract version. Bumped whenever the tool set or the
 *  trust model changes; `registry/desk.server.json` carries the same number,
 *  and the harness pins the two in sync. 0.2.0 = the agent-signed leg loop
 *  (broker_next / broker_done). 0.3.0 = a venue-aware funding verdict on
 *  Hyperliquid opens, the chosen option kept on the plan, and broker_close
 *  gated on the identity that opened the intent. */
export const DESK_VERSION = '0.3.0'

const CAPABILITIES = [
  'Buy tokenized stocks (AAPL, TSLA, NVDA…) on Robinhood Chain — with automatic cross-chain funding when the money sits on Base/Ethereum/Arbitrum',
  "Swap tokens (Uniswap v3/v4, CoW incl. MEV-protected + limit orders) — dollar-denominated asks welcome ('swap $5 of ETH')",
  'Protect a Hyperliquid position — stop-loss / take-profit the Guardian watches every minute',
  'Cross-chain moves (NEAR Intents), Robinhood Chain bridging, Aave, Lido staking, NFT transfers + Seaport listings, Snapshot votes',
  'SIGN IT YOURSELF: if YOUR wallet holds the money and the key, broker_execute compiles the ask into a sequenced job and broker_next / broker_done drive it leg by leg — the desk builds and guards each leg, you sign it with your own key, and it answers with the next one. Round-trip across every settlement boundary, batched within one.',
  'FIND WORK: GET /api/roster/feed lists open mandate slots humans posted (kind, mandate sentence, cap — never their wallet). broker_open with slot_token courts a listing; getting HIRED (their signature) makes your future opens auto-address to their inbox.',
]

/** The leg shapes broker_next serves, one line each — an agent should be able
 *  to write its signer from the capability call alone. */
const LEG_KINDS = {
  tx: 'one EVM transaction: { to, data, value, chainId }. Sign, broadcast, report { txHash, chainId }.',
  txChain: 'N EVM transactions IN ORDER. A step carrying validUntil is re-quoted at the refresh URL before it is signed; report the LAST hash.',
  hlAction: 'one Hyperliquid L1 action. Sign orderRequest.typedData VERBATIM (EIP-712, domain chainId 1337) and POST the action back UNCHANGED to /api/hl/submit — the venue hashes msgpack, key order is part of the hash, and the relay re-canonicalizes.',
  hlBatch: 'several Hyperliquid actions on sequential nonces, signed in one motion and submitted in order. A failed member stops the batch and the leg is re-offered from it.',
  order: 'an off-chain EIP-712 order (CoW swap or limit, Seaport listing) with its own submitUrl. A prereqTx signs first when present.',
  wait: 'nothing to sign — the runner verifies on-chain arrival itself. Sleep retryAfterMs and call broker_next again.',
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'broker_capabilities',
      {
        title: 'The desk, and how to trade with it',
        description:
          'START HERE. What the guarded transaction layer can compile a plain-English ask into, and the two ways to close. ' +
          'HUMAN LANE: broker_open (parse + quote + funding scan) → broker_choose (rewrite the working sentence via offered options) → ' +
          'broker_handoff (mint the sign link for your human) → broker_status (server-truth funnel: opened, connected, built, signed, settled). ' +
          'AGENT LANE, when YOUR wallet holds the money and the key: broker_open (with agent_key + your wallet) → broker_choose → broker_execute ' +
          '(prove the wallet with one personal_sign; the ask compiles into a sequenced job) → broker_next / broker_done, leg by leg, → broker_status. ' +
          'Round-trip across every settlement boundary, batched within one.',
        inputSchema: {},
      },
      async () =>
        guarded(async () => ({
          version: DESK_VERSION,
          capabilities: CAPABILITIES,
          loop: {
            human: ['broker_open', 'broker_choose (optional, repeatable)', 'broker_handoff', 'broker_status'],
            agent: ['broker_open', 'broker_choose (optional, repeatable)', 'broker_execute', 'broker_next', 'broker_done', '… repeat next/done per leg …', 'broker_status'],
          },
          tools: [
            'broker_open',
            'broker_choose',
            'broker_handoff',
            'broker_execute',
            'broker_next',
            'broker_done',
            'broker_send',
            'broker_tile',
            'broker_status',
            'broker_close',
          ],
          legKinds: LEG_KINDS,
          pricing: pricingBlock(),
          contract:
            'Non-custodial by construction: deterministic builders write every transaction (no model writes calldata), ' +
            'each build is guard-checked fail-closed at offer time and receipted, and the only thing that moves money is a wallet signature. ' +
            'On the HUMAN lane nothing signable crosses this surface at all — the desk returns sentences and links, and the guarded builders ' +
            'rebuild the ask from scratch on the sign side. On the AGENT lane broker_next serves the leg the runner just built for YOUR OWN proven ' +
            'wallet, gated on the agent_key the intent was opened with — the same trust boundary as the job capability token broker_execute hands ' +
            'you, reached over this transport instead of REST. Either way Pantessa never holds a key and never signs for you.',
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
          slot_token: z
            .string()
            .min(6)
            .max(24)
            .optional()
            .describe(
              'Target a LISTED open mandate slot from GET /api/roster/feed. Resolves server-side to the employer ' +
                'wallet (the feed never carries addresses) and the open proceeds through every normal gate. ' +
                'Pass ONE target: slot_token or wallet, not both.',
            ),
        },
      },
      async ({ ask, wallet, agent, agent_key, callback_url, slot_token }, extra) =>
        guarded(() => openIntent({ ask, wallet, agent, agentKey: agent_key, callbackUrl: callback_url, slotToken: slot_token }, callOpts(extra))),
    )

    server.registerTool(
      'broker_choose',
      {
        title: 'Choose an option',
        description:
          'Pick one offered option by id (funding route, proceed, or walk away). The option rewrites the working sentence and the desk re-quotes — ' +
          'the ONLY way to rewrite an ask, by design. (broker_send is delivery, not negotiation: courting a listing runs open → send your pitch → the human hires.)',
        inputSchema: {
          intent_id: z.string().min(4).max(24),
          option_id: z.string().min(1).max(24),
        },
      },
      async ({ intent_id, option_id }) =>
        // The chosen option is KEPT on the plan (plan.chosen + plan.history):
        // a rewrite with no record of what rewrote it is a quote, a final ask,
        // and no account of how one became the other.
        guarded(() => chooseWithHistory(intent_id, option_id, () => chooseOption(intent_id, option_id))),
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
          'owned by that wallet and returns the job id + capability token + drive recipe. Then stay here: broker_next serves each leg as the runner ' +
          'builds it (guarded, policy-checked, one leg at a time) and broker_done posts what you signed and answers with the next one — the job API ' +
          'stays available for anything that would rather drive REST. Wait legs verify on-chain arrival before the next leg builds, so the order stays ' +
          'synced around settlement. Round-trip across every settlement boundary, batched within one. Only compiles SEQUENCED flows ' +
          '(fund → wait → act); the intent must have been opened with your wallet. Completion is advancement, not proof — lying fails the job ' +
          'closed one leg later. '  +
          'wallet_signature PROVES the wallet: personal_sign (EIP-191) over the exact consent text ' +
          '"Pantessa agent desk — execute consent\\nIntent: <intent_id>\\nWallet: <lowercased wallet>\\nSigning lets the desk compile this intent into a job owned by this wallet. It moves nothing by itself; every leg still needs this wallet\'s own signature." ' +
          '— the desk recovers the signer and refuses any wallet but the one the intent was opened for.',
        inputSchema: {
          intent_id: z.string().min(4).max(24),
          wallet_signature: z
            .string()
            .regex(/^0x[0-9a-fA-F]{130}$/)
            .describe('personal_sign over the consent text (see description) by the wallet this intent was opened for.'),
          issued_at: z
            .string()
            .optional()
            .describe(
              'The ISO-8601 UTC instant you signed the consent at (new Date().toISOString()). Accepted within 10 minutes ' +
                'both ways: a consent signature with no window is replayable forever by anyone who sees it. Sign and execute ' +
                'in one motion.',
            ),
          agent_key: z
            .string()
            .min(6)
            .max(80)
            .optional()
            .describe(
              'The SAME desk identity string you passed to broker_open — compared timing-safe. Without it, holding the ' +
                'intent id is enough to execute an intent someone else opened.',
            ),
        },
      },
      async ({ intent_id, wallet_signature, issued_at, agent_key }, extra) =>
        guarded(() => executeIntent(intent_id, wallet_signature, callOpts(extra), { issuedAt: issued_at, agentKey: agent_key })),
    )

    // ── the agent-signed leg loop (C3) ────────────────────────────────
    // These two are the ONLY tools that return signable material, and only for
    // the agent whose key the intent was bound to at open and whose wallet it
    // proved at execute. See the header comment for why M1's blanket rule was
    // revised, and lib/desk-drive.ts for the gate.
    server.registerTool(
      'broker_next',
      {
        title: 'What do I sign now?',
        description:
          'The leg loop. Returns the leg the runner is OFFERING on your executed intent — what it does in one sentence, what kind of ' +
          'signature it wants (tx | txChain | hlAction | hlBatch | order), the chain, its notional, how long the material stays signable ' +
          '(staleAfterMs), the guarded artifact itself exactly as built, and the credential-free endpoints the rest of the loop uses ' +
          '(re-quote, Hyperliquid submit, stale-leg rebuild) — or `waiting` with a retryAfterMs when there is nothing to ' +
          'sign yet (a wait leg settling on-chain, or the next leg being built). Sign the artifact AS SERVED and never re-serialize it: a ' +
          'Hyperliquid action is hashed as msgpack and key order is part of that hash. Then call broker_done. Requires the agent_key the ' +
          'intent was opened with — legs are served only to the agent that proved the wallet.',
        inputSchema: {
          intent_id: z.string().min(4).max(24),
          agent_key: z.string().min(6).max(80).describe('The desk identity this intent was opened with. Legs are served to no one else.'),
        },
      },
      async ({ intent_id, agent_key }) => guarded(() => deskNext(intent_id, agent_key)),
    )

    server.registerTool(
      'broker_done',
      {
        title: 'I signed that leg — what is next?',
        description:
          'Report a signed leg and get the next one in the same call. `seq` is the leg index broker_next handed you; `result` is your ' +
          'evidence — { txHash, chainId } for an EVM leg (the LAST hash of a txChain), { orderResponse } for a Hyperliquid or off-chain ' +
          'order, { batch: [{ ok, orderResponse|error }] } for a batch. The runner records it, rolls forward, and the answer is the next ' +
          'leg (or the wait it is now settling). Completion is ADVANCEMENT, NOT PROOF: the wait leg after yours reads the chain, so a ' +
          'result claiming a hash the chain does not have fails the job closed one leg later. Requires the intent\u2019s bound agent_key.',
        inputSchema: {
          intent_id: z.string().min(4).max(24),
          agent_key: z.string().min(6).max(80).describe('The desk identity this intent was opened with.'),
          seq: z.number().int().min(0).max(63).describe('The leg index you signed — the `seq` broker_next served.'),
          result: z
            .record(z.unknown())
            .optional()
            .describe('Your evidence: txHash / chainId / txs / orderResponse / batch / detail / explorerUrl. Unknown keys are ignored and named back to you.'),
        },
      },
      async ({ intent_id, agent_key, seq, result }, extra) => guarded(() => deskDone(intent_id, agent_key, seq, result ?? {}, callOpts(extra))),
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
          'Close the intent at any stage before a signature: revokes the bound sign link (it refuses new opens and leaves every board) ' +
          'and cancels a job broker_execute compiled. Signed or settled intents stay as they are. If the intent was opened with an ' +
          'agent_key, pass the SAME one \u2014 an intent id travels in logs, and walking away from someone else\u2019s intent is not yours to do.',
        inputSchema: {
          intent_id: z.string().min(4).max(24),
          agent_key: z
            .string()
            .min(6)
            .max(80)
            .optional()
            .describe(
              'Required when the intent was OPENED with an agent identity: closing revokes the sign link and ' +
                'cancels a running job, so it is that identity\u2019s call. An intent opened without one needs no key.',
            ),
        },
      },
      async ({ intent_id, agent_key }) =>
        guarded(async () => {
          await assertCloseAllowed(intent_id, agent_key)
          return closeIntent(intent_id)
        }),
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
