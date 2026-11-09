import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SITE_CARD } from '@/lib/og-defaults'
import { BOT_COMMANDS } from '@/lib/community/spec'
import { COMPOSER_KINDS, VIDEO_HOSTS_LINE, composeHref } from '@/components/community/feed-rules'

// /docs/community (squad community, lane SHARE, 2026-11-09): what a room is,
// how joining works, the four kinds of post, and exactly what the verified
// line on a trade post means. Every fact here is read from the squad's own
// code or its WRAP; the bot commands and the composer's kinds are imported,
// so the page cannot drift from the product. Under 700 words.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'community')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function CommunityDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> COMMUNITY
      </p>
      <h1 className="docs__h1">Community and rooms</h1>
      <p className="docs__lead">
        The <Link href="/community">community feed</Link> is where traders post chart ideas, links, videos and trades, and vote on what holds up. A room is a
        feed with members. Reading needs no wallet and no account.
      </p>

      <div className="docs__prose">
        <h2>Rooms</h2>
        <p>
          A room lives at <code>/g/your-room</code>. It has a feed, a members board and the markets it follows. To start one, sign in and open{' '}
          <Link href="/g/new">Start a room</Link>: pick a name and an address. You are its owner.
        </p>

        <h2>Joining</h2>
        <p>
          Joining is one tap and never needs a wallet. A member is a proven identity: a sign-in (wallet, Google or email), or a Telegram account that Telegram
          itself vouches for. Nothing is signed and nothing is paid. Voting needs an identity but not a seat in the room. Posting in a room needs a seat.
        </p>

        <h2>The four kinds of post</h2>
        <ul>
          <li>
            <strong>{COMPOSER_KINDS[0].label}.</strong> Your lines on a chart, stamped with the time and the price. It cannot be edited afterwards.
          </li>
          <li>
            <strong>{COMPOSER_KINDS[1].label}.</strong> An https link with a title.
          </li>
          <li>
            <strong>{COMPOSER_KINDS[2].label}.</strong> {VIDEO_HOSTS_LINE} It plays in the post after a tap.
          </li>
          <li>
            <strong>{COMPOSER_KINDS[3].label}.</strong> One of your own confirmed transactions, picked from a list. <Link href={composeHref('trade')}>Post one</Link>.
          </li>
        </ul>
        <p>Posts are plain text. Posting asks you to sign in.</p>

        <h2 id="verified">What &ldquo;verified on-chain&rdquo; means</h2>
        <p>
          A trade post carries one line under the verified mark, for example: &ldquo;Verified on-chain: this wallet moved $25.00 on Base&rdquo;. When you post,
          Pantessa reads that transaction from the chain. The line says three things and no more: the author&apos;s wallet sent the transaction, the transaction
          succeeded, and it moved that many dollars. The link beside it opens the transaction on the chain&apos;s explorer.
        </p>
        <p>What it does not mean:</p>
        <ul>
          <li>
            The market and the side (&ldquo;bought ETH&rdquo;) are the author&apos;s own tag. They are printed as &ldquo;Tagged by the author&rdquo;, never under
            the verified mark.
          </li>
          <li>The title is the author&apos;s words, shown in quotes.</li>
          <li>It says nothing about profit, or whether the position is still open.</li>
          <li>Hyperliquid fills cannot be posted as proof yet. There is no chain transaction to read.</li>
        </ul>
        <p>A transaction that moved nothing we can price, such as an approval, is refused. The author can hide the size; the line then says &ldquo;moved funds&rdquo;.</p>

        <h2>Invites</h2>
        <p>
          Every member has one invite link to the room. A join that came through it is counted next to your name on the members board. Invites are counted, never
          paid. An <Link href="/docs/links">intent link</Link> you mint in a post still earns the usual <Link href="/docs/creator-earnings">creator share</Link>.
        </p>

        <h2>Connect a Telegram group</h2>
        <p>
          On the room page, the owner or a mod chooses Connect Telegram and adds the bot to their group. The bot pins a join button, so every member of the group is
          one tap from joined. New posts are announced in the group. The group can ask the bot:
        </p>
        <ul>
          {BOT_COMMANDS.map((c) => (
            <li key={c.name}>
              <code>
                /{c.name}
                {c.args ? ` ${c.args}` : ''}
              </code>{' '}
              {c.does}.
            </li>
          ))}
        </ul>
        <p>
          The bot has to exist first. Until the owner of this deployment has created it, the room page says Telegram is &ldquo;not set up on this deployment&rdquo;
          and there is nothing to connect.
        </p>

        <h2>Connect a Discord channel</h2>
        <p>
          In Discord, create a webhook for the channel and paste its URL on the room page. New posts are announced there. The{' '}
          <code>/pantessa</code> slash commands need a Discord app: until the owner of this deployment has created it they answer &ldquo;not set up on this deployment&rdquo;.
        </p>

        <h2>Who gets announced</h2>
        <p>
          By default only posts by the owner and the mods are announced to a linked Telegram group or Discord channel. The owner can switch that to every member on
          the room page.
        </p>

        <h2>Removing a post or a member</h2>
        <p>
          A post can be removed by its author, or by the room&apos;s owner or a mod. A member can be removed by the owner or a mod; the owner&apos;s seat cannot be.
          The room page has no button for either yet: both are requests to the API, made while signed in as that wallet (<code>DELETE /api/posts/&lt;id&gt;</code>,{' '}
          <code>POST /api/communities/&lt;room&gt;/members/remove</code>).
        </p>
      </div>
    </>
  )
}
