import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

// Jobs API — the external-agent door to the transaction layer. Every snippet
// on this page is runnable as pasted (dryRun costs $0 and creates nothing);
// the sample output is a REAL run, not a mock — the action-chips honesty
// rule, applied to docs.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'jobs')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function JobsDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> JOBS
      </p>
      <h1 className="docs__h1">Jobs: one intent, every step guarded</h1>
      <p className="docs__lead">
        A job is a compound intent — &ldquo;bridge, <em>then</em> deposit, <em>then</em> long,{' '}
        <em>then</em>{' '}protect it&rdquo; — compiled into a step plan the runner executes with you:
        it builds and guard-checks each transaction only when it&rsquo;s offered, your wallet
        signs, and settlement waits are verified server-side between signatures. External agents
        get the same rails through one endpoint: <code>POST /api/jobs</code>.
      </p>

      <div className="docs__prose">
        <h2>Try it for $0 right now</h2>
        <p>
          <code>dryRun</code> compiles your ask and builds + guard-checks step&nbsp;1 against{' '}
          <strong>live venues</strong>{' '}— real quotes, real balances, real refusals — but creates
          nothing, signs nothing, and costs nothing. It&rsquo;s the test mode <em>and</em> the
          docs playground:
        </p>
        <pre>{`curl -s https://www.pantessa.com/api/jobs \\
  -H "authorization: Bearer $YF_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "ask": "swap 5 usdc from base to arbitrum, then deposit 5 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop",
    "dryRun": true
  }'`}</pre>
        <p>
          Mint the <code>yf_</code> key at{' '}
          <Link href="/dashboard/keys">/dashboard/keys</Link>{' '}— or skip the key entirely and run
          the repo&rsquo;s demo script, which can also authenticate as your wallet via SIWE:
        </p>
        <pre>{`npx tsx scripts/jobs-api-demo.ts            # dryRun against prod
npx tsx scripts/jobs-api-demo.ts --live     # actually creates the job`}</pre>

        <h2>What comes back</h2>
        <p>
          Real output (a funded test wallet, live NEAR Intents quote — trimmed for width). Note
          what&rsquo;s in it: the compiled plan, and step&nbsp;1 as an <em>actual transaction</em>{' '}
          with its guard report and priced value — not a description of one.
        </p>
        <pre>{`{
  "dryRun": true,
  "title": "Bridge 5 USDC (base) → USDC (arbitrum) → Deposit 4 USDC to
            Hyperliquid → Long $12 of ETH on Hyperliquid → Arm stop-loss on ETH (5%)",
  "steps": [
    { "seq": 0, "kind": "sign", "builder": "native-cross-chain", "title": "Bridge 5 USDC …" },
    { "seq": 1, "kind": "wait", "builder": "wait", "waitPredicate": { "kind": "oneclick" } },
    { "seq": 2, "kind": "sign", "builder": "native-hl-exec", "title": "Deposit 4 USDC …" },
    { "seq": 3, "kind": "wait", "builder": "wait", "waitPredicate": { "kind": "hl-credit" } },
    { "seq": 4, "kind": "sign", "builder": "native-hl-exec", "title": "Long $12 of ETH …" },
    { "seq": 5, "kind": "auto", "builder": "native-hl-guardian", "title": "Arm stop-loss …" }
  ],
  "firstSignPreview": {
    "step": 0,
    "artifact": {
      "txRequest": { "to": "0x833589…2913", "data": "0xa9059cbb…", "chainId": 8453 },
      "summary": "Send 5.0 USDC on Base to NEAR Intents deposit address 0xA046…917E —
                  solvers then deliver ~4.99 USDC on Arbitrum (ETA ~34s)"
    },
    "guardReport": { "ok": true, "warnings": [] },
    "valueUsd": 5
  },
  "note": "Nothing was created or signed — re-POST without dryRun to run it."
}`}</pre>
        <p>
          If the build can&rsquo;t clear its guards, you get the reason instead of the artifact —
          same shape, <code>refused</code> instead of <code>artifact</code>. A real one:{' '}
          <code>
            &ldquo;Wallet holds only 2.52 USDC on Arbitrum — bridge funds there first (cross-chain
            swap).&rdquo;
          </code>{' '}
          The layer refuses honestly; it never guesses.
        </p>

        <h2>Step kinds</h2>
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Who acts</th>
              <th>What happens</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>sign</code>
              </td>
              <td>Your wallet</td>
              <td>
                Built + guard-checked <em>at offer time</em> (fresh quotes, current balances),
                then offered for signature. Artifacts expire; stale ones are rebuilt, not reused.
              </td>
            </tr>
            <tr>
              <td>
                <code>wait</code>
              </td>
              <td>The runner</td>
              <td>
                Settlement verification — solver fill, Hyperliquid credit — polled server-side.
                Waits <em>verify</em>; they don&rsquo;t trust the previous step&rsquo;s word.
              </td>
            </tr>
            <tr>
              <td>
                <code>auto</code>
              </td>
              <td>The runner</td>
              <td>
                Server-side under an existing consent — e.g. arming a{' '}
                <Link href="/docs/guardian">Guardian</Link> stop once the position exists.
              </td>
            </tr>
          </tbody>
        </table>

        <h2>dryRun vs live</h2>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>
                <code>dryRun: true</code>
              </th>
              <th>
                <code>dryRun: false</code>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Compile + plan preview</td>
              <td>✓</td>
              <td>✓</td>
            </tr>
            <tr>
              <td>Step 1 built + guarded live</td>
              <td>✓</td>
              <td>✓</td>
            </tr>
            <tr>
              <td>Rows created</td>
              <td>none</td>
              <td>the job + its steps</td>
            </tr>
            <tr>
              <td>Can be signed</td>
              <td>no</td>
              <td>step by step, from the chat JobCard or your own UI</td>
            </tr>
            <tr>
              <td>Cost</td>
              <td>$0</td>
              <td>whatever you sign — and only that</td>
            </tr>
          </tbody>
        </table>

        <h2>Auth, and the rest of the surface</h2>
        <ul>
          <li>
            <strong>Two auth paths, full parity:</strong> a SIWE session (the browser) or{' '}
            <code>Authorization: Bearer yf_…</code> (a headless agent). Same compile, same
            builds, same list at <code>GET /api/jobs</code>.
          </li>
          <li>
            <strong>Watch a job:</strong> <code>GET /api/jobs/:id</code>{' '}returns the job + steps
            with artifacts. Replies that compile a job also carry a per-job capability token —
            it&rsquo;s how the <Link href="/docs/embed">embedded chat&rsquo;s</Link> JobCard
            follows a job without a session, scoped to exactly that job.
          </li>
          <li>
            <strong>Cancel:</strong> <code>DELETE /api/jobs/:id</code>. Unfilled swaps auto-refund;
            waits time out closed, never open.
          </li>
          <li>
            <strong>Bad asks refuse honestly:</strong> a single-step ask belongs to the{' '}
            <Link href="/docs/transactions">native layer</Link> (400 tells you so), and a
            compound ask with an uncompilable segment names the exact step it couldn&rsquo;t
            build instead of improvising one.
          </li>
        </ul>

        <h2>Recurring buys (DCA) — a schedule, not an authorization</h2>
        <p>
          Add a cadence and a one-step intent becomes a standing one:
        </p>
        <pre>{`buy $10 of AAPL every week
dca $25 into ETH daily on base`}</pre>
        <p>
          That creates a <strong>confirm-mode schedule</strong>. Nothing signs itself: each due
          period (UTC day, week, or month) compiles a fresh one-step swap job — same builders,
          same guards, quoted at offer time — and <strong>you sign that buy</strong>. Miss a
          week and the period lapses; the schedule never buys behind your back and never
          double-buys a period. Manage it in the same sentence register:{' '}
          <code>pause my AAPL dca</code>, <code>resume my dca</code>,{' '}
          <code>cancel my ETH dca</code>, <code>list my recurring buys</code> — or from the Jobs
          tab in the chat rail. Sizing is dollar-denominated on purpose: a schedule&apos;s
          contract is a fixed spend per period, so token-unit asks get an honest correction
          instead of a guessed price.
        </p>

        <h2>Where jobs show up</h2>
        <p>
          The same compiler answers everywhere: the <Link href="/chat">first-party chat</Link>,
          the <Link href="/docs/embed">embed on your site</Link>, and this API. A user typing the
          ask above gets a JobCard with a sign button per step; your agent POSTing it gets the
          same steps as JSON. Signed value lands in your{' '}
          <Link href="/dashboard">dashboard</Link> either way — the receipt is the product.
        </p>
      </div>
    </>
  )
}
