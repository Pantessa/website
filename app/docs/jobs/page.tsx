import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { DocsCallout, DocsCrumbs, DocsNext, DocsStep, DocsSteps, DocsSummary } from '@/components/docs'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SITE_CARD } from '@/lib/og-defaults'

// Jobs API: the external-agent door to the transaction layer. The request
// below is runnable as pasted (dryRun creates nothing). The response samples
// are the SHAPE app/api/jobs/route.ts returns today: titles and steps are what
// lib/jobs compileJobAsk produces for this exact ask; live values (addresses,
// calldata, quotes) are elided with "…". Amounts clear the code's floors
// (HL_MIN_DEPOSIT_USDC = 5, HL_MIN_ORDER_USD = 10 in lib/hyperliquid-exec).

const ASK =
  'bridge 10 usdc from base to arbitrum, then deposit 9 usdc to hyperliquid, then 2x long $12 of eth on hyperliquid, then protect my eth long with a 5% stop'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'jobs')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function JobsDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <DocsCrumbs slug="jobs" />
      <h1 className="docs__h1">Jobs API</h1>
      <p className="docs__lead">
        Send one compound ask, such as &ldquo;bridge, then deposit, then long, then protect it&rdquo;, to{' '}
        <code>POST /api/jobs</code> and get back a step plan. Pantessa builds and checks each step when
        it is offered, and the wallet signs it.
      </p>

      <DocsSummary>
        <li>
          One endpoint: <code>POST /api/jobs</code> with <code>{`{ ask, dryRun }`}</code>.
        </li>
        <li>
          <code>dryRun: true</code> builds and checks step 1 against live venues, then creates nothing
          and signs nothing.
        </li>
        <li>
          Auth is a <code>yf_</code> API key as a Bearer token, or a signed-in (SIWE) session.
        </li>
        <li>The wallet signs every sign step. Waits are checked on-chain between signatures.</li>
        <li>
          A wallet that cannot fund step 1 gets a 400 and no job. A dry run reports the same shortfall.
        </li>
      </DocsSummary>

      <div className="docs__prose">
        <h2>First call</h2>
        <DocsSteps>
          <DocsStep title="Mint an API key">
            <p>
              Create a <code>yf_</code> key on <SpineLink href="/dashboard/keys">/dashboard/keys</SpineLink>{' '}
              and export it as <code>YF_API_KEY</code>.
            </p>
          </DocsStep>
          <DocsStep title="Send a dry run">
            <pre>{`curl -s https://www.pantessa.com/api/jobs \\
  -H "authorization: Bearer $YF_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "ask": "${ASK}",
    "dryRun": true
  }'`}</pre>
          </DocsStep>
          <DocsStep title="Read the plan">
            <p>
              The answer lists every step and shows step 1 as a real, checked transaction. See{' '}
              <a href="#what-comes-back">what comes back</a> below.
            </p>
          </DocsStep>
          <DocsStep title="Run it">
            <p>
              Send the same body without <code>dryRun</code>. That creates the job (201) and offers
              step 1 for signature.
            </p>
          </DocsStep>
        </DocsSteps>
        <p>
          The website repo has the same walk-through as a script:{' '}
          <a
            href="https://github.com/Pantessa/website/blob/main/scripts/jobs-api-demo.ts"
            target="_blank"
            rel="noopener noreferrer"
          >
            scripts/jobs-api-demo.ts
          </a>
          . It authenticates with <code>YF_API_KEY</code>, or with SIWE from a local key, and takes{' '}
          <code>--ask</code>, <code>--base</code> and <code>--live</code>.
        </p>

        <h2 id="what-comes-back">What comes back</h2>
        <p>
          A dry run for the ask above, from a wallet that holds the 10 USDC on Base. The titles and steps
          are exactly what the compiler builds from this ask. Live values are shortened to{' '}
          <code>…</code>.
        </p>
        <pre>{`{
  "dryRun": true,
  "title": "Bridge 10 USDC (base) → USDC (arbitrum) → Deposit 9 USDC to Hyperliquid → 2x Long $12 of ETH on Hyperliquid → Arm stop-loss on ETH (5%)",
  "steps": [
    { "seq": 0, "kind": "sign", "builder": "native-cross-chain",
      "title": "Bridge 10 USDC (base) → USDC (arbitrum)", "waitPredicate": null },
    { "seq": 1, "kind": "wait", "builder": "wait",
      "title": "Solver settles the swap", "waitPredicate": { "kind": "oneclick", "fromStep": 0 } },
    { "seq": 2, "kind": "sign", "builder": "native-hl-exec",
      "title": "Deposit 9 USDC to Hyperliquid", "waitPredicate": null },
    { "seq": 3, "kind": "wait", "builder": "wait",
      "title": "Hyperliquid credits the deposit", "waitPredicate": { "kind": "hl-credit", "minUsd": 8.1 } },
    { "seq": 4, "kind": "sign", "builder": "native-hl-exec",
      "title": "2x Long $12 of ETH on Hyperliquid", "waitPredicate": null },
    { "seq": 5, "kind": "auto", "builder": "native-hl-guardian",
      "title": "Arm stop-loss on ETH (5%)", "waitPredicate": null }
  ],
  "firstSignPreview": {
    "step": 0,
    "artifact": {
      "txRequest": { "to": "0x8335…2913", "data": "0xa9059cbb…", "value": "0", "chainId": 8453, "action": "deposit" },
      "depositAddress": "0x…",
      "summary": "…",
      "addressExpires": "…"
    },
    "guardReport": { "ok": true, "warnings": [], "valueUsd": 10 },
    "valueUsd": 10
  },
  "note": "Nothing was created or signed — re-POST without dryRun to run it."
}`}</pre>
        <p>
          Step 1 here is a USDC <code>transfer</code> on Base to a one-time NEAR Intents deposit address.
          The guard decodes it and checks the recipient and amount against the quote before it is shown.
        </p>
        <p>Two extra fields can appear on a dry run:</p>
        <ul>
          <li>
            <code>preflight</code>: the wallet cannot fund step 1. It holds <code>short</code> (chain,
            symbol, needs, held), <code>reply</code> in words, and sometimes <code>clarify</code> with
            asks that work for this wallet. <code>firstSignPreview</code> then carries{' '}
            <code>refused</code> instead of <code>artifact</code>.
          </li>
          <li>
            <code>unfillable</code>: the plan ends in a buy that no venue can fill right now, so moving
            money first would strand it. A real POST is refused.
          </li>
        </ul>
        <p>
          When step 1 cannot clear its guards, <code>firstSignPreview</code> is{' '}
          <code>{`{ step, refused }`}</code>, with the reason in words. Pantessa never guesses a step it
          cannot build.
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
              <td>The wallet</td>
              <td>
                Built and checked when it is offered, with fresh quotes and balances. A stale build is
                rebuilt, never reused.
              </td>
            </tr>
            <tr>
              <td>
                <code>wait</code>
              </td>
              <td>The runner</td>
              <td>
                Checks settlement on its own (a solver fill, a Hyperliquid credit). It does not take the
                previous step&apos;s word.
              </td>
            </tr>
            <tr>
              <td>
                <code>auto</code>
              </td>
              <td>The runner</td>
              <td>
                Runs under a consent you already gave, such as arming a{' '}
                <Link href="/docs/guardian">Guardian</Link> stop once the position exists.
              </td>
            </tr>
          </tbody>
        </table>

        <h2>Dry run or live</h2>
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
              <td>Plan compiled</td>
              <td>yes</td>
              <td>yes</td>
            </tr>
            <tr>
              <td>Step 1 built and checked live</td>
              <td>yes</td>
              <td>yes</td>
            </tr>
            <tr>
              <td>Wallet can&apos;t fund step 1</td>
              <td>200 with <code>preflight</code></td>
              <td>400, no job created</td>
            </tr>
            <tr>
              <td>Rows created</td>
              <td>none</td>
              <td>the job and its steps (201)</td>
            </tr>
            <tr>
              <td>Can be signed</td>
              <td>no</td>
              <td>step by step, in the chat&apos;s job card or your own UI</td>
            </tr>
            <tr>
              <td>Cost</td>
              <td>nothing</td>
              <td>only what the wallet signs</td>
            </tr>
          </tbody>
        </table>

        <h2>Routes</h2>
        <p>
          Every route accepts the owner&apos;s session or <code>Authorization: Bearer yf_…</code>. The
          routes under <code>/api/jobs/:id</code> also accept the job&apos;s capability token as{' '}
          <code>?t=</code>, which is how the <Link href="/docs/embed">embedded chat</Link> and the{' '}
          <Link href="/docs/desk">agent desk</Link> follow a job without a session.
        </p>
        <table>
          <thead>
            <tr>
              <th>Route</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>POST /api/jobs</code>
              </td>
              <td>
                Compile <code>ask</code>. Dry run: the plan preview. Live: create the job, 201{' '}
                <code>{`{ job }`}</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>GET /api/jobs</code>
              </td>
              <td>Your 20 newest jobs with their steps.</td>
            </tr>
            <tr>
              <td>
                <code>GET /api/jobs/:id</code>
              </td>
              <td>
                The job and its steps, with the artifacts to sign. A poll on a job that is settling moves
                it forward one tick.
              </td>
            </tr>
            <tr>
              <td>
                <code>POST /api/jobs/:id/complete</code>
              </td>
              <td>
                Report a signed step: <code>{`{ seq, result }`}</code>, for example a tx hash. This
                advances the job; it is not proof. The next wait or build checks the chain, so a false
                report fails the job one step later.
              </td>
            </tr>
            <tr>
              <td>
                <code>POST /api/jobs/:id/retry</code>
              </td>
              <td>
                A job waiting on a signature gets a fresh build of the offered step. A failed job re-arms
                its failed step. Both rebuild through the same guarded builder.
              </td>
            </tr>
            <tr>
              <td>
                <code>GET /api/jobs/:id/context</code>
              </td>
              <td>
                What the job&apos;s venues show for the wallet now, such as an open Hyperliquid position and
                its PnL.
              </td>
            </tr>
            <tr>
              <td>
                <code>DELETE /api/jobs/:id</code>
              </td>
              <td>Cancel a job that has not finished.</td>
            </tr>
          </tbody>
        </table>

        <h2>Errors</h2>
        <ul>
          <li>
            <strong>401</strong> <code>{`{ "error": "Not signed in." }`}</code>: no session and no valid
            key.
          </li>
          <li>
            <strong>400</strong> <code>ask is required.</code>
          </li>
          <li>
            <strong>400</strong> <code>Not a compound ask.</code>{' '}A single action belongs in the chat or
            on a chart; a job chains two or more steps with &ldquo;then&rdquo;.
          </li>
          <li>
            <strong>400</strong> <code>Step N: …</code> names the step the compiler could not read. It
            never invents one.
          </li>
          <li>
            <strong>400</strong> with <code>clarify</code>: an ambiguous ticker. Re-POST one of the
            options&apos; <code>resume</code> strings as the ask.
          </li>
          <li>
            <strong>400</strong> with <code>unfillable</code> wording (live only): the final buy has no
            venue right now.
          </li>
          <li>
            <strong>400</strong> pre-flight (live only): the wallet cannot fund step 1.
          </li>
        </ul>
        <pre>{`{
  "error": "🧭 No job was created: its first step spends 10 USDC on Base, and this wallet holds 2.5 USDC there. …",
  "short": { "chainId": 8453, "chain": "Base", "symbol": "USDC", "needs": "10", "held": "2.5" },
  "clarify": { "question": "…", "options": [{ "label": "…", "resume": "…" }] },
  "created": false,
  "note": "No job was created: the wallet cannot fund the first step. Fund it, or re-POST one of the clarify options' resume strings as the ask."
}`}</pre>
        <DocsCallout kind="note">
          <p>
            <code>clarify</code> appears only when there is an ask that works for this wallet. Without it,
            fund the wallet and send the ask again.
          </p>
        </DocsCallout>

        <h2>Where jobs show up</h2>
        <p>
          The same compiler answers in the <SpineLink href="/chat">chat</SpineLink>, in the{' '}
          <Link href="/docs/embed">embed on your site</Link>, and in this API. A person typing the ask
          gets a job card with a sign button per step. Your agent gets the same steps as JSON.
        </p>
      </div>

      <DocsNext
        links={[
          { href: '/docs/desk', desc: 'Let an agent open, negotiate and drive a job over MCP.' },
          { href: '/docs/embed', desc: 'Put the chat, job cards included, on your own site.' },
          { href: '/docs/trust', desc: 'How each step is guarded and priced before anyone signs.' },
        ]}
      />
    </>
  )
}
