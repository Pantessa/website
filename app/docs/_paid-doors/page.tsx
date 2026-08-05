import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

// The agent-dev door's lead page: free /mcp doors vs /paid/mcp x402 doors.
// Every sample on this page was run against the LIVE doors before it was
// written down — the fund_and_build output below is a real response
// (trimmed), not a mock.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'paid-doors')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

const FREE_DOORS = [
  { host: 'uniswap-mcp.yeetful.com', what: 'Uniswap quotes, pools, guarded swap construction' },
  { host: 'cow-mcp.yeetful.com', what: 'CoW Protocol swaps + limit orders, docs corpus' },
  { host: 'snapshot-mcp.yeetful.com', what: 'DAO proposals, EIP-712 vote construction' },
  { host: 'hyperliquid-mcp.yeetful.com', what: 'Perps: positions, orders, settlement waits' },
  { host: 'aave-mcp.yeetful.com', what: 'Aave reserves, portfolios, supply/borrow construction' },
  { host: 'lido-mcp.yeetful.com', what: 'ETH staking: positions, earnings, stake construction' },
  { host: 'robinhood-mcp.yeetful.com', what: 'Robinhood Chain: tokenized stocks, Morpho, bridge' },
  { host: 'opensea-mcp.yeetful.com', what: 'NFTs: holdings, floors, guarded transfer/sell/buy' },
  { host: 'near-intents.yeetful.com', what: 'Cross-chain swaps via solver auction (1Click)' },
  { host: 'wallet-mcp.yeetful.com', what: 'Balances + portfolios across 10 chains' },
]

export default function PaidDoorsDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> PAID MCP DOORS
      </p>
      <h1 className="docs__h1">One MCP, two doors</h1>
      <p className="docs__lead">
        Every Pantessa MCP serves a <strong>free door</strong> at <code>/mcp</code> — rate-limited,
        no account. Some add a <strong>paid door</strong> at <code>/paid/mcp</code>:{' '}
        <em>identical tools</em>, no rate limit, no API key, no sign-up — your agent pays per
        call in USDC on Base over <Link href="/docs/x402">x402</Link>. If your agent has a wallet,
        it already has an account.
      </p>

      <div className="docs__prose">
        <h2>Try the free door right now</h2>
        <p>
          The funding planner at <code>funding-mcp.yeetful.com</code> is the first two-door
          service. Its free door answers without any setup — plain MCP Streamable HTTP:
        </p>
        <pre>
          <code>{`curl -s https://funding-mcp.yeetful.com/mcp \\
  -X POST \\
  -H "content-type: application/json" \\
  -H "accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</code>
        </pre>
        <p>
          Five tools come back: <code>fund_and_build</code>, <code>plan_funding</code>,{' '}
          <code>scan_funding_sources</code>, <code>eth_price</code>, <code>chains</code>.
        </p>

        <h2>The flagship: fund_and_build</h2>
        <p>
          The hard part of agent trading isn&apos;t deciding — it&apos;s the multi-step
          transaction work when the money is on the wrong chain. <code>fund_and_build</code>{' '}
          takes a shortfall (&ldquo;I need 2 more USDC on Arbitrum&rdquo;) and returns the whole
          program: a scan of the wallet&apos;s movable ETH + USDC across Base, Arbitrum, and
          Ethereum, ranked funding options, and a <strong>numbered runbook of exact NEAR Intents
          tool calls</strong> the agent executes and signs with its <em>own</em> key. It is
          construction-only: the planner never holds keys, never signs, never submits.
        </p>
        <pre>
          <code>{`curl -s https://funding-mcp.yeetful.com/mcp \\
  -X POST \\
  -H "content-type: application/json" \\
  -H "accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
    "name":"fund_and_build",
    "arguments":{"user":"0xYourAgentWallet","chain":"arbitrum","token":"USDC","amount":2}
  }}'`}</code>
        </pre>
        <p>A real response (a funded test wallet, trimmed):</p>
        <pre>
          <code>{`{
  "plan": {
    "options": [{
      "label": "Just enough (~$3.50 of USDC on Base)",
      "legs": [{ "originChain": "Base", "originToken": "USDC", "amount": "3.5",
                 "destinationChain": "Arbitrum", "destinationToken": "USDC" }],
      "yeetfulResume": "Swap 3.5 USDC from Base to USDC on Arbitrum"
    }],
    "sourcesSeen": "~$12.35 of USDC on Base, ~$1.49 of ETH on Base"
  },
  "scan": { "readChains": ["Arbitrum", "Ethereum", "Base"], "failedChains": [] },
  "destinationGas": { "floorEth": 0.0002, "legNeeded": false },
  "runbook": {
    "steps": [
      { "step": 1, "kind": "build",  "tool": "build_swap",
        "note": "Call build_swap with these params verbatim. Sign the returned
                 deposit transfer with the user's own wallet — the deposit
                 address comes from the tool's response, NEVER from you." },
      { "step": 2, "kind": "notify", "tool": "submit_deposit_tx" },
      { "step": 3, "kind": "await",  "tool": "await_completion" },
      { "step": 4, "kind": "act",
        "note": "Funds have landed — retry the original action." }
    ]
  }
}`}</code>
        </pre>
        <p>
          Note what the runbook refuses to do: it names the tool and the parameters, but the
          deposit address must come from the NEAR Intents tool&apos;s own response at execution
          time. A plan that invented addresses would not be worth paying for.
        </p>

        <h2>Pay the paid door</h2>
        <p>
          The paid door serves the same tools without the rate limit. It answers{' '}
          <code>402 Payment Required</code> with a price — <strong>$0.02 per call</strong> — and{' '}
          <code>createPaymentClient</code> from the <code>pantessa</code> npm package handles the
          challenge: it signs a gasless EIP-3009 USDC authorization and retries. Your wallet
          needs a few cents of <Link href="/docs/funding">USDC on Base</Link>; no ETH, no key
          minting, no account.
        </p>
        <pre>
          <code>{`import { createWalletClient, http } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { createPaymentClient } from 'pantessa/client'

const wallet = createWalletClient({
  account: privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`),
  chain: base,
  transport: http(),
})

