import type { Metadata } from 'next'
import Link from 'next/link'
import Footer from '@/components/Footer'
import { SITE } from '@/lib/docs'

/** /rebrand — the public record of the Yeetful → Pantessa rename.
 * Trust surface: dated, factual, zero marketing. It exists so that
 * security reviewers and blocklist maintainers read the rename in our
 * own words instead of discovering the redirect and drawing the obvious
 * (wrong) conclusion. Cited verbatim by the MetaMask appeal and the
 * Blockaid submission (DISCLOSURE-REBRAND.md at the repo root). */

const TITLE = 'Yeetful is now Pantessa'
const DESCRIPTION =
  'On August 5, 2026 Yeetful renamed to Pantessa. Same company, same product, same non-custodial model. yeetful.com redirects here; this page is the public record of what changed and why.'

export const metadata: Metadata = {
  title: `${TITLE} — Pantessa`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/rebrand` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE}/rebrand`, type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const

export default function RebrandPage() {
  return (
    <>
      <main className="x-main">
        <section className="max-w-2xl mx-auto px-4 py-16">
          <div className="flex items-center gap-2 mb-6">
            <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
              Company record · Updated August 11, 2026
            </span>
          </div>

          <h1 className="text-3xl font-semibold text-[color:var(--fg)] mb-3">{TITLE}</h1>

          <p className="text-[15px] leading-relaxed text-[color:var(--muted)] max-w-xl mb-10">
            On August 5, 2026 we renamed the company and product from Yeetful to Pantessa.
            Same team, same product, same model: an agent that builds guarded transactions
            which only your own wallet can sign. Nothing about custody, keys, or fees
            changed with the name.
          </p>

          <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-3">
            What changed
          </h2>
          <ul className="text-[15px] leading-relaxed text-[color:var(--muted)] max-w-xl mb-10 list-disc pl-5 space-y-2">
            <li>
              <span className="text-[color:var(--fg)]">The domain.</span>{' '}
              <span className="mono text-[13px]">www.yeetful.com</span> now redirects (HTTP 307) to{' '}
              <span className="mono text-[13px]">www.pantessa.com</span>. The redirect is
              deliberate and stays up: every previously shared link, embed install, and
              receipt page keeps working.
            </li>
            <li>
              <span className="text-[color:var(--fg)]">The npm package.</span> The SDK ships as{' '}
              <a className="text-[color:var(--accent)] hover:underline underline-offset-2" href="https://www.npmjs.com/package/pantessa" {...ext}>
                pantessa
              </a>{' '}
              from 1.0.0;{' '}
              <a className="text-[color:var(--accent)] hover:underline underline-offset-2" href="https://www.npmjs.com/package/yeetful" {...ext}>
                yeetful
              </a>{' '}
              remains published as the compatibility package for existing installs.
            </li>
            <li>
              <span className="text-[color:var(--fg)]">What deliberately did not change.</span>{' '}
              MCP service hosts (<span className="mono text-[13px]">*.yeetful.com</span>), issued
              API-key prefixes (<span className="mono text-[13px]">yf_</span> /{' '}
              <span className="mono text-[13px]">yfe_</span>), and the embed&apos;s postMessage
              source string. These are wire identifiers baked into installed integrations and
              stored allowlists; renaming them would break software our users already run.
            </li>
            <li>
              <span className="text-[color:var(--fg)]">The GitHub org (August 17, 2026).</span>{' '}
              Renamed from github.com/Yeetful to{' '}
              <a className="text-[color:var(--accent)] hover:underline underline-offset-2" href="https://github.com/Pantessa" {...ext}>
                github.com/Pantessa
              </a>
              . Same repositories, same history, same maintainers; GitHub redirects the old
              org name to the new one.
            </li>
          </ul>

          <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-3">
            The blocklist history, in our own words
          </h2>
          <div className="text-[15px] leading-relaxed text-[color:var(--muted)] max-w-xl mb-10 space-y-4">
            <p>
              Earlier this year, to demonstrate our embeddable chat, we hosted forks of two
              open-source DEX interfaces (the Uniswap interface and CoW Swap) with our embed
              mounted, on our own subdomains. A DEX&apos;s interface served from a domain that
              is not the DEX&apos;s is the exact pattern wallet-security blocklists exist to
              catch, and{' '}
              <span className="mono text-[13px]">uniswap-embed.yeetful.com</span> was listed by
              MetaMask (eth-phishing-detect) and by SEAL.
            </p>
            <p>
              The deployments were ours and never malicious, but the flag caught a real
              pattern, and hosting them was our mistake. We took both sites down permanently,
              archived the repositories in public view, removed every link from our product,
              and adopted a standing internal rule: never host or brand anything that looks
              like someone else&apos;s product. The listed subdomain serves nothing today and
              never will again. Our first removal request,{' '}
              <a
                className="text-[color:var(--accent)] hover:underline underline-offset-2"
                href="https://github.com/MetaMask/eth-phishing-detect/issues/273376"
                {...ext}
              >
                MetaMask/eth-phishing-detect#273376
              </a>
              , was closed on 2026-07-30 after the wrong domains were checked (the two we had
              explicitly placed out of scope, not the listed subdomain); the entry is still live
              on both lists as of 2026-08-18. A new removal request is being filed under our
              name and will be linked here the moment it exists.
              {/* TODO(owner): once Draft A′ (DISCLOSURE-REBRAND.md) is posted, replace this
                  sentence with a link to the new issue and update the table row below. */}
            </p>
          </div>

          <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-3">
            Why this page exists
          </h2>
          <p className="text-[15px] leading-relaxed text-[color:var(--muted)] max-w-xl mb-10">
            A subdomain of yeetful.com sits on two blocklists, and yeetful.com now redirects
            to a brand-new domain. To an automated reputation system, that sequence can
            resemble flagged infrastructure rotating to a fresh name. It is the opposite — a
            rename we are publishing, dating, and signing ourselves, with the old domain kept
            alive precisely so nothing breaks and nothing looks abandoned. If you review
            domains for a wallet, a blocklist, or a security team and want more evidence than
            this page, open an issue on our GitHub org or message{' '}
            <a className="text-[color:var(--accent)] hover:underline underline-offset-2" href="https://x.com/yeetful_ai" {...ext}>
              @yeetful_ai
            </a>{' '}
            — we will answer with transaction receipts, deploy history, and whatever else
            helps.
          </p>

          <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-3">
            Verify it yourself
          </h2>
          <div className="overflow-x-auto mb-12">
            <table className="w-full text-[13px] text-[color:var(--muted)]">
              <tbody className="[&_td]:py-2 [&_td]:pr-4 [&_td]:align-top [&_tr]:border-b [&_tr]:border-[color:var(--line)]">
                <tr>
                  <td className="text-[color:var(--fg)] whitespace-nowrap">The redirect</td>
                  <td>
                    <span className="mono">curl -I https://www.yeetful.com</span> → 307 →{' '}
                    <span className="mono">www.pantessa.com</span>
                  </td>
                </tr>
                <tr>
                  <td className="text-[color:var(--fg)] whitespace-nowrap">The SDK lineage</td>
                  <td>
                    npm packages <span className="mono">pantessa</span> and{' '}
                    <span className="mono">yeetful</span> — same maintainer, cross-referenced
                    READMEs
                  </td>
                </tr>
                <tr>
                  <td className="text-[color:var(--fg)] whitespace-nowrap">The retired forks</td>
                  <td>
                    <span className="mono">uniswap-embed</span> and <span className="mono">cowswap</span>{' '}
                    sit archived (read-only) on github.com/Pantessa (formerly github.com/Yeetful);
                    both deployments return nothing
                  </td>
                </tr>
                <tr>
                  <td className="text-[color:var(--fg)] whitespace-nowrap">The appeal</td>
                  <td>
                    MetaMask eth-phishing-detect issue 273376, filed by us, in our name — closed
                    2026-07-30 on a misread of the domain; a new request is being filed (link
                    to follow here)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/" className="btn btn--solid text-[13px]">
              Go to Pantessa
            </Link>
            <Link
              href="/activity"
              className="mono text-[12px] text-[color:var(--accent)] hover:underline underline-offset-2"
            >
              See live network activity →
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
