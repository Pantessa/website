import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

// Recurring buys — the two-tier story, told honestly by WALLET TYPE. The
// page's whole job is the EOA vs smart-wallet distinction: confirm-mode is
// universal, autopilot needs contract-enforced permissions, and the reason
// why is a custody argument, not a product gap. Every ask is a prefill
// (?prompt= never auto-sends — the #493 doctrine).

const PAGE = DOCS_PAGES.find((p) => p.slug === 'dca')!

/** Prefill deep link into /chat — the ask arrives in the composer, unsent. */
const ask = (prompt: string, mcps?: string) =>
  `/chat?${mcps ? `mcps=${mcps}&` : ''}prompt=${encodeURIComponent(prompt)}`

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function DcaDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> RECURRING BUYS
      </p>
      <h1 className="docs__h1">Recurring buys: one tap per buy, or none at all</h1>
      <p className="docs__lead">
        Say <Link href={ask('buy $10 of ETH every week')}>&ldquo;buy $10 of ETH every week&rdquo;</Link>{' '}
        and Pantessa keeps a schedule. What happens when a buy comes due depends on your wallet:
        every wallet gets <strong>confirm-mode</strong> — the buy is built fresh and waits for
        your signature, one tap. Smart wallets can go further and arm{' '}
        <strong>autopilot</strong> — one signature caps the spend on-chain, and each period the
        buy executes itself. Your keys never leave your wallet in either tier.
      </p>

      <div className="docs__prose">
        <h2>Confirm-mode — every wallet, you sign each buy</h2>
        <p>
          This is the default, and it works with <em>any</em> wallet: MetaMask, Coinbase Wallet,
          an embedded email wallet, hardware — anything that can sign. The schedule is a
          standing reminder with a transaction attached:
        </p>
        <ul>
          <li>
            <strong>Each period is built fresh.</strong> When a buy is due, chat and the rail
            show a one-tap chip. Tapping it builds the swap <em>at that moment</em> — live
            quote, the same venue cascade and guardrails as any Pantessa swap — and your wallet
            signs it. Nothing is pre-built, so nothing goes stale.
          </li>
          <li>
            <strong>Missed periods lapse.</strong>{' '}Skip a week and it&rsquo;s simply skipped — no
            catch-up buys, no queued spends.
          </li>
          <li>
            <strong>No double buys, ever.</strong> Each calendar period (UTC day / week / month)
            can produce exactly one buy — enforced by a uniqueness claim in the schedule store,
            so racing tabs or repeat taps converge on one transaction.
          </li>
        </ul>
        <p>
          Try it: <Link href={ask('buy $25 of ETH every week on base')}>buy $25 of ETH weekly on Base</Link>{' '}
          · <Link href={ask('buy $10 of AAPL every week on robinhood')}>buy $10 of AAPL weekly on Robinhood Chain</Link>{' '}
          · then <Link href={ask('list my dcas')}>list my dcas</Link>,{' '}
          <Link href={ask('pause my ETH dca')}>pause</Link>, or{' '}
          <Link href={ask('cancel my ETH dca')}>cancel</Link> any time.
        </p>

        <h2>Autopilot — smart wallets, zero taps</h2>
        <p>
          On Base, a schedule owned by a <strong>smart wallet</strong>{' '}(a wallet that is itself a
          contract — e.g. Coinbase Smart Wallet) can be armed:{' '}
          <Link href={ask('make my ETH dca autonomous')}>&ldquo;make my ETH dca autonomous&rdquo;</Link>.
          Arming is <em>one</em> EIP-712 signature over a{' '}
          <a href="https://github.com/coinbase/spend-permissions" target="_blank" rel="noopener noreferrer">
            Spend Permission
          </a>{' '}
          — and the signature is the entire grant. It says, precisely:
        </p>
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>What it pins</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Allowance</td>
              <td>
                <strong>Exactly your per-period amount</strong>{' '}— a $10/week schedule signs a
                $10-per-week cap. Not a balance approval, not &ldquo;unlimited&rdquo;.
              </td>
            </tr>
            <tr>
              <td>Period</td>
              <td>Your cadence window (day / week / month) — the cap resets on that clock and never stacks.</td>
            </tr>
            <tr>
              <td>Token</td>
              <td>The chain&rsquo;s canonical USDC — the spend side only. Nothing else is touchable.</td>
            </tr>
            <tr>
              <td>Spender</td>
              <td>One named Pantessa executor address. No one else can use the permission.</td>
            </tr>
            <tr>
              <td>Expiry</td>
              <td>One year — permissions are never signable-forever; re-arm to continue.</td>
            </tr>
          </tbody>
        </table>
        <p>
          The crucial part: that cap is enforced by <strong>your wallet&rsquo;s own contract</strong>{' '}
          (Coinbase&rsquo;s audited SpendPermissionManager), on-chain. If Pantessa&rsquo;s servers
          were compromised tomorrow, the attacker&rsquo;s ceiling would still be your $10 this
          week — and you can revoke the permission from your wallet at any moment, no Pantessa
          involvement required.
        </p>
        <h3>What an autopilot buy actually does</h3>
        <ol>
          <li>
            <strong>Build first, money later.</strong>{' '}The hourly sweep builds the swap with a
            live quote, then an independent guard re-decodes the raw calldata: exact pull
            amount, USDC in, your schedule&rsquo;s token out, the registry-pinned router, and the
            output recipient must be <em>your wallet</em>. Any mismatch refuses the run —{' '}
            <em>before</em> anything is pulled.
          </li>
          <li>
            <strong>Pull exactly the allowance.</strong>{' '}The executor pulls your $X of USDC
            through the permission — the contract refuses anything more.
          </li>
          <li>
            <strong>Swap, output straight to you.</strong>{' '}The bought token lands in your
            wallet, never in Pantessa&rsquo;s. A receipt row appears in your rail — same as a
            buy you signed yourself.
          </li>
        </ol>
        <p>
          Buys route through the same venues and carry the same visible 0.20% fee as any
          Pantessa swap. If you buy a period manually, autopilot notices and stands down — no
          double buys across tiers either. The <Link href="/docs/spend-policy">kill switch</Link>{' '}
          pauses pulls instantly, and{' '}
          <Link href={ask('turn off my dca autopilot')}>&ldquo;turn off autopilot&rdquo;</Link> drops the
          schedule back to confirm-mode (the on-chain permission stays yours to revoke).
        </p>

        <h2>Why EOAs can&rsquo;t autopilot (yet) — the honest version</h2>
        <p>
          A regular wallet (an EOA — MetaMask, a hardware wallet, an embedded email wallet) has
          exactly one credential: its private key. There is no such thing as delegating{' '}
          <em>part</em>{' '}of an EOA — any key or session that can sign a $10 swap can sign a
          full-balance transfer. So &ldquo;let Pantessa buy for me&rdquo; from an EOA would mean
          Pantessa holding a key to everything, which is custody with extra steps. We don&rsquo;t
          do that — it&rsquo;s the same reason the{' '}
          <Link href="/docs/guardian">Guardian</Link> only works on Hyperliquid, where the venue
          itself scopes delegated keys to trading-only.
        </p>
        <p>
          A smart wallet is different <em>structurally</em>: it&rsquo;s a contract, so it can
          enforce rules about who may move what, how much, and how often — without ever
          exposing a key. That contract-shaped permission is exactly what autopilot rides.
        </p>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>EOA (MetaMask &amp; friends)</th>
              <th>Smart wallet (Coinbase Smart Wallet)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Recurring buys</td>
              <td>✓ confirm-mode — one tap per buy</td>
              <td>✓ confirm-mode <em>and</em> autopilot</td>
            </tr>
            <tr>
              <td>Who signs each buy</td>
              <td>You, every period</td>
              <td>Armed: nobody — the permission covers it</td>
            </tr>
            <tr>
              <td>What Pantessa can spend</td>
              <td>Nothing, ever, without your signature</td>
              <td>At most $X per period, contract-enforced</td>
            </tr>
            <tr>
              <td>Emergency exit</td>
              <td>Just don&rsquo;t sign</td>
              <td>Revoke on-chain / kill switch / &ldquo;turn off autopilot&rdquo;</td>
            </tr>
          </tbody>
        </table>
        <p>
          The gap is closing from the EOA side: <strong>EIP-7702</strong>{' '}(live since
          Ethereum&rsquo;s Pectra upgrade) lets an EOA adopt smart-account code — MetaMask
          already offers the upgrade — at which point the same permission model applies.
          Support for 7702-upgraded wallets is on the roadmap; today, if you arm from an EOA,
          chat will tell you exactly this instead of pretending.
        </p>

        <h2>Quick answers</h2>
        <ul>
          <li>
            <strong>What if an autopilot buy fails?</strong>{' '}The failure is recorded on the
            schedule (the rail badges it — that&rsquo;s the <em>only</em> time autopilot nags
            you), nothing retries into a second pull that period, and the next period starts
            clean.
          </li>
          <li>
            <strong>Can I still buy manually while armed?</strong>{' '}Yes — your manual buy wins
            the period and autopilot defers.
          </li>
          <li>
            <strong>Which chains?</strong>{' '}Confirm-mode: Base, Ethereum, Arbitrum, Robinhood
            Chain. Autopilot: Base first (it&rsquo;s where the Spend Permission contract and deep
            USDC liquidity live); tokenized-stock autopilot on Robinhood Chain is on the
            roadmap.
          </li>
          <li>
            <strong>Where do I watch it?</strong>{' '}The <em>Jobs</em> tab in the chat rail shows
            every schedule and its receipts; each buy also lands in your{' '}
            <Link href="/dashboard">dashboard</Link> history.
          </li>
        </ul>
        <p>
          Start one now:{' '}
          <Link href={ask('buy $10 of ETH every week on base')}>buy $10 of ETH every week</Link>{' '}
          — then, if your wallet qualifies,{' '}
          <Link href={ask('make my ETH dca autonomous')}>make it autonomous</Link>.
        </p>
      </div>
    </>
  )
}
