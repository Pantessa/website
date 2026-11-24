import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsCallout, DocsCrumbs, DocsFacts, DocsNext, DocsStep, DocsSteps, DocsSummary } from '@/components/docs'
import { DOCS_PAGES, docsJsonLd, docsUrl, type DocsPage } from '@/lib/docs'
import { CREATOR_FEE_SPLIT, LINK_FEE_PCT } from '@/lib/fees'
import { SITE_CARD } from '@/lib/og-defaults'
import {
  ADDED_MARK,
  DEAD_BAND,
  DELETED_NOTE,
  JUDGE_DAYS,
  LABEL_CAVEAT,
  FREE_SCANS_PER_DAY,
  PICK_MAX,
  SCAN_ANSWER_PRICE,
  SCAN_POST_CAP,
  SCAN_WINDOW_DAYS,
  STANDING_NOT_VERIFIED,
  TARGET_DAYS,
  TARGET_STOP_MAX,
  VERDICT_WORDS,
  recordHeadline,
  standingVerified,
} from '@/lib/called-it/spec'
import { MIN_JUDGED } from '@/lib/called-it/gtm'
import { CALL_ACT_CAPTION, CALL_ACT_USD } from '@/lib/called-it/acts'
import { TAKEDOWN_EMAIL } from '@/app/x/_lib/profile-rules'

// Called it, for a trader (squad docs-clean, 2026-11-24). Facts from the
// squad's ledger-called-it.md, every number read from lib/called-it (never
// typed). No real account is named: the examples use a placeholder handle.
// Scan limits are the code defaults (lib/called-it/spec); the live site may
// set them by env, so the page says they can change.

/** Until the registry has its entry (lane `front`), the page carries its own. */
const FALLBACK: DocsPage = {
  slug: 'called-it',
  title: 'Called it',
  seoTitle: 'Called it: an X account’s calls, judged by the chart',
  description:
    'Type an X handle and see every call it made on a market, pinned to the chart and judged by what the price did next. Hits and misses both count.',
  ready: true,
  door: 'user',
}
const PAGE = DOCS_PAGES.find((p) => p.slug === 'called-it') ?? FALLBACK

