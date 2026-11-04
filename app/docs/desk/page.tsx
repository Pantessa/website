import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import DeskTranscript from '@/components/DeskTranscript'
import { SITE_CARD } from '@/lib/og-defaults'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'desk')!

// When the agent-signed loop was last driven end to end. The squad coordinator
// updates this the moment the DRIVE lane's live transcript lands; until then it
// is the day `driveJob` was built and proven against a running deployment.
const PROVEN = 'proven 2026-09-23'

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function DeskDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> GIVE YOUR AGENT HANDS
      </p>
      <h1 className="docs__h1">Give your agent hands</h1>
      <p className="docs__lead">
        Every agent framework is bolting on a wallet. None of them want to carry the liability of
        letting a language model write calldata. Pantessa already solved that — so connect your
        agent over MCP and it gets <strong>money-hands that can&apos;t steal</strong>: it plans in
        plain sentences, deterministic guarded builders write every transaction, and a human (or
        the agent&apos;s own key, under caps) is the only signer. Nothing this surface hands your
        agent can execute by itself.
      </p>

      <div className="my-6">
        <DeskTranscript />
      </div>

      <div className="docs__prose">
        <h2>Two doors</h2>
        <p>
          Both talk in sentences and links — never calldata, typed data, or deposit addresses. Pick
          by whether your agent needs to hear back.
        </p>
        <ul>
          <li>
            <strong>The hands MCP</strong> — fire-and-forget. Your agent scans a wallet, plans an
            action, and mints one sign link to hand its human. Free, no key, instant. Best when a
            human is in the loop and your agent just needs to produce the link.
          </li>
          <li>
            <strong>The desk MCP</strong> — stateful. Your agent opens an intent, negotiates funding
            routes, hands off, and then <em>polls back</em> (<code>broker_status</code>) to learn
            whether its human actually signed — the feedback loop the fire-and-forget hands lacks.
            It also carries the agent-signed path (<code>broker_execute</code>) for sequenced flows
            the agent drives with its own key, and <code>broker_send</code> to address an intent
            straight to a wallet or <code>@handle</code>&apos;s <Link href="/docs/desk">inbox</Link>{' '}
            (they open it and sign — no link to pass, they never had to ask).
          </li>
        </ul>

        <h2>Connect in five minutes</h2>
        <p>The hands MCP — one line in Claude Code (or any MCP client that speaks Streamable HTTP):</p>
        <pre className="splash__code mono">
          claude mcp add --transport http pantessa-hands https://hands-mcp.yeetful.com/mcp
        </pre>
        <p>The desk MCP — the stateful sibling:</p>
        <pre className="splash__code mono">
          claude mcp add --transport http pantessa-desk https://www.pantessa.com/api/broker/mcp
        </pre>
        <p>
          Any MCP client works — point it at the same URLs. Start by calling{' '}
          <code>what_pantessa_can_do</code> (hands) or <code>broker_capabilities</code> (desk): each
          returns the capability map and the handoff contract before you do anything else.
        </p>

        <h2>The loop</h2>
        <ol>
          <li>
            <strong>Scan</strong> — <code>scan_wallet</code>{' '}reads a wallet&apos;s movable money
            across Base, Arbitrum, Optimism, and Ethereum (gas-reserve aware; Arc and Robinhood Chain are funded FROM those), so your plan is grounded in
            what the human actually holds.
          </li>
          <li>
            <strong>Plan</strong> — decide what should happen and phrase it as one plain sentence
            (<em>&ldquo;Buy $12 of AAPL&rdquo;</em>, <em>&ldquo;Swap $5 of ETH to USDC on Base&rdquo;</em>,{' '}
            <em>&ldquo;Protect my HYPE long with a 5% stop&rdquo;</em>). See{' '}
            <Link href="/docs">what Pantessa can build</Link>.
          </li>
          <li>
            <strong>Hand off</strong> — <code>prepare_handoff</code> (hands) or{' '}
            <code>broker_handoff</code> (desk) mints a <code>/i/&lt;slug&gt;</code> sign link. Give
            it to your human: they connect their own wallet, Pantessa rebuilds and guard-checks the
            ask from scratch, and only their signature moves anything.
          </li>
          <li>
            <strong>Hear back</strong> (desk only) — poll <code>broker_status</code> for the
            server-truth funnel: opened → connected → built → signed → settled, with the signed USD.
            Or skip the poll: pass a <code>callback_url</code> to <code>broker_open</code> and
            Pantessa POSTs you a signed webhook the moment your human signs or the move settles
            (<code>X-Pantessa-Signature</code> = HMAC-SHA256 of the body under a secret returned once
            at open). <code>broker_status</code> stays the fallback.
          </li>
        </ol>

        <h2>The agent-signed path</h2>
        <p>
          When your agent holds the funds <em>and</em> the key, it does not need a human at all.{' '}
          <code>broker_execute</code> compiles a sequenced ask (fund → wait for settlement → act)
          into a <strong>job</strong>{' '}owned by the agent&apos;s own wallet, and hands back the job id
          plus a capability token. The agent then fetches each leg from the job API as the runner
          builds it — guarded, policy-checked, one at a time — signs and broadcasts it with its own
          key, and posts completion. The wait legs verify arrival on-chain before the next leg is
          built. <strong>Round-trip across every settlement boundary, batched within one.</strong>
        </p>
        <p>
          <strong>This is live</strong> ({PROVEN}), and the SDK is the whole loop in one call —{' '}
          <code>pantessa@1.1.0</code>, entry point <code>pantessa/desk</code>:
        </p>
        <pre className="splash__code mono">{`import { openAndExecute, driveJob } from 'pantessa/desk'
import { privateKeyToAccount } from 'viem/accounts'

const signer = privateKeyToAccount(process.env.AGENT_KEY as \`0x\${string}\`)
const base = 'https://www.pantessa.com'

const { jobId, token } = await openAndExecute({
  base,
  ask: 'Fund Hyperliquid with $15 from Base, then 2x long $12 of HYPE',
  signer,
  agentKey: process.env.DESK_KEY!,
})

await driveJob({
  base, jobId, token, signer,
  rpc: { 8453: process.env.BASE_RPC! },
  onLeg: (leg) => console.log(\`leg \${leg.seq} · \${leg.kind} · \${leg.summary}\`),
})`}</pre>
        <p>
          <code>driveJob</code>{' '}handles every shape the runner offers so your agent does not have
          to: one EVM transaction; a transaction chain (approve → swap) where the step carrying a
          re-quote recipe is rebuilt server-side right before it is signed; a Hyperliquid L1 action,
          with its one-time builder-fee cap and leverage pre-step; and a <strong>batch</strong>{' '}of
          those actions — signed in one pass, submitted in order inside a single settlement
          boundary, stopping at the first refusal so the runner re-offers from exactly there. A leg
          whose build has aged out is <em>rebuilt, never re-signed</em>. A shape it does not
          recognize — a CoW or Seaport order, which has its own submit endpoint — fails{' '}
          <em>closed</em>, by name. And a transaction that reverts is never posted as a completed
          leg. Pass <code>dryRun: true</code>{' '}to see every leg classified without signing or
          broadcasting anything — on a wallet that cannot fund a leg it comes back with the
          guard&apos;s own sentence instead of a stall.
        </p>
        <p>
          Because this path has no human in the loop, it runs under a tighter fence: it requires a
          bound identity (<code>agent_key</code>, refused by name without one), <em>proof of the
          wallet</em> (<code>wallet_signature</code>{' '}— a personal_sign over the desk&apos;s consent
          text for that intent id + wallet; the desk recovers the signer, so nobody can compile a
          job into a wallet they don&apos;t hold), a per-intent notional cap, and a desk-level kill
          switch. Completion is <em>advancement, not proof</em> — the runner re-verifies on-chain,
          so a leg result the chain disagrees with fails the job closed one leg later. And the desk
          MCP surface itself still carries no transaction material: the signable bytes travel on the
          job API, over the capability token minted at execute.
        </p>

        <h2>Provenance</h2>
        <p>
          An intent can remember where it was born. Pass <code>origin</code> to{' '}
          <code>broker_open</code> or <code>broker_send</code>{' '}
          (<code>{'{ feed: "dune", ref: "5551234", market: "USDC/WETH on Base" }'}</code>) and the desk
          stores it, echoes it from every answer and from <code>broker_status</code>, the sign link says{' '}
          <em>Born from Dune · query 5551234</em>, and your track record counts it. It is your own claim:
          printable text only, each field at most 120 characters, a hash or calldata refused by name.
          It is shown and counted, and that is all — it never routes, prices, funds, or authorizes a
          build. Feeds: <code>dune</code>, <code>hyperliquid</code>, or <code>other</code> with a{' '}
          <code>surface</code> that names the source.
        </p>

        <h2 id="governed-desk">Run a governed desk</h2>
        <div className="docs__callout" data-governed-desk-status="shipped">
          <p>
            <strong>Shipping in this release.</strong> The routes below are the contract the tenant layer is built to (squad five-million, 2026-11-03); the
            page for the firm buying it is <Link href="/desk">/desk</Link>.
          </p>
        </div>
        <p>
          Everything above is one wallet acting for itself. A <strong>tenant</strong> is a firm: a versioned, <strong>default-deny</strong> policy that says which
          venues exist for it, scoped desk keys that can never widen that policy, a gate that <em>blocks</em> (never warns) for a tenant signer, and a hash-chained
          blotter the firm exports. The retail desk is untouched: a <code>yf_</code> key or no key is gated exactly as today.
        </p>
        <h3>1. Create the tenant</h3>
        <p>
          <code>POST /api/tenants</code> <code>{'{ slug, name }'}</code> as a signed-in owner (SIWE) → <code>{'{ id, slug, status: "active", sandbox: true }'}</code>.
          A tenant starts in the sandbox: only Base Sepolia and the Hyperliquid testnet pass the gate until the owner’s plan allows mainnet. <code>GET /api/tenants</code>{' '}
          lists yours; <code>GET</code>/<code>PATCH /api/tenants/:id</code> reads and edits (name, admins, pause). Admins are the owner plus <code>tenant.admins</code>.
        </p>
        <h3>2. Propose a policy, have a different admin approve it</h3>
        <p>
          <code>POST /api/tenants/:id/policy</code> with the policy document proposes version <em>max + 1</em>. It is validated against the vocabulary the builders
          speak — an unknown venue, op, chain, side or a malformed desk id is refused by name at proposal, never discovered at trade time. The shape:
        </p>
        <pre className="splash__code mono">{`{
  "version": 1,
  "default": "deny",
  "venues": [
    { "venue": "cow",        "chains": [1, 8453], "ops": ["swap", "limit"],
      "tokens": ["USDC", "WETH"], "sides": ["buy", "sell"],
      "maxOrderUsd": 500, "maxPriceImpactBps": 50 },
    { "venue": "uniswap-v3", "chains": [8453], "ops": ["swap"], "maxOrderUsd": 500 }
  ],
  "desks": [
    { "id": "macro", "perOrderUsd": 500, "perDayUsd": 5000,
      "approvals": { "overUsd": 250, "approvers": 1 },
      "hours": { "tz": "America/New_York", "from": "07:00", "to": "18:00", "days": [1,2,3,4,5] } }
  ],
  "hooks": { "preTrade": "https://compliance.example.com/pre-trade" },
  "signing": { "lane": "walletconnect", "wallets": ["0x…"] }
}`}</pre>
        <p>
          <strong>Maker-checker:</strong> <code>POST /api/tenants/:id/policy/:version/approve</code> by a <em>different</em> admin activates it (the previously active
          version becomes <code>superseded</code>); <code>…/reject</code> closes a proposal. On a plan without approvals the proposer self-activates. Every proposal,
          activation and rejection is a blotter row.
        </p>
        <h3>3. Mint a desk key</h3>
        <p>
          <code>POST /api/tenants/:id/keys</code> <code>{'{ deskId, label }'}</code> → <code>{'{ secret, id, prefix }'}</code>. The secret (<code>dk_…</code>) is shown
          once; only its sha256 is stored, and <code>prefix</code> (the first 11 characters) is how you recognise it later. The desk id must exist in the{' '}
          <em>active</em> policy. <code>PATCH</code> <code>{'{ paused }'}</code> pauses and resumes; <code>DELETE</code> revokes. Keys per tenant and tenants per owner
          are capped by the plan.
        </p>
        <h3>4. Call the desk with the key</h3>
        <pre className="splash__code mono">{`POST https://www.pantessa.com/api/broker/mcp
Authorization: Bearer dk_…

broker_open { ask: "Buy $25 of ETH on Base" }`}</pre>
        <p>
          A request wearing a desk key is a tenant caller: the key resolves to its tenant, the active policy, its desk and its plan. <code>broker_open</code> plans the
          ask as usual, then the gate judges the order <em>before</em> the desk answers. Allowed → the intent proceeds as any other. Refused → the desk’s own words
          carry <code>gate: "policy"</code> and the reason’s name, and the intent lands <code>refused</code>:
        </p>
        <pre className="splash__code mono">{`{ "gate": "policy", "reason": "CHAIN_DENIED",
  "detail": "uniswap-v3 is allowed on Ethereum, Base; this order is on Arbitrum" }`}</pre>
        <p>
          The reasons: <code>NO_POLICY</code> · <code>TENANT_PAUSED</code> · <code>KEY_PAUSED</code> · <code>DESK_UNKNOWN</code> · <code>VENUE_DENIED</code> ·{' '}
          <code>CHAIN_DENIED</code> · <code>OP_DENIED</code> · <code>TOKEN_DENIED</code> · <code>SIDE_DENIED</code> · <code>UNPRICED</code> · <code>OVER_ORDER</code> ·{' '}
          <code>OVER_DAY</code> · <code>OVER_LEVERAGE</code> · <code>OVER_IMPACT</code> · <code>OUTSIDE_HOURS</code> · <code>SANDBOX_ONLY</code>. An order the desk
          cannot price is <code>UNPRICED</code> and refused — a tenant order is never warned through. A paused key or tenant refuses by name on every tool but{' '}
          <code>broker_status</code> and <code>broker_close</code>.
        </p>
        <h3>5. Approvals over a threshold</h3>
        <p>
          Over the desk’s <code>approvals.overUsd</code> the verdict is <code>allowed</code> with <code>needsApproval: true</code> and the number of approvers;
          the intent waits as <code>awaiting_approval</code>. <code>POST /api/tenants/:id/intents/:intentId/approve</code> by distinct admins (SIWE) counts them, and{' '}
          <code>broker_next</code> refuses to offer a leg until the count is met. <code>broker_handoff</code>, <code>broker_execute</code> and <code>broker_next</code> all
          re-gate; the three relays (<code>/api/tx/refresh</code>, <code>/api/hl/submit</code>, <code>/api/cow/submit</code>) re-judge a leg whose job belongs to a tenant
          from the server’s own record, never a client claim, and refuse <code>403</code> <code>{'{ error, reason }'}</code>.
        </p>
        <p>
          <strong>Who may sign.</strong> A signer joins the tenant’s <code>signers</code> only by proving control: an admin asks for a challenge for the address
          (<code>GET /api/tenants/:id/signers/challenge?address=0x…</code>, a short ASCII text, 15 minutes, single use), the wallet signs that text
          (<code>personal_sign</code>; a Safe or any smart account signs it as a message and the desk verifies EIP-1271 on the chain you name), and{' '}
          <code>POST /api/tenants/:id/signers</code> <code>{'{ address, signature, chainId? }'}</code> registers it. A replayed challenge is refused; when the ledger
          cannot record the burn, nothing is registered. <code>PATCH</code> can only remove signers. A proven signer executes with no EOA consent signature — the desk
          key plus the proven address is the consent — <strong>except</strong> a job with an <code>auto</code> step (a guardian arm, anything the server runs with the
          wallet’s delegation): that always needs the wallet’s own <code>personal_sign</code> consent. When the active policy sets <code>signing.wallets</code>, a
          signer must be in both lists. On the human lane (<code>broker_handoff</code>) a CoW order or a Hyperliquid action carries no link slug and no server-built
          job leg, so the relays never join it to the tenant: it is judged at handoff and not booked in the blotter; <code>/api/tx/refresh</code> legs join by the
          recipe’s own slug.
        </p>
        <h3>6. The blotter, the verify, the statement</h3>
        <p>
          <code>GET /api/tenants/:id/blotter?from&to&kind&format=json|csv</code> exports the rows (CSV needs the plan’s export entitlement). Every row
          hashes the one before it; <code>GET …/blotter/verify</code> replays the chain and answers <code>{'{ ok, rows, brokenAt? }'}</code>.{' '}
          <code>GET …/statement?ym=YYYY-MM</code> cuts the month: the platform fee (waived inside the design-partner window), the tiered execution fee on
          settled notional — chain-verified, or signer-reported for the off-chain venues Hyperliquid and CoW; a signature that never settled is not billed — (or the tenant’s flat bps), less the fees already collected inside transactions on those rows. One statement row per month per
          tenant; when Stripe is configured and the owner has a customer, a draft invoice carries the same three lines.
        </p>
        <h3>7. What it costs</h3>
        <p>
          Self-serve seats (Agent, Desk) are on <Link href="/pricing#desk">/pricing</Link>; the firm-sized desk — platform fee plus tiers, design partners free for the
          first months — is on <Link href="/desk#pricing">/desk</Link>.
        </p>

        <h2>What it costs</h2>
        <p>
          The desk is <strong>free to call</strong> by default — Pantessa earns the link-tier fee on
          the signed volume it clears, not on the calls. When an operator turns on the paid door, the
          value tools (<code>broker_open</code>, <code>broker_execute</code>, <code>broker_send</code>,{' '}
          <code>broker_tile</code>) cost a few cents in USDC per call over x402, while capabilities,
          status, and close stay free. <code>broker_capabilities</code> always advertises the current
          price, so an agent knows before it calls. Your x402 payer address is your desk identity —
          the same address that carries your caps and your{' '}
          <Link href="/docs/desk">track record</Link>.
        </p>

        <h2>The safety contract</h2>
        <p>
          This is the whole point, so it is mechanical, not a promise: the desk re-checks that no
          reply carries transaction bytes, and the deterministic guarded builders — not any model —
          write every transaction on the sign side. Read the{' '}
          <Link href="/docs/trust">trust model</Link> for how a build is guarded, priced, capped,
          and receipted before anyone signs.
        </p>
      </div>
    </>
  )
}
