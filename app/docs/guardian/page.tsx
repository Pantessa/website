import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

// Guardian — autonomy without custody. The trust story is the whole page:
// what the delegated key CAN'T do is the product.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'guardian')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function GuardianDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> GUARDIAN
      </p>
      <h1 className="docs__h1">Guardian: autonomy without custody</h1>
      <p className="docs__lead">
        A stop-loss that fires at 3am needs <em>someone</em> awake. Guardian is that someone —
        with a key that can do exactly one thing: reduce the position you told it to protect.
        One signature delegates it; everything it does lands as a receipt.
      </p>

      <div className="docs__prose">
        <h2>Arm it in a sentence</h2>
        <p>
          In <Link href="/chat">chat</Link> (or the <Link href="/docs/embed">embed</Link>), with
          a Hyperliquid position open:
        </p>
        <pre>{`protect my eth long with a 5% stop
take profit on my eth long at $2100`}</pre>
        <p>
          No delegation yet? You&rsquo;ll get the one-time <code>approveAgent</code>{' '}signature
          first — Hyperliquid&rsquo;s own delegation primitive, signed by your wallet, expiring
          on its own schedule. Policies can also arm as the final{' '}
          <code>auto</code> step of a <Link href="/docs/jobs">job</Link>: &ldquo;…then protect it
          with a 5% stop&rdquo; arms the policy the moment the long fills.
        </p>

        <h2>What the delegated key cannot do</h2>
        <p>The delegation is an agent key on Hyperliquid&rsquo;s L1 — not your private key. It:</p>
        <ul>
          <li>
            <strong>cannot withdraw</strong>{' '}— funds never move off the exchange under it,
          </li>
          <li>
            <strong>cannot open or grow positions</strong>{' '}— every guardian order is
            reduce-only, sized to the live position,
          </li>
          <li>
            <strong>cannot touch other assets</strong>{' '}— the policy pins one coin, one side,
          </li>
          <li>
            <strong>expires</strong>{' '}— and you can revoke it or hit the{' '}
            <Link href="/docs/spend-policy">kill switch</Link> any time.
          </li>
        </ul>

        <h2>Fail-closed at fire time</h2>
        <p>
          A cron sweep watches armed policies every minute. When a trigger crosses, the close is{' '}
          <em>rebuilt from scratch</em> and re-guarded before submission — the guard refuses if
          anything drifted:
        </p>
        <ul>
          <li>the order isn&rsquo;t reduce-only, is oversized, or targets the wrong asset or side,</li>
          <li>the delegation lapsed or was revoked, or the kill switch is on,</li>
          <li>the trigger is no longer true at build time (a wick, not a move),</li>
          <li>a price bound would fill worse than the policy allows.</li>
        </ul>
        <p>
          Any failed check means <strong>no order</strong>. The sweep logs the refusal and tries
          again next tick if the trigger still holds. Guardian never improvises.
        </p>

        <h2>Receipts, like everything else</h2>
        <p>
          Every armed policy, every trigger evaluation that fires, every close: a receipt on{' '}
          <Link href="/dashboard/guardian">/dashboard/guardian</Link> with the position, the
          trigger, the fill, and the guarded value. Autonomy you can audit beats autonomy you
          have to trust.
        </p>

        <h2>The shape of the thing</h2>
        <table>
          <thead>
            <tr>
              <th>Piece</th>
              <th>What it is</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Delegation</td>
              <td>
                Hyperliquid <code>approveAgent</code>{' '}— your wallet&rsquo;s one-time EIP-712
                signature naming a server-held agent key, with an expiry.
              </td>
            </tr>
            <tr>
              <td>Policy</td>
              <td>
                One coin, one side, one trigger (percent stop or absolute take-profit), armed
                from chat or as a job&rsquo;s <code>auto</code> step.
              </td>
            </tr>
            <tr>
              <td>Sweep</td>
              <td>Per-minute cron: evaluate triggers → rebuild → re-guard → submit or refuse.</td>
            </tr>
            <tr>
              <td>Guard</td>
              <td>
                The same fail-closed pattern as every <Link href="/docs/transactions">native
                venue</Link>: the artifact is re-derived and checked against the policy at the
                last moment, never replayed from storage.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