const pct = (x: number) => `${Math.round(x * 100)}%`
const BAND = pct(DEAD_BAND)
const CREATOR_SHARE = CREATOR_FEE_SPLIT === 0.5 ? 'half' : pct(CREATOR_FEE_SPLIT)
const EXAMPLE_HANDLE = 'handle'
const FREE_SCANS = FREE_SCANS_PER_DAY === 1 ? 'one free scan' : `${FREE_SCANS_PER_DAY} free scans`
const EXAMPLE_HEADLINE = recordHeadline(EXAMPLE_HANDLE, 'ETH', 'all', { total: 7, right: 3, wrong: 2, flat: 1, open: 1 })

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function CalledItDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <DocsCrumbs slug="called-it" />
      <h1 className="docs__h1">Called it: an X account&rsquo;s calls, on the chart</h1>
      <p className="docs__lead">
        Type an X handle. See every call it made on a market, pinned to the day it was posted and judged by what the
        price did next.
      </p>

      <DocsSummary>
        <li>Each call is the account&rsquo;s own words, read from X.</li>
        <li>
          The chart judges it: the close {JUDGE_DAYS} days later, or a named level within {TARGET_DAYS} days.
        </li>
        <li>The tally counts every call the scan found, hits and misses. Nobody picks.</li>
        <li>Opening a record is free for everyone. Starting a new scan needs a sign-in.</li>
        <li>Not investment advice.</li>
      </DocsSummary>

      <div className="docs__prose">
        <h2>Open a record</h2>
        <DocsSteps>
          <DocsStep title={<>Go to <Link href="/x">/x</Link></>}>
            <p>Or type a handle on any chart.</p>
          </DocsStep>
          <DocsStep title="Type a handle and pick a market">
            <p>
              The record lives at <span className="mono">/x/&lt;handle&gt;/&lt;SYMBOL&gt;</span>.
            </p>
          </DocsStep>
          <DocsStep title="Read it, or scan it">
            <p>A record someone already scanned opens at once. If it has never been scanned, you can start a scan.</p>
          </DocsStep>
          <DocsStep title="Open a call on the live chart">
            <p>Each call has a button that opens the live chart with that call pinned.</p>
          </DocsStep>
        </DocsSteps>

        <h2>The four verdicts</h2>
        <p>
          Each call is judged on the chart&rsquo;s own daily candles. It is arithmetic, not opinion.
        </p>
        <DocsFacts
          rows={[
            [<strong key="r">{VERDICT_WORDS.right}</strong>, `The close ${JUDGE_DAYS} days after the post moved ${BAND} or more the way the post said.`],
            [<strong key="w">{VERDICT_WORDS.wrong}</strong>, `It moved ${BAND} or more the other way.`],
            [<strong key="f">{VERDICT_WORDS.flat}</strong>, `It moved less than ${BAND} either way.`],
            [<strong key="o">{VERDICT_WORDS.open}</strong>, `The post is under ${JUDGE_DAYS} days old. The move so far is shown; nothing is judged.`],
          ]}
        />
        <h3>A call that names a level</h3>
        <p>
          A post that names a price, a market cap, a percent or a multiple is judged on that level instead. The level must
          be reached within {TARGET_DAYS} days, before the price moves the same distance the other way (that stop is
          capped at {pct(TARGET_STOP_MAX)}). Reached first: {VERDICT_WORDS.right}. Stopped or out of time:{' '}
          {VERDICT_WORDS.wrong}. A day that touches both counts as stopped. A market cap becomes a price with today&rsquo;s
          circulating supply.
        </p>

        <h2>What counts as a call</h2>
        <ul>
          <li>A post that says where the price goes, or tells people what to do. A passing remark is not a call and is never counted.</li>
          <li>A model labels each post bull or bear and must quote the post&rsquo;s own words. A label whose quote is not in the post is dropped.</li>
          <li>The account&rsquo;s own posts only: no replies, no reposts.</li>
          <li>The text, author and time come from X. No model rewrites a post.</li>
        </ul>
        <DocsCallout kind="note">{LABEL_CAVEAT}</DocsCallout>

        <h2>Read the tally</h2>
        <p>The headline counts every call the scan found, in words:</p>
        <p className="mono">{EXAMPLE_HEADLINE}</p>
        <ul>
          <li>Under it, a line says which posts the scan read, and says so when older posts were not read.</li>
          <li>Bull, Bear and All filter the calls. Each shows its count.</li>
          <li>
            The chart pins up to {PICK_MAX} calls. When there are both, they always include the best hit and the worst miss.
          </li>
          <li>
            A hit rate appears only after {MIN_JUDGED}{' '}judged calls (hits plus misses), always as words like &ldquo;5 of 8
            judged calls&rdquo;, never a bare percent.
          </li>
          <li>
            A post a viewer pasted is shown, marked <em>{ADDED_MARK}</em>, and never counted.
          </li>
        </ul>

        <h2>Scanning and its limits</h2>
        <ul>
          <li>A scan reads the account&rsquo;s matching posts up to {SCAN_WINDOW_DAYS} days back and up to {SCAN_POST_CAP} posts. The record says how far back it read.</li>
          <li>A finished scan is fresh for a day. After that a new scan reads only newer posts.</li>
          <li>Any market with a chart here can be scanned.</li>
          <li>
            A new scan needs you to be known: sign in with a wallet, or use Verify with X. Either way you get {FREE_SCANS} a
            day while the day&rsquo;s free pool lasts. After that, with a wallet signed in, a scan costs {SCAN_ANSWER_PRICE}{' '}
            answers from your plan, and nothing is spent until you say yes. These numbers can change.
          </li>
          <li>{DELETED_NOTE} Posts from protected accounts are never shown.</li>
        </ul>

        <h2>Trade from a call</h2>
        <p>
          A bull call offers a ${CALL_ACT_USD} buy. A bear call offers a sell when your wallet holds the token, and a short
          on Hyperliquid where it is listed. Where nothing can run, no button shows. Under the buttons:{' '}
          <em>{CALL_ACT_CAPTION}</em> The account has no part in the button.
        </p>

        <h2>Is it your account?</h2>
        <h3>Verify with X</h3>
        <p>
          Press Verify with X on the account&rsquo;s page and sign in with X. Its records then say &ldquo;{standingVerified(EXAMPLE_HANDLE)}&rdquo; instead
          of &ldquo;{STANDING_NOT_VERIFIED}&rdquo;
        </p>
        <ul>
          <li>
            It proves you own the handle, and it counts as being known for a scan. It does not sign you in to Pantessa, connect
            a wallet or post.
          </li>
          <li>Pantessa keeps only the public profile: user id, handle, name and avatar. The X token is used once and dropped.</li>
          <li>Verified does not mean the calls are right. X&rsquo;s blue check is not our verification.</li>
        </ul>
        <h3>What you earn</h3>
        <p>
          Being plotted, scanned or reposted pays nothing. To earn, mint a link and post it: on a swap through your link the
          fee is <span className="mono">{LINK_FEE_PCT}</span> and {CREATOR_SHARE} of it is yours. Perp trades do not pay
          creators. See <Link href="/docs/creator-earnings">creator earnings</Link>.
        </p>
        <h3>Ask for removal</h3>
        <p>
          Write to <a href={`mailto:${TAKEDOWN_EMAIL}`}>{TAKEDOWN_EMAIL}</a> to have a record taken down.
        </p>

        <h2>Addresses</h2>
        <DocsFacts
          rows={[
            [<span key="1" className="mono">/x</span>, 'The door: type a handle.'],
            [<span key="2" className="mono">/x/&lt;handle&gt;</span>, 'One account, every market plotted for it.'],
            [<span key="3" className="mono">/x/&lt;handle&gt;/&lt;SYMBOL&gt;</span>, 'One record.'],
            [<span key="4" className="mono">?side=bull</span>, 'Bull calls only (or bear).'],
            [<span key="5" className="mono">?call=&lt;postId&gt;</span>, 'One call, leading the record. Share this one.'],
            [<span key="6" className="mono">/t/&lt;SYMBOL&gt;?x=&lt;handle&gt;</span>, 'The same calls on the live chart.'],
          ]}
        />
      </div>

      <DocsNext
        links={[
          { href: '/docs/markets', desc: 'What a chart can do.' },
          { href: '/docs/links', desc: 'Make a link to a trade.' },
          { href: '/docs/creator-earnings', desc: 'How the link fee is split.' },
        ]}
      />
    </>
  )
}
