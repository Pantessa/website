// One source of truth for the two Claude Code onboarding prompts. The splash
// (/docs), the payer guide (/docs/claude-code), and the payee guide (/docs/earn)
// all render these — keeping them here means the headline integration copy never
// drifts between pages. Plain text on purpose (no markdown fences inside) so a
// single copy-paste survives intact.

/** PAYER — wire the spend-controlled x402 payer into an agent project. */
export const PAYER_CLAUDE_PROMPT = `Add Yeetful spend-controlled x402 payments to this agent project.

Yeetful gives an agent an "expense account": an allowlist of hosts plus
per-call/per-day USDC budgets, enforced locally BEFORE any payment is
signed, with a receipt for every decision. Docs: https://yeetful.com/docs

Do the following, asking me to confirm anything ambiguous:

1. Install: npm install yeetful viem (or the pnpm/yarn equivalent this
   repo already uses).

2. Find where this project makes HTTP calls to paid or x402 APIs. Create a
   single shared payer in src/lib/pay.ts (adjust path to repo conventions):

   import { yeetful } from 'yeetful/agent'
   import { createWalletClient, http } from 'viem'
   import { base } from 'viem/chains'
   import { privateKeyToAccount } from 'viem/accounts'

   const wallet = createWalletClient({
     // If this project already has a Coinbase Developer Platform (CDP)
     // wallet or another viem account, use THAT as the account instead.
     account: privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`),
     chain: base,
     transport: http(),
   })

   export const pay = yeetful({
     wallet,
     grant: {
       id: process.env.YEETFUL_GRANT_ID,
       allow: [], // TODO: add the exact hostnames this agent may pay
       perCallUsd: 0.05,
       perDayUsd: 2,
     },
     apiKey: process.env.YEETFUL_API_KEY,
     // www origin on purpose: fetch drops auth headers on cross-origin
     // redirects, and the apex currently redirects to www.
     ledgerUrl: 'https://www.yeetful.com',
     onEvent: (m) => console.log('[yeetful]', m),
   })

   Replace direct fetch calls to those paid hosts with pay(), and add each
   host to the grant's allow list. Call await pay.flushLedger() before
   short-lived scripts exit.

3. Env setup: add PRIVATE_KEY (or wire the existing CDP signer),
   YEETFUL_API_KEY, and YEETFUL_GRANT_ID to .env; make sure .env is
   gitignored; add the three keys to .env.example with placeholder values.

4. Now walk me through the two Yeetful dashboard steps INTERACTIVELY —
   one at a time, waiting for me to confirm each before continuing:
   a. Tell me to open https://yeetful.com/dashboard/keys, connect my
      wallet, sign in, and mint an API key. Remind me the yf_ secret is
      shown only once. Wait for me to paste nothing — I'll put it in .env
      myself — then continue when I say done.
   b. Tell me to copy YEETFUL_GRANT_ID from the "Your expense account"
      chip on that same page into .env, and to flip ON the agents I trust
      at https://yeetful.com/dashboard/approvals. Continue when I say done.

5. Verify without spending: run the agent against one free (non-402)
   allowlisted endpoint, confirm a $0 "settled" receipt logs and a ledger
   sync POST succeeds (no 401s). Show me the output. Do NOT make a paid
   call unless I explicitly say so.

Keep the caps small. Never print or commit secrets. If this repo's paid
hosts speak x402 v1 or v2, no extra handling is needed — the SDK detects
the protocol version per challenge.`

/** PAYEE — wire earn-tracking into an MCP server's settlement path. */
export const PAYEE_CLAUDE_PROMPT = `Add Yeetful earn-tracking to this MCP server using the yeetful SDK.

Goal: after each PAID request settles, report it to Yeetful so my earnings show
up on my dashboard. It must NEVER slow down, block, or break the response.

1) INSTALL THE SDK
   - npm i yeetful   (or the project's package manager)
   - import { reportUsage } from 'yeetful/server'
   reportUsage is fire-and-forget by design: it never throws, has a built-in
   timeout, and resolves false on any failure — so it can't slow or break the
   response. Don't hand-roll an HTTP call; use this.

2) WHERE TO CALL IT
   - Find the exact point where an x402 payment is verified and SETTLES (payment
     middleware/proxy, a per-route wrapper, or a payment hook). Call reportUsage
     right after a SUCCESSFUL settlement.
   - Do NOT await it on the hot path. On serverless/edge, hand the promise to the
     platform's background primitive, e.g. ctx.waitUntil(reportUsage({...}));
     otherwise just leave it un-awaited.

3) THE CALL
   reportUsage({
     apiKey: process.env.YEETFUL_API_KEY,    // required
     mcp: process.env.YEETFUL_MCP_SLUG,      // required — my server's slug on yeetful.com
     amountUsd,   // the call's price in US dollars as a NUMBER, e.g. 0.005
                  //   (your configured price — NOT on-chain atomic/USDC base units)
     payer,       // the paying agent's wallet address, if the settlement exposes it
     tool,        // the tool/route called — for MCP, the JSON-RPC params.name. If you
                  //   read the request body to get it, read a CLONE so the handler's
                  //   body isn't consumed.
     network: 'base',   // the chain you settled on (human name, not a CAIP-2 id)
     txHash,      // the settlement tx hash, if available
   })
   - Only call it when YEETFUL_API_KEY and YEETFUL_MCP_SLUG are both set; if either
     is missing, skip the report so the server still runs un-tracked.

4) CONFIG (read from env; put in .env, never commit)
   - YEETFUL_API_KEY  — mint at https://www.yeetful.com/dashboard/keys (the yf_…
                        secret is shown once)
   - YEETFUL_MCP_SLUG — copy from your dashboard's "My MCP servers", or the last
                        path segment of https://www.yeetful.com/servers/<slug>

FINISH BY: documenting both vars in .env.example, then running the project's
typecheck/build (and tests, if present) to confirm nothing broke.`