const pay = createPaymentClient({ wallet })

const res = await pay('https://funding-mcp.yeetful.com/paid/mcp', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: {
      name: 'fund_and_build',
      arguments: { user: wallet.account.address, chain: 'arbitrum', token: 'USDC', amount: 2 },
    },
  }),
})
console.log(await res.text())`}</code>
        </pre>
        <p>
          <code>pay()</code> behaves like <code>fetch</code>. Want a confirmation hook before any
          payment signs? Pass <code>onPaymentRequired</code>; want caps and an allowlist enforced
          before the wallet ever signs? Wrap it in the{' '}
          <Link href="/docs/expense-account">expense account</Link> instead — same client
          underneath, plus policy:
        </p>
        <pre>
          <code>{`import { pantessa } from 'pantessa/agent'

const pay = yeetful({
  wallet,
  grant: {
    allow: ['funding-mcp.yeetful.com'],
    perCallUsd: 0.05,
    perDayUsd: 2,
  },
  onReceipt: (r) => console.log(r.host, \`$\${r.amountUsd}\`, r.txHash ?? r.note),
})`}</code>
        </pre>
        <p>
          The <Link href="/docs/quickstart">agent quickstart</Link> walks that setup end to end,
          and <Link href="/docs/ledger-sync">ledger sync</Link> puts every settlement and denial
          on your dashboard.
        </p>

        <h2>Why a paid door at all</h2>
        <ul>
          <li>
            <strong>No account friction.</strong> The 402 challenge is the whole onboarding: no
            key to mint, no dashboard to visit, no quota to negotiate. An agent discovers the
            door, pays, and gets the answer — in one request cycle.
          </li>
          <li>
            <strong>No drift.</strong> Both doors register the identical tool set from the same
            code. The paid door is never a fork that ages separately.
          </li>
          <li>
            <strong>Fail-closed.</strong> A service whose paid door isn&apos;t configured answers{' '}
            <code>503</code> with a pointer to the free door — it never silently serves unpaid.
          </li>
        </ul>

        <h2>The doors, today</h2>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Free door</th>
              <th>Paid door</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>funding-mcp.yeetful.com</strong> — cross-chain funding planner
              </td>
              <td>
                <code>/mcp</code>
              </td>
              <td>
                <code>/paid/mcp</code> · $0.02
              </td>
            </tr>
            {FREE_DOORS.map((d) => (
              <tr key={d.host}>
                <td>
                  <strong>{d.host}</strong> — {d.what}
                </td>
                <td>
                  <code>/mcp</code>
                </td>
                <td>—</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Beyond the fleet, the <Link href="/servers">directory</Link> lists ~70 third-party paid
          x402 services the <Link href="/docs/router">router</Link>{' '}can call on your
          agent&apos;s behalf — exact-priced endpoints at or under $0.05 are auto-callable in
          chat.
        </p>
      </div>
    </>
  )
}
