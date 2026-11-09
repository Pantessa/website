// Pins for squad community, lane FEED (2026-11-09). The lane owns this
// file and fills it; the harness (scripts/test-api.ts) already calls both
// exports, so a lane never edits test-api.ts or package.json.
//   npx tsx scripts/community-feed-pins.ts            (npm run pins:community-feed)
//   BASE=http://localhost:PORT npx tsx scripts/community-feed-pins.ts --served

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSiweMessage } from 'viem/siwe'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { COMMUNITY_HREF, isCommunityPath, isPublicAppPath, isTelegramEntryPath } from '../lib/app-entry'
import { isMarketsPath } from '../lib/markets'
import { parseVideoUrl, type FeedPost } from '../lib/community/spec'
import { X_MENTION } from '../lib/social'
import { SITE_URL } from '../lib/site-url'
import {
  COMPOSER_FOLDED_LINE,
  COMPOSER_KINDS,
  HELD_VOTE_TTL_MS,
  VIDEO_HOSTS_LINE,
  VIDEO_IFRAME_SANDBOX,
  X_LIMIT,
  X_URL_WEIGHT,
  asciiLine,
  feedHref,
  fmtScore,
  heldVoteRecord,
  isVerified,
  nextVote,
  optimisticScore,
  postPath,
  postShareText,
  roomInviteUrl,
  roomSlugOfUrl,
  sameTradeAsk,
  shareUrl,
  takeHeldVote,
  telegramShareHref,
  tradeFact,
  xShareHref,
  xWeight,
  CALL_NEXT_LABEL,
  COMMUNITY_NEW_HREF,
  PROOF_DOOR_LABEL,
  PROOF_DOOR_TITLE,
  composeHref,
  fillsSeenMark,
  jobStepTxs,
  noRoomLine,
  preselectFill,
  proofDoorHref,
  readComposeQuery,
  readFeedSort,
  stripComposeQuery,
  symbolRoomsHref,
} from '../components/community/feed-rules'
import { DOCS_PAGES } from '../lib/docs'
import { FIXTURE_POSTS } from './community-feed-fixtures'

type Check = (name: string, ok: boolean, extra?: string) => void

