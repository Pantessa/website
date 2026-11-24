import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { DocsFacts, DocsNext, DocsStep, DocsSteps, DocsSummary } from '@/components/docs'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SITE_CARD } from '@/lib/og-defaults'
import { feePctLabel } from '@/lib/fees'
import { GUARDIAN_DELEGATION_DAYS, GUARDIAN_SLIPPAGE_BPS } from '@/lib/hl-guardian'

// Guardian: a stop-loss or take-profit on a Hyperliquid position, checked
// every minute. What the key is and is not was checked against the code on
// 2026-11-24 (lib/hl-guardian.ts guardGuardianClose, lib/hl-guardian-store.ts
// runGuardianSweep, app/api/hl/submit/route.ts; lane write-safety notes).
// The two sample sentences are the ask ladder's (scripts/audit-asks.ts).

const PAGE = DOCS_PAGES.find((p) => p.slug === 'guardian')!

const PRICE_BOUND_PCT = feePctLabel(GUARDIAN_SLIPPAGE_BPS).replace(/\.00%$/, '%')

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function GuardianDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> SAFETY <span>/</span> GUARDIAN
      </p>
      <h1 className="docs__h1">Guardian: a stop that watches your position</h1>
      <p className="docs__lead">
        Guardian puts a stop-loss or a take-profit on an open Hyperliquid position and checks it every minute. You
        approve it once with your wallet.
      </p>

      <DocsSummary>
        <li>It works on Hyperliquid perp positions on the main book.</li>
        <li>When your price is crossed, it sends a close that can only reduce that position.</li>
        <li>It runs on an agent key Pantessa keeps encrypted. Hyperliquid does not let that key withdraw.</li>
        <li>The approval lasts up to {GUARDIAN_DELEGATION_DAYS} days. You remove it fully in the Hyperliquid app.</li>
        <li>A Guardian close carries no Pantessa fee.</li>
      </DocsSummary>

      <div className="docs__prose">
        <h2>Set one up</h2>
        <DocsSteps>
          <DocsStep title="Open a position on Hyperliquid">
            <p>A long or a short on a Hyperliquid market.</p>
          </DocsStep>
          <DocsStep title="Ask for the stop">
            <p>
              On that market&apos;s chart, press <strong>Protect with a stop</strong> and pick how far away the stop sits. Or
              type it in <SpineLink href="/chat">chat</SpineLink>:
            </p>
            <pre>{`protect my eth long with a 5% stop
take profit on my eth long at $2100`}</pre>
          </DocsStep>
          <DocsStep title="Approve once">
            <p>
              If you have not approved Pantessa&apos;s agent key yet, your wallet asks for that one signature
              first. It is Hyperliquid&apos;s own <code>approveAgent</code> request.
            </p>
          </DocsStep>
          <DocsStep title="Check it on the Guardian screen">
            <p>
              <SpineLink href="/dashboard/guardian">The Guardian screen</SpineLink> lists your stops and every
              time one fired or closed.
            </p>
          </DocsStep>
        </DocsSteps>

        <h2>What the key can and cannot do</h2>
        <ul>
          <li>
            It is a Hyperliquid agent key. Your wallet approves it once, and Pantessa keeps it encrypted.
          </li>
          <li>Hyperliquid does not let an agent key withdraw. Your money stays in your Hyperliquid account.</li>
          <li>
            For a Guardian close, Pantessa&apos;s guard allows one order only: a reduce-only close of the coin and
            side you chose, no larger than your live position, priced within about {PRICE_BOUND_PCT} of the market.
          </li>
          <li>
            The same key also places the Hyperliquid orders you ask for when your wallet cannot sign them itself.
            Each of those needs a signed message from your wallet first. See{' '}
            <Link href="/docs/trust#hyperliquid">the Hyperliquid exception</Link>.
          </li>
          <li>The approval lasts up to {GUARDIAN_DELEGATION_DAYS} days at Hyperliquid.</li>
        </ul>

        <h2>When it fires, and when it does not</h2>
        <p>
          Every minute, Guardian reads your position and the market price. When your stop or target is crossed, it
          builds the close from the live position and checks it again before sending it.
        </p>
        <ul>
          <li>
            <strong>A check fails:</strong> no order is sent and that stop is switched off. The Guardian screen
            shows why, and you can resume it there.
          </li>
          <li>
            <strong>The close does not fill:</strong> the stop stays armed and Guardian tries again the next
            minute.
          </li>
          <li>
            <strong>Your position closed some other way:</strong> the stop retires.
          </li>
          <li>
            <strong>Your account is frozen:</strong> Guardian does not close. It keeps watching and acts once you
            resume.
          </li>
          <li>
            <strong>The approval ran out:</strong> Guardian cannot close, and the stop is switched off. Approve
            again before it ends.
          </li>
        </ul>
        <p>Guardian acts on the price it reads each minute, so a brief move past your stop can fire it.</p>

        <h2>Stop it or remove it</h2>
        <ul>
          <li>
            <strong>Revoke</strong> on the Guardian screen stops Guardian at once and pauses all your stops. Pantessa
            then stops using that key for your orders too.
          </li>
          <li>
            To remove the key at Hyperliquid as well, remove the Pantessa agent from your API wallets in the
            Hyperliquid app. Otherwise Hyperliquid keeps the approval until it expires.
          </li>
          <li>
            <strong>Freeze account</strong> on your dashboard also makes Guardian stand down. See{' '}
            <Link href="/docs/trust#stop">the freeze switch</Link>.
          </li>
        </ul>

        <h2>Reference</h2>
        <DocsFacts
          rows={[
            ['Works on', 'Hyperliquid perps on the main book. Not builder-dex markets yet.'],
            ['Trigger', 'A percent move from your entry price, or a price you name'],
            ['Checked', 'Every minute'],
            ['The close', `One reduce-only order, at most your live position, within about ${PRICE_BOUND_PCT} of the market`],
            ['Approval', <span key="v">Hyperliquid <code>approveAgent</code>, signed by your wallet, up to {GUARDIAN_DELEGATION_DAYS} days</span>],
            ['Pantessa fee', 'None'],
          ]}
        />
      </div>

      <DocsNext
        links={[
          { href: '/docs/trust', title: 'Why you can sign it', desc: 'How every trade is built, checked and signed.' },
          { href: '/docs/markets', title: 'Markets', desc: 'Charts you can act on, Protect included.' },
          { href: '/docs/venues', title: 'Venues', desc: 'Every venue, chain and contract, read from the code.' },
        ]}
      />
    </>
  )
}