const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
/** Source with comments stripped: a pin reads the code, never a sentence about it. */
const code = (rel: string) =>
  src(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/** Pure pins: no server, no network, no DB. */
export function communityFeedPins(check: Check): void {
  const by = (id: string) => FIXTURE_POSTS.find((p) => p.id === id)!
  const idea = by('fx1idea0001')
  const trade = by('fx2trade001')
  const hidden = by('fx5trade002')
  const noProof = by('fx7trade003')
  const video = by('fx3video001')
  const xVideo = by('fx6videox01')

  // ── sharing: X's weighted count, plain ASCII, the link last ──
  {
    const long: Pick<FeedPost, 'kind' | 'symbol' | 'title' | 'proof'> = { kind: 'idea', symbol: 'UNI', title: `${'A very long call that keeps going '.repeat(12)}“curly” — dash… 🚀 日本語`, proof: null }
    const cases = [...FIXTURE_POSTS, long]
    const bad: string[] = []
    for (const p of cases) {
      const text = postShareText(p)
      const u = new URL(xShareHref(text, shareUrl(postPath('abc123def'))))
      const sent = u.searchParams.get('text') ?? ''
      const link = u.searchParams.get('url') ?? ''
      const total = xWeight(sent) + 1 + X_URL_WEIGHT
      if (u.origin !== 'https://twitter.com' || u.pathname !== '/intent/tweet') bad.push(`host ${u.href.slice(0, 40)}`)
      if (total > X_LIMIT) bad.push(`over ${total}: ${sent.slice(0, 40)}`)
      if (!/^[\x20-\x7E]*$/.test(sent)) bad.push(`not ascii: ${sent.slice(0, 40)}`)
      if (sent.startsWith('@')) bad.push('opens with a mention')
      if ((sent.match(new RegExp(X_MENTION, 'g')) ?? []).length !== 1) bad.push('names us other than once')
      if (/https?:\/\//.test(sent)) bad.push('a link inside the text')
      if (!link.startsWith(`${SITE_URL}/c/`)) bad.push(`link ${link}`)
    }
    check('community feed: every X share fits 280 on X\'s own count (text + space + a 23-weight link), is plain ASCII, names us once and never first, and carries the link in `url` (last)', bad.length === 0, bad.slice(0, 3).join(' | '))

    const tg = new URL(telegramShareHref(postShareText(trade), shareUrl('/c/abc123def')))
    check(
      'community feed: the Telegram share is t.me/share/url with the link in `url` and the line in `text`; Discord has no share URL (the sheet copies the link and says so)',
      tg.origin === 'https://t.me' && tg.pathname === '/share/url' && tg.searchParams.get('url') === `${SITE_URL}/c/abc123def` && /Verified on-chain: this wallet moved/.test(tg.searchParams.get('text') ?? '') &&
        /Pastes into Discord and anywhere else/.test(src('components/community/ShareSheet.tsx')) && /navigator\.share/.test(code('components/community/ShareSheet.tsx')),
    )
    check(
      'community feed: asciiLine turns typographic punctuation into ASCII and drops the rest; xWeight counts Latin 1 and CJK / emoji 2',
      asciiLine('“a” — b… c’s d 🚀') === '"a" - b... c\'s d' && xWeight('abc') === 3 && xWeight('日本') === 4 && xWeight('🚀') === 2,
      asciiLine('“a” — b… c’s d 🚀'),
    )
    check(
      'T4 share line: an idea leads with the cashtag once and is "Time and price stamped"; a TRADE leads with what the chain confirmed and quotes the typed title as the author\'s words (never "$BTC: Bought $5,000,000…" as the lead); a trade with no proof says so',
      postShareText(idea) === '$UNI 1D: reclaim of 7.10 holds, target the September high. Time and price stamped.' &&
        postShareText(trade) === 'Verified on-chain: this wallet moved $2,500.00 on Base. The author says: "Added on the sweep of the range low"' &&
        postShareText({ ...trade, title: 'Bought $5,000,000 of BTC at the low' }).startsWith('Verified on-chain: this wallet moved $2,500.00 on Base. The author says:') &&
        postShareText(noProof) === 'A trade post with no proof on record. The author says: "Bought the dip, trust me"' &&
        postShareText(xVideo) === 'Clip from the Fed presser, the one line that moved the two-year.',
      `${postShareText(trade)} | ${postShareText(noProof)}`,
    )
    check(
      'community feed: a room link is recognised only as /g/<slug> with no invite on it, and the member\'s invite code rides as ?via= (a malformed code is dropped)',
      roomSlugOfUrl('/g/uni-desk') === 'uni-desk' && roomSlugOfUrl(`${SITE_URL}/g/uni-desk`) === 'uni-desk' && roomSlugOfUrl('/g/uni-desk?via=abc123') === null && roomSlugOfUrl('/c/abc') === null && roomSlugOfUrl('/g/new/x') === null &&
        roomInviteUrl('uni-desk', 'abc123') === `${SITE_URL}/g/uni-desk?via=abc123` && roomInviteUrl('uni-desk', 'BAD CODE') === `${SITE_URL}/g/uni-desk` && roomInviteUrl('uni-desk', null) === `${SITE_URL}/g/uni-desk`,
    )
  }

  // ── the video frame: only after the tap, sandboxed, no referrer ──
  {
    const card = code('components/community/PostCard.tsx')
    const frames = card.match(/<iframe\b/g) ?? []
    const gate = card.indexOf('if (playing && video.embedUrl)')
    const frameAt = card.indexOf('<iframe')
    const posterAt = card.indexOf('onClick={() => setPlaying(true)}')
    const frameTag = card.slice(frameAt, card.indexOf('/>', frameAt))
    check(
      'community feed: the card holds ONE video iframe, mounted only inside the `playing` branch (state set by the poster\'s tap, false at mount), wearing sandbox="allow-scripts allow-same-origin allow-presentation", referrerPolicy no-referrer, loading lazy and allow="fullscreen; picture-in-picture"',
      frames.length === 1 && gate > 0 && frameAt > gate && posterAt > frameAt && /const \[playing, setPlaying\] = useState\(false\)/.test(card) &&
        VIDEO_IFRAME_SANDBOX === 'allow-scripts allow-same-origin allow-presentation' && /sandbox=\{VIDEO_IFRAME_SANDBOX\}/.test(frameTag) && /referrerPolicy="no-referrer"/.test(frameTag) &&
        /loading="lazy"/.test(frameTag) && /allow="fullscreen; picture-in-picture"/.test(frameTag) && !/allow-top-navigation|allow-popups|allow-forms/.test(VIDEO_IFRAME_SANDBOX),
      `frames=${frames.length} gate=${gate} frame=${frameAt} poster=${posterAt}`,
    )
    check(
      'community feed: a host with no embed (X) is a link out, never a frame; every user link opens in a new tab with rel="noopener noreferrer nofollow ugc"',
      /post\.kind === 'video' && post\.video && !post\.video\.embedUrl \? post\.video\.url/.test(card) && /post\.kind === 'video' && post\.video\?\.embedUrl && <VideoBlock/.test(card) &&
        /href=\{outLink\} target="_blank" rel="noopener noreferrer nofollow ugc"/.test(card) && xVideo.video?.embedUrl === null && !!video.video?.embedUrl,
    )
    check(
      'community feed: the composer checks a pasted video with the shared rule (parseVideoUrl), posts the REBUILT url, and names the hosts that work when it does not parse',
      /parseVideoUrl\(url\)/.test(code('components/community/Composer.tsx')) && /payload\.mediaUrl = video\?\.url/.test(code('components/community/Composer.tsx')) && VIDEO_HOSTS_LINE === 'YouTube, Vimeo, Loom and X links work here.' &&
        parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=9')?.url === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' && parseVideoUrl('https://evil.example/v/1') === null,
    )
  }

  // ── "verified" is literal ──
  {
    const card = code('components/community/PostCard.tsx')
    const rules = code('components/community/feed-rules.ts')
    const literal = (card.match(/verified on-chain/g) ?? []).length
    const factAt = card.indexOf('function TradeFact')
    const literalAt = card.indexOf('verified on-chain')
    check(
      'community feed: the words "verified on-chain" are printed in ONE place (TradeFact), mounted only when isVerified(post) — proof.verification === \'verified\'; a trade post with no proof says so and shows no fact',
      literal === 1 && literalAt > factAt && /const verified = isVerified\(post\)/.test(card) && /const proof = verified \? post\.proof : null/.test(card) &&
        /post\.kind === 'trade' && proof && <TradeFact post=\{post\} \/>/.test(card) && /post\.kind === 'trade' && !proof && <p className="cmy-card__noproof">/.test(card) &&
        /return post\.proof\?\.verification === 'verified'/.test(rules) &&
        isVerified(trade) && isVerified(hidden) && !isVerified(noProof) && !isVerified({ proof: { ...trade.proof!, verification: 'attested' as never } }),
      `literal=${literal}`,
    )
    const f1 = tradeFact(trade.proof!, trade.symbol)
    const f2 = tradeFact(hidden.proof!, hidden.symbol)
    check(
      'S1/S9 card: the fact line is ONLY what the chain confirmed ("Verified on-chain: this wallet moved $2,500.00 on Base" / "moved funds on Arbitrum"); the market + side are a separate line in the author\'s words, rendered OUTSIDE the verified box; never the title',
      f1.fact === 'Verified on-chain: this wallet moved $2,500.00 on Base' && f1.tag === 'Tagged by the author: bought ETH' &&
        f2.fact === 'Verified on-chain: this wallet moved funds on Arbitrum' && f2.tag === 'Tagged by the author: went short SOL' && !f1.fact.includes(trade.title) && !/ETH/.test(f1.fact) &&
        tradeFact({ ...trade.proof!, side: null, symbols: [], sizeUsd: null }, '').tag === null &&
        /<\/div>\s*\{fact\.tag && <p className="cmy-fact-tag" data-unverified="">\{fact\.tag\}<\/p>\}/.test(card) && /\{fact\.fact\}/.test(card),
      `${f1.fact} | ${f1.tag} | ${f2.fact}`,
    )
    check(
      'T4 card: a trade card\'s <h3> headline and aria-label are the proof\'s headline (tradeHeadline), the typed title follows as the author\'s words',
      /const trade = post\.kind === 'trade' \? tradeHeadline\(\{ title: post\.title, proof \}\) : null/.test(card) && /const headText = trade \? trade\.headline : post\.title/.test(card) &&
        /aria-label=\{headText\}/.test(card) && /\{trade\?\.authorWords && <p className="cmy-card__said"/.test(card) && !/aria-label=\{post\.title\}/.test(card),
    )
    const s1 = sameTradeAsk(trade.proof!, trade.symbol)
    const s2 = sameTradeAsk(hidden.proof!, hidden.symbol)
    check(
      'community feed: "do the same" is one sentence in the chips\' own grammar (lib/trade-asks), $25 by default, gated like every chip (canSellAsk + canTradeAsk); an idea\'s chips are its line actions through the same two gates',
      s1?.ask === 'Buy $25 of ETH' && s2?.ask === 'Short $25 of SOL on Hyperliquid' && sameTradeAsk({ ...trade.proof!, side: null }, 'ETH') === null && sameTradeAsk(trade.proof!, 'NOTATICKERXYZ') === null &&
        /\.filter\(\(a\) => canSellAsk\(a, held\) && canTradeAsk\(a, tradable\)\)/.test(card) && /useHeld\(\)/.test(card) && /useTradable\(\)/.test(card),
      `${s1?.ask} | ${s2?.ask}`,
    )
    check(
      'community feed: the card never computes a move: an idea links to its stamped call (/c/<id>), where the time and the price are stamped',
      !/movePct|fmtMove|stampFromBars/.test(card) && /Stamped call/.test(card) && postPath('abc123') === '/c/abc123',
    )
  }

  // ── votes ──
  {
    const votes = code('components/community/VoteButtons.tsx')
    const door = code('components/community/useIdentityDoor.tsx')
    const now = 1_762_700_000_000
    const rec = heldVoteRecord('p1', 1, now)
    check(
      'community feed: a vote — the same arrow again clears it, the score moves by the difference, and a held vote is taken once for its own post while fresh (ten minutes)',
      nextVote(0, 1) === 1 && nextVote(1, 1) === 0 && nextVote(1, -1) === -1 && nextVote(-1, -1) === 0 &&
        optimisticScore(10, 0, 1) === 11 && optimisticScore(10, 1, -1) === 8 && optimisticScore(10, -1, 0) === 11 &&
        takeHeldVote(rec, 'p1', now + 5_000) === 1 && takeHeldVote(rec, 'p2', now + 5_000) === null && takeHeldVote(rec, 'p1', now + HELD_VOTE_TTL_MS + 1) === null && takeHeldVote(rec, 'p1', now - 1) === null && takeHeldVote('nope', 'p1', now) === null &&
        fmtScore(999) === '999' && fmtScore(1250) === '1.3k' && fmtScore(-4) === '-4' && fmtScore(14_300) === '14k',
    )
    check(
      'community feed: VoteButtons posts { value } to /api/posts/<id>/vote, undoes the tap on a 401 and HOLDS the vote behind the unified door (useIdentityDoor: CreateAccountModal with NO redirectTo, never the raw wallet list), casts it when a session lands; both arrows wear aria-pressed',
      /fetch\(`\/api\/posts\/\$\{postId\}\/vote`, \{ method: 'POST'/.test(votes) && /if \(r\.status === 401\) \{\s*undo\(\)/.test(votes) && /hold\(\(\) => void cast\(to\)\)/.test(votes) &&
        (votes.match(/aria-pressed=/g) ?? []).length === 2 && /<CreateAccountModal onClose=\{\(\) => setDoorOpen\(false\)\} \/>/.test(door) && !/redirectTo=/.test(door) && !/openConnectModal/.test(door) && !/openConnectModal/.test(votes) &&
        /connectAskReleased\(/.test(door),
    )
    const css = src('components/community/community.css')
    check('community feed: under a thumb the vote arrows, the foot actions, the tabs and the chips are 44px', /@media \(hover: none\) \{[\s\S]*\.cmy-vote__btn \{ width: 44px; height: 44px; \}[\s\S]*\.cmy-tabs__tab \{ min-height: 44px; \}[\s\S]*\.cmy-chip \{ min-height: 44px; \}/.test(css))
  }

  // ── the list + the composer ──
  {
    const list = code('components/community/FeedList.tsx')
    const comp = code('components/community/Composer.tsx')
    const posts = src('lib/chart-posts.ts')
    check(
      'community feed: the list reads GET /api/feed (hot by default; `window` rides only on top; the cursor pages), with ONE act door for every chip in it',
      feedHref({ sort: 'hot' }) === '/api/feed?sort=hot' && feedHref({ community: 'uni-desk', sort: 'top', window: 'day', cursor: 'c1', limit: 25 }) === '/api/feed?community=uni-desk&sort=top&window=day&cursor=c1&limit=25' &&
        feedHref({ symbol: 'ETH', sort: 'new', window: 'day' }) === '/api/feed?symbol=ETH&sort=new' && /initialSort = 'hot'/.test(list) && (list.match(/useConnectToAct\(/g) ?? []).length === 1 && /data-feed-empty/.test(list) && /Load more/.test(list),
    )
    check(
      'community feed: the composer opens folded ("Share a chart idea, a link, a video or a trade") on four kinds (idea, link, video, trade), with the forum\'s own title and body caps',
      COMPOSER_FOLDED_LINE === 'Share a chart idea, a link, a video or a trade' && COMPOSER_KINDS.map((k) => k.kind).join(',') === 'idea,link,video,trade' && /useState\(false\)/.test(comp) &&
        /export const COMPOSER_TITLE_MAX = 120/.test(comp) && /export const POST_TITLE_MAX = 120/.test(posts) && /export const COMPOSER_BODY_MAX = 2000/.test(comp) && /export const POST_BODY_MAX = 2_000/.test(posts),
    )
    check(
      'community feed: a trade post types nothing about the trade — it lists GET /api/me/fills, sends proofTurnId + showSize (default on) and no symbol; the composer says only chain-confirmed trades appear',
      /fetch\(`\/api\/me\/fills\?/.test(comp) && /payload\.proofTurnId = picked/.test(comp) && /payload\.showSize = showSize/.test(comp) && /useState\(true\)\s*\n\s*const \[fills/.test(comp.replace(/const \[showSize, setShowSize\] = /, '')) &&
        /if \(kind !== 'trade' && sym\) payload\.symbol = sym/.test(comp) && /Only transactions the chain confirmed from your wallet appear here\. The market is your own tag/.test(comp) && /data-fills-empty/.test(comp),
    )
    check(
      'community feed: posting signed out HOLDS the post behind the unified door (no redirectTo) and keeps the draft (sessionStorage); a 403 needsJoin offers "Join … and post" (the join route, then the post again)',
      /if \(!address\) \{\s*hold\(\(\) => void sendRef\.current\(\)\)/.test(comp) && /window\.sessionStorage\.setItem\(DRAFT_KEY/.test(comp) && !/redirectTo/.test(comp) && !/openConnectModal/.test(comp) &&
        /r\.status === 403 && d\.needsJoin/.test(comp) && /fetch\(`\/api\/communities\/\$\{room\}\/join`, \{ method: 'POST'/.test(comp) && /and post/.test(comp),
    )
    check(
      'community feed: an idea attaches the page\'s chart when it has one for the market, else a door to draw it on /t/<sym>?tab=chart',
      /Attach my current chart/.test(comp) && /href=\{`\/t\/\$\{sym\}\?tab=chart`\}/.test(comp) && /payload\.chartState = chartState/.test(comp),
    )
  }

  // ── the spine + the public paths ──
  {
    const spine = src('components/AppSpine.tsx')
    const aside = spine.slice(spine.indexOf('<aside'), spine.indexOf('</aside>'))
    const nav = spine.slice(spine.indexOf('<nav'), spine.indexOf('</nav>'))
    const sheet = spine.slice(spine.indexOf('<Sheet id="more"'))
    const order = (part: string) => Array.from(part.matchAll(/aria-label="(MARKETS|WALLET|COMMUNITY|LEADERS|ANALYTICS|DOCS|Settings)"/g), (m) => m[1]).join(' ')
    check(
      'community feed: the spine seats COMMUNITY directly above LEADERS in the column and the bar (MARKETS · WALLET · COMMUNITY · LEADERS · ANALYTICS · DOCS · Settings among the page seats), folded behind MORE on a phone (max-sm:hidden on the bar, a row in the MORE sheet above Leaderboard)',
      order(aside) === 'MARKETS WALLET COMMUNITY LEADERS ANALYTICS DOCS Settings' && order(nav) === 'MARKETS WALLET COMMUNITY LEADERS ANALYTICS DOCS Settings' &&
        /aria-label="COMMUNITY"\s+aria-current=\{onCommunity \? 'page' : undefined\}\s+className=\{cn\(PHONE_SEAT, 'max-sm:hidden'/.test(nav) &&
        sheet.indexOf('href={COMMUNITY_HREF} role="menuitem"') > 0 && sheet.indexOf('href={COMMUNITY_HREF} role="menuitem"') < sheet.indexOf('href={LEADERBOARD_HREF} role="menuitem"'),
      `column: ${order(aside)} | bar: ${order(nav)}`,
    )
    check(
      'community feed: the COMMUNITY seat is a plain link to /community (never a SpineLink: the page is public), lit by PATH (isCommunityPath) so a room page in the markets frame lights it and MARKETS goes dark; MORE wears the tick there',
      COMMUNITY_HREF === '/community' && (spine.match(/<Link\s+href=\{COMMUNITY_HREF\}/g) ?? []).length === 3 && !/<SpineLink\s+href=\{COMMUNITY_HREF\}/.test(spine) &&
        /const onCommunity = isCommunityPath\(pathname\)/.test(spine) && /const onMarkets = surface === 'markets' && !onCommunity/.test(spine) && /const moreLit = moreLitFor\(surface, phoneScreen\) \|\| onCommunity/.test(spine),
    )
    check(
      'community feed: /community, every room path (/g, /g/<slug>, /g/new) and Telegram\'s Mini App entry (/tg) are public app paths; a call page, the wallet and look-alikes are not community paths',
      ['/community', '/community/', '/community?sort=new', '/community#rooms', '/g', '/g/uni-desk', '/g/uni-desk?via=abc123', '/g/new'].every((p) => isCommunityPath(p) && isPublicAppPath(p)) &&
        ['/tg', '/tg?startapp=g_uni-desk', '/tg/'].every((p) => isTelegramEntryPath(p) && isPublicAppPath(p) && !isCommunityPath(p)) &&
        !['/communities', '/c/abc123', '/go', '/gx/uni', '/tgx', '/wallet', '/dashboard', '/chat/abc'].some((p) => isCommunityPath(p) || isTelegramEntryPath(p)) &&
        !isPublicAppPath('/wallet') && !isPublicAppPath('/communities') && !isMarketsPath('/community') && !isMarketsPath('/g/uni-desk'),
    )
    check(
      'community feed: the brochure nav hides on the community surface, the sitemap lists /community, and the page is static with a one-minute revalidate (never force-dynamic)',
      /if \(isCommunityPath\(pathname\)\) return null/.test(src('components/Navigation.tsx')) && /\$\{SITE\}\/community`/.test(src('app/sitemap.ts')) &&
        /export const revalidate = 60/.test(code('app/community/page.tsx')) && !/force-dynamic/.test(code('app/community/page.tsx')) && /<h1 className="cmy-page__title">Chart ideas, videos and trades with proof<\/h1>/.test(src('app/community/page.tsx')),
    )
    const cpage = code('app/c/[id]/page.tsx')
    const tab = code('components/markets/community/CommunityTab.tsx')
    check(
      'community feed: /c/<id> carries every kind — an idea keeps the call page with its votes and the share sheet; a video, a trade or a link renders as its card at full length with the replies under it; the symbol tab keeps fork, copy-lines and inline replies and gains the vote, the share sheet and hot / new / top',
      /if \(!feedPost \|\| feedPost\.kind === 'idea'\) notFound\(\)/.test(cpage) && /<PostCard post=\{feedPost\} showCommunity full \/>/.test(cpage) && /<VoteButtons postId=\{post\.id\}/.test(cpage) && /<ShareSheet url=/.test(cpage) &&
        /<CallComments postId=\{feedPost\.id\}/.test(cpage) && /Copy these lines to my chart/.test(tab) && /<VoteButtons postId=\{post\.id\}/.test(tab) && /<ShareSheet url=\{callPath\(post\.id\)\}/.test(tab) && /FEED_SORTS\.map/.test(tab) && /Most executed/.test(tab) &&
        /forkOf: post\.id/.test(tab) && /canSellAsk\(/.test(tab) && /canTradeAsk\(/.test(tab),
    )
  }

  // ── lane SHARE (2026-11-09): the shortest path into the feed ──
  {
    const comp = code('components/community/Composer.tsx')
    check(
      'community share: ?compose= opens the composer on the right tab (idea · link · video · trade, any case), &symbol= pre-picks a market-shaped symbol only, anything else opens nothing',
      COMPOSER_KINDS.every((k) => readComposeQuery(`?compose=${k.kind}`)?.kind === k.kind) &&
        readComposeQuery('?compose=TRADE')?.kind === 'trade' &&
        readComposeQuery('?compose=trade&symbol=ETH')?.symbol === 'ETH' &&
        readComposeQuery('?compose=idea&symbol=xyz:AAPL')?.symbol === 'xyz:AAPL' &&
        readComposeQuery('?compose=idea&symbol=%3Cscript%3E')?.symbol === '' &&
        readComposeQuery('?compose=poll') === null &&
        readComposeQuery('?tab=community') === null &&
        readComposeQuery('') === null,
    )
    check(
      'community share: the compose query is STRIPPED from the address (a reload or a copied URL never re-opens it); every other query and the hash stay; composeHref builds the same address the reader reads',
      stripComposeQuery('/community', '?compose=trade') === '/community' &&
        stripComposeQuery('/community', '?compose=trade&symbol=ETH&sort=new') === '/community?sort=new' &&
        stripComposeQuery('/g/eth-swing', '?via=abc123&compose=idea', '#rooms') === '/g/eth-swing?via=abc123#rooms' &&
        stripComposeQuery('/t/ETH', '?tab=community&compose=video') === '/t/ETH?tab=community' &&
        composeHref('trade') === '/community?compose=trade' &&
        composeHref('idea', { symbol: 'ETH' }) === '/community?compose=idea&symbol=ETH' &&
        composeHref('trade', { room: 'eth-swing' }) === '/g/eth-swing?compose=trade' &&
        composeHref('trade', { room: '../evil' }) === '/community?compose=trade' &&
        readComposeQuery(composeHref('video', { symbol: 'UNI' }).split('?')[1])?.kind === 'video',
    )
    check(
      'community share: the Composer reads the query itself (so /community, a room and the symbol tab all get it), from the address bar, inside its own Suspense, then rewrites the address with history.replaceState; a link-asked tab wins over a saved draft; still no redirectTo and no wall',
      /readComposeQuery\(live\)/.test(comp) &&
        /const live = window\.location\.search/.test(comp) &&
        /window\.history\.replaceState\(window\.history\.state, '', stripComposeQuery\(window\.location\.pathname, live, window\.location\.hash\)\)/.test(comp) &&
        (comp.match(/<Suspense fallback=\{null\}>\s*<ComposeQueryReader onQuery=\{onComposeQuery\} \/>\s*<\/Suspense>/g) ?? []).length === 2 &&
        /if \(!askedRef\.current\) setKind\(k\.kind\)/.test(comp) &&
        !/redirectTo/.test(comp) &&
        /\{busy \? 'Posting' : address \? 'Post' : 'Sign in and post'\}/.test(comp),
    )
    const f = (turnId: string, signedAt: number) => ({ turnId, signedAt })
    check(
      'community share: the trade tab pre-picks the ONE fill that is new since the last look; none or several new ones pre-pick nothing; the mark is the newest fill time ever listed',
      preselectFill([f('a', 300), f('b', 200), f('c', 100)], 200) === 'a' &&
        preselectFill([f('a', 300), f('b', 200)], 100) === null &&
        preselectFill([f('a', 300)], 300) === null &&
        preselectFill([f('a', 300)], null) === 'a' &&
        preselectFill([f('a', 300), f('b', 200)], null) === null &&
        preselectFill([], null) === null &&
        fillsSeenMark([f('a', 300), f('b', 200)], 250) === 300 &&
        fillsSeenMark([f('a', 100)], 250) === 250 &&
        fillsSeenMark([], null) === null &&
        /const pre = preselectFill\(d\.fills, seen\)/.test(comp) &&
        /if \(pre\) setPicked\(\(cur\) => cur \?\? pre\)/.test(comp),
    )

    // the receipt's door: gated on a mined transaction the proof reader can read
    const H = `0x${'ab'.repeat(32)}`
    const door = code('components/community/PostProofDoor.tsx')
    const chat = code('components/ChatInterface.tsx')
    const job = code('components/JobCard.tsx')
    check(
      'community share: "Post it with proof" is offered ONLY for a receipt holding a mined tx hash on a registry chain (Base, Ethereum) — never for no txs, an unknown chain (a Hyperliquid order has no registry chain), an order uid, or a malformed hash; the door goes to /community?compose=trade',
      proofDoorHref([{ hash: H, chainId: 8453 }]) === '/community?compose=trade' &&
        proofDoorHref([{ hash: H, chainId: 1 }]) === '/community?compose=trade' &&
        proofDoorHref([{ hash: '0x1234', chainId: 8453 }, { hash: H, chainId: 8453 }]) === '/community?compose=trade' &&
        proofDoorHref([]) === null &&
        proofDoorHref(null) === null &&
        proofDoorHref([{ hash: H, chainId: 1337 }]) === null &&
        proofDoorHref([{ hash: H, chainId: 999_999_999 }]) === null &&
        proofDoorHref([{ hash: `0x${'ab'.repeat(56)}`, chainId: 8453 }]) === null &&
        proofDoorHref([{ hash: H }]) === null &&
        proofDoorHref([{ chainId: 8453 }]) === null,
    )
    check(
      'community share: a done job offers the door only from steps that left a confirmed tx (an order step with no txs, a failed step and a pending step contribute nothing)',
      proofDoorHref(jobStepTxs([{ status: 'done', result: { txHash: H, txs: [{ hash: H, chainId: 8453, title: 'Swap' }] } }])) === '/community?compose=trade' &&
        proofDoorHref(jobStepTxs([{ status: 'done', result: { status: 'filled', oid: 123 } }])) === null &&
        proofDoorHref(jobStepTxs([{ status: 'failed', result: { txs: [{ hash: H, chainId: 8453 }] } }])) === null &&
        proofDoorHref(jobStepTxs([{ status: 'pending', result: null }])) === null &&
        jobStepTxs([{ status: 'done', result: { txs: 'nope' } }]).length === 0,
    )
    check(
      'community share: the door is mounted beside the receipt share — in the chat only inside the signed + settled row (signedTxsOf + claimsSettled), never in the embed, fed the receipt\'s own txs; on a done job fed its steps\' txs; it renders nothing without a provable tx and opens a new tab (rel="noopener") so the thread stays mounted',
      /<ShareReceiptButton kind="tx" chatId=\{currentChatId\} messageId=\{msg\.dbId\} \/>\s*\{!embedded && <PostProofDoor txs=\{signedTxsOf\(msg\.meta\)\} \/>\}/.test(chat) &&
        /signedTxsOf\(msg\.meta\)\.length > 0 &&\s*claimsSettled\(msg\.meta\) &&\s*currentChatId &&\s*msg\.dbId && \(/.test(chat) &&
        /<ShareReceiptButton kind="job" refId=\{jobId\} \/>\s*<PostProofDoor txs=\{jobStepTxs\(job\.steps\)\} \/>/.test(job) &&
        /const href = proofDoorHref\(txs\)\s*if \(!href\) return null/.test(door) &&
        /target="_blank" rel="noopener"/.test(door) &&
        !/redirectTo/.test(door),
    )
    const guide = code('lib/guide.ts')
    const docs = src('app/docs/community/page.tsx')
    const strip = code('components/markets/community/RoomsStrip.tsx')
    check(
      'community share: the new doors never put "verified" beside anything typed — the receipt door, its tooltip, the chart\'s next step, the room line and the guide hint do not use the word at all; the docs page says the market and side are the author\'s tag, never under the verified mark',
      PROOF_DOOR_LABEL === 'Post it with proof' &&
        [PROOF_DOOR_LABEL, PROOF_DOOR_TITLE, CALL_NEXT_LABEL, noRoomLine('ETH')].every((t) => !/verif/i.test(t) && !/[—–]/.test(t)) &&
        !/verif/i.test(door) &&
        !/verif/i.test(strip) &&
        /id: 'proof'[\s\S]*?body: 'A trade post shows what the chain confirmed, and a reader can do the same trade from the card\.'/.test(guide) &&
        /are the author&apos;s own tag/.test(docs) &&
        /never under\s+the verified mark/.test(docs) &&
        /Hyperliquid fills cannot be posted as proof yet/.test(docs),
    )

    // the chart's next step, and the feed by address
    const share = code('components/markets/chart/ChartShare.tsx')
    const cfeed = code('components/community/CommunityFeed.tsx')
    check(
      'community share: a published call ends with ONE next step into the feed ("See it in the community" → /community?sort=new, a new tab so the chart stays), shown only once the call exists; /community reads ?sort= and gives the list its own first read for a sort the server did not render',
      CALL_NEXT_LABEL === 'See it in the community' &&
        COMMUNITY_NEW_HREF === '/community?sort=new' &&
        readFeedSort('?sort=new') === 'new' &&
        readFeedSort('?sort=top') === 'top' &&
        readFeedSort('?sort=loud') === null &&
        readFeedSort('') === null &&
        /\{call \? \([\s\S]*?data-call-next=""[\s\S]*?<Link href=\{COMMUNITY_NEW_HREF\}[^>]*target="_blank" rel="noopener"[^>]*>\s*\{CALL_NEXT_LABEL\}/.test(share) &&
        (share.match(/data-call-next/g) ?? []).length === 1 &&
        /<FeedList key=\{sort\} initialSort=\{sort\} initial=\{sort === 'hot' \? initial : null\} refreshKey=\{key\} \/>/.test(cfeed),
    )

    // rooms on the symbol page
    const tab = code('components/markets/community/CommunityTab.tsx')
    const css = src('components/markets/comm.css')
    check(
      'community share: the symbol tab shows the rooms that follow the market as ONE line above the composer — one read (GET /api/communities?symbol=<SYM>&limit=3), name + members + a link to the room, no join button; no room → "No room follows <SYM> yet." with the door to /g/new; a failed read shows nothing; the line is capped at 56px',
      symbolRoomsHref('ETH') === '/api/communities?symbol=ETH&limit=3' &&
        noRoomLine('ETH') === 'No room follows ETH yet.' &&
        /<RoomsStrip symbol=\{sym\} \/>\s*<FeedComposer symbol=\{sym\}/.test(tab) &&
        /fetch\(symbolRoomsHref\(symbol\)\)/.test(strip) &&
        /if \(rooms === 'error'\) return null/.test(strip) &&
        /href=\{communityPath\(r\.slug\)\}/.test(strip) &&
        /<Link href="\/g\/new" data-door="start-room">\s*Start one\.\s*<\/Link>/.test(strip) &&
        !/JoinButton/.test(strip) &&
        /\.mkc__rooms \{[^}]*max-height: 56px/.test(css),
    )

    // the docs page is registered beside its siblings
    const i = DOCS_PAGES.findIndex((d) => d.slug === 'community')
    check(
      'community share: /docs/community is in the docs registry (ready, the creators\' door, right after Creator earnings), so the sidebar, the landing and the sitemap list it',
      i > 0 && DOCS_PAGES[i].ready && DOCS_PAGES[i].door === 'creator' && DOCS_PAGES[i - 1].slug === 'creator-earnings' && DOCS_PAGES[i].seoTitle.length <= 60 && DOCS_PAGES[i].description.length <= 160,
      `i=${i} seo=${DOCS_PAGES[i]?.seoTitle.length} desc=${DOCS_PAGES[i]?.description.length}`,
    )
  }
}

// ── served ───────────────────────────────────────────────────────────────

/** The main checkout's convention: the worktree's .env.local carries the TEST DB + the burner. tsx does not load it. */
function loadEnvLocal() {
  if (process.env.DATABASE_URL && process.env.PRIVATE_KEY && process.env.SESSION_SECRET) return
  try {
    const text = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!m || process.env[m[1]] !== undefined) continue
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    }
  } catch {
    /* the harness already has its env */
  }
}

function cookieOf(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return `${name}=${m[1]}`
  }
  return null
}

async function signIn(base: string, account: PrivateKeyAccount): Promise<string> {
  const nonceRes = await fetch(`${base}/api/auth/nonce`, { cache: 'no-store' })
  const nonceCookie = cookieOf(nonceRes, 'yf_siwe_nonce')
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(base).host, nonce, uri: base, version: '1' })
  const signature = await account.signMessage({ message })
  const res = await fetch(`${base}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: nonceCookie } : {}) }, body: JSON.stringify({ message, signature }) })
  const session = cookieOf(res, 'yf_session')
  if (!session) throw new Error(`SIWE sign-in failed (${res.status})`)
  return session
}

const INTERNAL = { 'x-yf-internal-run': '1' }

/** Served pins: against a running `next start` (BASE) on the standard harness belt + the TEST DB.
 *  Every row written carries the internal-run header and is cleaned up. */
export async function communityFeedPinsServed(check: Check, base: string): Promise<void> {
  // ── a stranger reads the page: no wallet, no cookie ──
  const res = await fetch(`${base}/community`, { headers: INTERNAL, redirect: 'manual', cache: 'no-store' })
  const html = await res.text()
  const lit = (h: string, seat: string) => (h.match(new RegExp(`aria-label="${seat}" aria-current="page"`, 'g')) ?? []).length
  check(
    'community feed (served): /community answers 200 to a stranger in the markets frame — the h1, the composer folded, the feed list, no sign-in wall, no brochure nav; COMMUNITY lit in the column and the bar, MARKETS not',
    res.status === 200 && /<h1 class="cmy-page__title">Chart ideas, videos and trades with proof<\/h1>/.test(html) && /data-community="feed"/.test(html) && /data-composer="" data-open="false"/.test(html) && /data-feed-list=""/.test(html) &&
      !/<header class="nav/.test(html) && lit(html, 'COMMUNITY') === 2 && lit(html, 'MARKETS') === 0 && (html.match(/aria-label="Workspace"/g) ?? []).length === 2 && !/Sign in to (see|read|view)/i.test(html),
    `status=${res.status} lit=${lit(html, 'COMMUNITY')} markets=${lit(html, 'MARKETS')}`,
  )
  check(
    'community feed (served): the page links the room door (/g/new), carries its own title, canonical and social card, and is indexable',
    /href="\/g\/new"/.test(html) && /<title>Community: chart ideas, videos and trades with proof/.test(html) && /rel="canonical" href="[^"]*\/community"/.test(html) && /property="og:image" content="[^"]*\/community\/opengraph-image/.test(html) && !/name="robots" content="noindex/.test(html),
  )
  const home = await (await fetch(`${base}/`, { headers: INTERNAL, cache: 'no-store' })).text()
  check(
    'community feed (served): on the markets home the COMMUNITY seat is there, unlit, directly before LEADERS in both postures, and MARKETS keeps its light',
    lit(home, 'COMMUNITY') === 0 && lit(home, 'MARKETS') === 2 && (home.match(/<a [^>]*aria-label="COMMUNITY"[^>]*href="\/community"/g) ?? []).length === 2 &&
      ['aside', 'nav'].every((tag) => {
        const part = home.match(new RegExp(`<${tag} [^>]*aria-label="Workspace"[\\s\\S]*?</${tag}>`))?.[0] ?? ''
        return /aria-label="COMMUNITY"[\s\S]*aria-label="LEADERS"/.test(part) && part.indexOf('aria-label="COMMUNITY"') > part.indexOf('aria-label="CHATS"')
      }),
    `community=${lit(home, 'COMMUNITY')} markets=${lit(home, 'MARKETS')}`,
  )
  const sm = await (await fetch(`${base}/sitemap.xml`, { cache: 'no-store' })).text()
  const og = await fetch(`${base}/community/opengraph-image`, { cache: 'no-store' })
  check('community feed (served): the sitemap lists /community and the social card renders as a PNG', sm.includes('/community</loc>') && og.status === 200 && (og.headers.get('content-type') ?? '').startsWith('image/png'), `og=${og.status}`)
  const feed = await fetch(`${base}/api/feed?sort=hot&limit=5`, { cache: 'no-store' })
  const feedJson = (await feed.json().catch(() => ({}))) as { posts?: unknown[]; next?: unknown }
  check('community feed (served): GET /api/feed answers a stranger { posts, next } (the list\'s read is public)', feed.status === 200 && Array.isArray(feedJson.posts) && 'next' in feedJson, `status=${feed.status}`)


  // ── lane SHARE: the doors a stranger meets ──
  {
    const dres = await fetch(`${base}/docs/community`, { headers: INTERNAL, redirect: 'manual', cache: 'no-store' })
    const d = await dres.text()
    const at = d.indexOf('<h1 class="docs__h1">')
    const prose = at >= 0 ? d.slice(at, d.indexOf('</main>', at) > 0 ? d.indexOf('</main>', at) : undefined) : ''
    const words = prose.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').split(/\s+/).filter(Boolean).length
    check(
      'community share (served): /docs/community answers 200 in the docs layout, listed in the sidebar; it says what verified means (this wallet moved $X on a chain) and what it does not (the tag is the author\'s, no Hyperliquid proof yet); under 700 words',
      dres.status === 200 && /<h1 class="docs__h1">Community and rooms<\/h1>/.test(d) && /href="\/docs\/community"/.test(d) && /Verified on-chain: this wallet moved \$25\.00 on Base/.test(d) && /Tagged by the author/.test(d) &&
        /Hyperliquid fills cannot be posted as proof yet/.test(d) && /not set up on this deployment/.test(d) && words > 300 && words < 700,
      `status=${dres.status} words=${words}`,
    )
    const sm2 = await (await fetch(`${base}/sitemap.xml`, { cache: 'no-store' })).text()
    const cq = await fetch(`${base}/community?compose=trade`, { headers: INTERNAL, redirect: 'manual', cache: 'no-store' })
    const rooms = await fetch(`${base}${symbolRoomsHref('ETH')}`, { cache: 'no-store' })
    const rj = (await rooms.json().catch(() => ({}))) as { communities?: unknown[] }
    check(
      'community share (served): the sitemap lists /docs/community; /community?compose=trade answers a stranger 200 with no redirect (the composer opens in the browser, no wall); the symbol strip\'s read answers { communities } with at most 3 rooms',
      sm2.includes('/docs/community</loc>') && cq.status === 200 && rooms.status === 200 && Array.isArray(rj.communities) && rj.communities.length <= 3,
      `compose=${cq.status} rooms=${rooms.status}`,
    )
  }

  // ── the real thing: a room, a video, a link, a vote, the post page ──
  loadEnvLocal()
  const pk = process.env.PRIVATE_KEY
  if (!pk || !process.env.DATABASE_URL) {
    check('community feed (served): the burner PRIVATE_KEY and the TEST DATABASE_URL are in the env', false, 'not set')
    return
  }
  const { default: prisma } = await import('../lib/db')
  const A = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
  const slug = `t-feed-${Date.now().toString(36)}`
  const J = (cookie?: string | null) => ({ 'content-type': 'application/json', ...INTERNAL, ...(cookie ? { cookie } : {}) })
  const call = async (method: string, path: string, opts: { cookie?: string | null; body?: unknown } = {}) => {
    const r = await fetch(`${base}${path}`, { method, headers: J(opts.cookie), body: opts.body === undefined ? undefined : JSON.stringify(opts.body), cache: 'no-store' })
    let json: Record<string, unknown> = {}
    try {
      json = (await r.json()) as Record<string, unknown>
    } catch {
      /* not json */
    }
    return { status: r.status, json }
  }
  try {
    const sa = await signIn(base, A)
    const room = await call('POST', '/api/communities', { cookie: sa, body: { slug, name: 'Feed pin room', about: 'pins' } })
    const video = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'video', title: 'Feed pin video', mediaUrl: 'https://youtu.be/dQw4w9WgXcQ' } })
    const link = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'link', title: 'Feed pin link', linkUrl: 'https://example.com/feed-pin' } })
    const vp = video.json.post as FeedPost | undefined
    const lp = link.json.post as FeedPost | undefined
    check('community feed (served): the composer\'s payloads post — a room, then a video (the rebuilt URL) and a link inside it', room.status === 201 && video.status === 201 && link.status === 201 && vp?.video?.host === 'youtube' && lp?.kind === 'link', `${room.status}/${video.status}/${link.status}`)
    if (vp && lp) {
      const list = await call('GET', feedHref({ community: slug, sort: 'new', limit: 25 }).replace(/^/, ''), { cookie: sa })
      const rows = (list.json.posts ?? []) as FeedPost[]
      check(
        'community feed (served): the list\'s own address (feedHref) reads both posts back in the card\'s shape (kind, video, score, myVote, room)',
        list.status === 200 && rows.length === 2 && rows.every((p) => typeof p.score === 'number' && (p.myVote === 0 || p.myVote === 1 || p.myVote === -1) && p.community?.slug === slug) && rows.some((p) => p.kind === 'video' && !!p.video?.embedUrl),
        `status=${list.status} rows=${rows.length}`,
      )
      const stranger = await call('POST', `/api/posts/${vp.id}/vote`, { body: { value: 1 } })
      const up = await call('POST', `/api/posts/${vp.id}/vote`, { cookie: sa, body: { value: 1 } })
      const clear = await call('POST', `/api/posts/${vp.id}/vote`, { cookie: sa, body: { value: 0 } })
      check(
        'community feed (served): the vote door — a stranger\'s vote answers 401 { needsIdentity: true } (the card holds it and opens the door); a signed-in vote answers { score, myVote } and clears with 0',
        stranger.status === 401 && stranger.json.needsIdentity === true && up.status === 200 && up.json.score === 1 && up.json.myVote === 1 && clear.status === 200 && clear.json.score === 0 && clear.json.myVote === 0,
        `${stranger.status}/${up.status}/${clear.status}`,
      )
      const pageRes = await fetch(`${base}/c/${vp.id}`, { headers: INTERNAL, cache: 'no-store' })
      const page = await pageRes.text()
      check(
        'community feed (served): /c/<video id> is the post page for a video — 200, its card at full length, the poster and the play button, the replies under it, and NO iframe in the served HTML (the frame mounts only after a tap)',
        pageRes.status === 200 && /data-post-page="video"/.test(page) && new RegExp(`data-post="${vp.id}"`).test(page) && /class="cmy-video"/.test(page) && /i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg/.test(page) && /id="replies"/.test(page) && !/<iframe/i.test(page) && /name="robots" content="noindex/.test(page),
        `status=${pageRes.status}`,
      )
      const linkPage = await fetch(`${base}/c/${lp.id}`, { headers: INTERNAL, cache: 'no-store' })
      const linkHtml = await linkPage.text()
      check(
        'community feed (served): /c/<link id> renders the link card, out in a new tab with rel="noopener noreferrer nofollow ugc"',
        linkPage.status === 200 && /data-post-page="link"/.test(linkHtml) && /href="https:\/\/example\.com\/feed-pin" target="_blank" rel="noopener noreferrer nofollow ugc"/.test(linkHtml),
        `status=${linkPage.status}`,
      )
    }
    const missing = await fetch(`${base}/c/zzzzzzzzzz`, { headers: INTERNAL, cache: 'no-store' })
    check('community feed (served): an unknown post id is a 404', missing.status === 404, `status=${missing.status}`)

    // lane SHARE: the chart's Share dialog publishes { symbol, kind: 'idea', title, chartState } — the same call is in the feed's symbol read, newest first.
    let callId: string | null = null
    try {
      const made = await call('POST', '/api/posts', { cookie: sa, body: { symbol: 'ETH', kind: 'idea', title: 'Share pin call', body: '', chartState: { v: 1, symbol: 'ETH', tf: '1d', lines: [{ id: 'sharepin1', kind: 'h', price: 2000, label: 'pin' }] }, mint: false } })
      callId = (made.json.post as { id?: string } | undefined)?.id ?? null
      const feedNew = await call('GET', `${feedHref({ symbol: 'ETH', sort: 'new', limit: 25 })}&internal=1`, { cookie: sa })
      const all = await call('GET', `${feedHref({ sort: 'new', limit: 25 })}&internal=1`, { cookie: sa })
      const inSym = ((feedNew.json.posts as FeedPost[] | undefined) ?? []).some((p) => p.id === callId)
      const inAll = ((all.json.posts as FeedPost[] | undefined) ?? [])[0]?.id === callId
      check(
        'community share (served): a call published the way the chart\'s Share dialog publishes it is in GET /api/feed?symbol=ETH&sort=new and on TOP of the whole feed sorted new (what "See it in the community" opens)',
        made.status === 201 && !!callId && inSym && inAll,
        `post=${made.status} inSymbol=${inSym} topOfNew=${inAll}`,
      )
    } finally {
      if (callId) {
        await prisma.postVote.deleteMany({ where: { postId: callId } })
        await prisma.chartPostComment.deleteMany({ where: { postId: callId } })
        await prisma.chartPost.deleteMany({ where: { id: callId } })
      }
    }
  } catch (e) {
    check('community feed (served): ran to the end', false, e instanceof Error ? e.message : String(e))
  } finally {
    try {
      const posts = await prisma.chartPost.findMany({ where: { communitySlug: slug }, select: { id: true } })
      const ids = posts.map((p) => p.id)
      await prisma.postVote.deleteMany({ where: { postId: { in: ids } } })
      await prisma.chartPostComment.deleteMany({ where: { postId: { in: ids } } })
      await prisma.chartPost.deleteMany({ where: { id: { in: ids } } })
      await prisma.communityMember.deleteMany({ where: { communitySlug: slug } })
      await prisma.communityInvite.deleteMany({ where: { communitySlug: slug } })
      await prisma.community.deleteMany({ where: { slug } })
      const left = (await prisma.community.count({ where: { slug } })) + (await prisma.chartPost.count({ where: { communitySlug: slug } }))
      check('community feed (served): cleanup — every row this run wrote is gone', left === 0, `left=${left}`)
    } catch (e) {
      check('community feed (served): cleanup', false, e instanceof Error ? e.message : String(e))
    }
  }
}

if (process.argv[1]?.endsWith('community-feed-pins.ts')) {
  let failed = 0
  const check: Check = (name, ok, extra) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => communityFeedPins(check))
    .then(() => (served ? communityFeedPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : '\nall green')
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
