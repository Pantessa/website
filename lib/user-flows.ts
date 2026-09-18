// lib/user-flows.ts — the pure half of the admin "User flows" screen.
//
// Born 2026-09-18: Twitter and LinkedIn visitors were arriving, looking and
// leaving, and nothing we stored could say where they stopped. Every table we
// had is keyed by WALLET, and the wall was in front of the wallet. The audit
// that day had to be rebuilt by hand from Vercel's request logs.
//
// Two halves feed one timeline:
//   · visitor_events — first-party, cookie-less page views, clicks, leaves,
//     errors and asks, keyed by a visitor id that rotates daily
//     (lib/visitor-id.ts).
//   · the server truth we already keep per wallet — chats, turns, ask
//     failures, link events, jobs.
// This module owns the vocabulary both halves are mapped onto, and every
// decision made over it: where a visitor came from, how far they got, and
// what stopped them. No I/O, no Prisma, safe to import from the page.

export const FLOW_WINDOWS = [1, 3, 7, 30] as const
export type FlowWindow = (typeof FLOW_WINDOWS)[number]

// ── where they came from ──────────────────────────────────────────────────

export type FlowSource = 'twitter' | 'linkedin' | 'search' | 'github' | 'desk' | 'link' | 'social' | 'direct' | 'other'

export const SOURCE_LABEL: Record<FlowSource, string> = {
  twitter: 'X / Twitter',
  linkedin: 'LinkedIn',
  search: 'Search',
  github: 'GitHub',
  desk: 'Robinhood desk',
  link: 'Shared link',
  social: 'Social',
  direct: 'Direct',
  other: 'Other site',
}

const HOST_SOURCES: [RegExp, FlowSource][] = [
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'twitter'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$|^com\.linkedin\./, 'linkedin'],
  [/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.brave\.com|yahoo\.com|ecosia\.org|kagi\.com|yandex\.[a-z.]+|baidu\.com|startpage\.com)$/, 'search'],
  [/(^|\.)github\.com$/, 'github'],
  [/^robinhood\.pantessa\.com$/, 'desk'],
  [/(^|\.)(facebook\.com|instagram\.com|reddit\.com|t\.me|telegram\.org|discord\.com|farcaster\.xyz|warpcast\.com|youtube\.com|news\.ycombinator\.com|threads\.net|bsky\.app)$/, 'social'],
]

/** Hosts that are part of a sign-in round trip, never a source. */
const PASSTHROUGH_HOST = /(^|\.)(accounts\.google\.com|pantessa\.com|yeetful\.com|crypto\.link\.com|stripe\.com|coinbase\.com)$/

/** The referrer's hostname, or '' when it is ours, a sign-in hop, or junk. */
export function externalReferrerHost(referrer: string | null | undefined): string {
  if (!referrer) return ''
  let host = ''
  try {
    host = new URL(referrer).hostname.toLowerCase()
  } catch {
    // android-app://com.linkedin.android and bare hostnames
    const m = /^(?:[a-z-]+:\/\/)?([a-z0-9.-]+)/i.exec(referrer.trim())
    host = m ? m[1].toLowerCase() : ''
  }
  host = host.replace(/^www\./, '')
  if (!host || PASSTHROUGH_HOST.test(host)) return ''
  return host.slice(0, 80)
}

/**
 * Where a visit came from. The referrer wins; a utm_source says the same
 * thing when an app stripped the referrer (LinkedIn's does); an in-app
 * browser names itself in the user agent; a landing on /i or /l with
 * nothing else is a link somebody passed along.
 */
export function sourceOf(input: { referrer?: string | null; utm?: string | null; ua?: string | null; landing?: string | null }): { source: FlowSource; label: string } {
  const host = (input.referrer ?? '').toLowerCase()
  if (host) {
    for (const [re, source] of HOST_SOURCES) if (re.test(host)) return { source, label: SOURCE_LABEL[source] }
    return { source: 'other', label: host }
  }
  const utm = (input.utm ?? '').toLowerCase()
  const utmSource = /(?:^|[&;, ])(?:utm_)?source=([a-z0-9._-]+)/.exec(utm)?.[1] ?? ''
  if (utmSource) {
    if (/^(twitter|x|t\.co)$/.test(utmSource)) return { source: 'twitter', label: SOURCE_LABEL.twitter }
    if (/linkedin|lnkd/.test(utmSource)) return { source: 'linkedin', label: SOURCE_LABEL.linkedin }
    if (/google|bing|duckduckgo/.test(utmSource)) return { source: 'search', label: SOURCE_LABEL.search }
    return { source: 'other', label: utmSource.slice(0, 40) }
  }
  // A raw user agent, or the family string deviceOf() stored from one.
  const ua = input.ua ?? ''
  if (/LinkedIn ?App/i.test(ua)) return { source: 'linkedin', label: `${SOURCE_LABEL.linkedin} app` }
  if (/\bTwitter(?:Android|for)?|\bX app\b/i.test(ua)) return { source: 'twitter', label: `${SOURCE_LABEL.twitter} app` }
  if (/\b(FBAN|FBAV|Instagram|TelegramBot|Discord)\b|\bMeta app\b/i.test(ua)) return { source: 'social', label: SOURCE_LABEL.social }
  if (/^\/(i|l|p|r|w)\//.test(input.landing ?? '')) return { source: 'link', label: SOURCE_LABEL.link }
  return { source: 'direct', label: SOURCE_LABEL.direct }
}

// ── who is on the other end ───────────────────────────────────────────────

const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|headless|phantomjs|puppeteer|playwright|lighthouse|pagespeed|preview|facebookexternalhit|embedly|python-requests|python-urllib|aiohttp|curl\/|wget|go-http-client|okhttp|axios|node-fetch|undici|java\/|libwww|scrapy|httpclient|monitor|uptime|pingdom|datadog|vercel-screenshot|google-inspectiontool|chrome-lighthouse|stripebot|yak\/|trendiction/i

/** Pure: does this user agent name an automated client? An empty one does. */
export function isBotUa(ua: string | null | undefined): boolean {
  if (!ua || ua.length < 20) return true
  return BOT_UA.test(ua)
}

/** "mobile · iOS · Safari" from a user agent. Families only: a full UA string
 *  is close to a fingerprint, and nothing here needs more than the family. */
export function deviceOf(ua: string | null | undefined): string {
  const s = ua ?? ''
  const os = /iPhone|iPod/.test(s)
    ? 'iOS'
    : /iPad/.test(s)
      ? 'iPadOS'
      : /Android/.test(s)
        ? 'Android'
        : /CrOS/.test(s)
          ? 'ChromeOS'
          : /Windows/.test(s)
            ? 'Windows'
            : /Macintosh|Mac OS X/.test(s)
              ? 'Mac'
              : /Linux|X11/.test(s)
                ? 'Linux'
                : 'Unknown'
  const browser = /LinkedInApp/i.test(s)
    ? 'LinkedIn app'
    : /\bTwitter/i.test(s)
      ? 'X app'
      : /FBAN|FBAV|Instagram/i.test(s)
        ? 'Meta app'
        : /Edg(?:e|A|iOS)?\//.test(s)
          ? 'Edge'
          : /OPR\/|Opera/.test(s)
            ? 'Opera'
            : /Firefox\/|FxiOS/.test(s)
              ? 'Firefox'
              : /Chrome\/|CriOS|Chromium/.test(s)
                ? 'Chrome'
                : /Safari\//.test(s)
                  ? 'Safari'
                  : 'Other'
  const form = /iPad|Tablet/.test(s) || (os === 'Android' && !/Mobile/.test(s)) ? 'tablet' : /Mobi|iPhone|iPod|Android/.test(s) ? 'mobile' : 'desktop'
  return `${form} · ${os} · ${browser}`
}

// ── the timeline vocabulary ───────────────────────────────────────────────

/**
 * Every row from either half lands on one of these. The fold below reads
 * nothing else, so a new data source is a new mapping, never a new rule.
 */
export type FlowKind =
  | 'view' // opened a page
  | 'leave' // left a page: time on it, how far they scrolled
  | 'click' // pressed one of our buttons or links
  | 'door' // the sign-in door opened
  | 'door-error' // the door said something went wrong
  | 'connect' // a wallet connected
  | 'signin' // SIWE session minted
  | 'account' // an email / Google account was created
  | 'ask' // sent a request
  | 'reply-answer' // got a plain answer to a question that moved no money
  | 'reply-offer' // got something to act on that is not yet signable (chips, a funding offer, a clarify)
  | 'reply-built' // got something to sign
  | 'reply-wall' // a money ask that ended with nothing to act on
  | 'built' // the sign card rendered (client beacon)
  | 'signed' // signed and counted
  | 'refused' // the wallet refused the built artifact
  | 'withheld' // we withheld a built step (dry run said it would fail)
  | 'job' // a multi-step job was compiled
  | 'job-failed'
  | 'made' // kept something: a watchlist, an alert, a link, a schedule
  | 'event' // any other product event
  | 'error' // a script error in their browser
  | 'api-error' // one of our endpoints answered 4xx/5xx to their browser

export type FlowTone = 'info' | 'act' | 'good' | 'warn' | 'bad'

export interface FlowItem {
  /** epoch ms */
  at: number
  kind: FlowKind
  title: string
  detail?: string | null
  path?: string | null
  /** visitor = their browser told us · server = our API saw it · db = a table we already kept */
  from: 'visitor' | 'server' | 'db'
  /** kind-specific numbers the fold reads: ms + scroll + input on a leave. */
  n?: { ms?: number; scroll?: number; input?: boolean; usd?: number; hadFunds?: boolean | null }
}

export const KIND_TONE: Record<FlowKind, FlowTone> = {
  view: 'info',
  leave: 'info',
  click: 'act',
  door: 'act',
  'door-error': 'bad',
  connect: 'good',
  signin: 'good',
  account: 'good',
  ask: 'act',
  'reply-answer': 'info',
  'reply-offer': 'warn',
  'reply-built': 'good',
  'reply-wall': 'bad',
  built: 'good',
  signed: 'good',
  refused: 'bad',
  withheld: 'bad',
  job: 'good',
  'job-failed': 'bad',
  made: 'good',
  event: 'info',
  error: 'bad',
  'api-error': 'bad',
}

// ── how far they got ──────────────────────────────────────────────────────

export const FLOW_STAGES = ['arrived', 'engaged', 'door', 'connected', 'asked', 'offered', 'built', 'signed'] as const
export type FlowStage = (typeof FLOW_STAGES)[number]

export const STAGE_LABEL: Record<FlowStage, string> = {
  arrived: 'Arrived',
  engaged: 'Looked around',
  door: 'Opened sign-in',
  connected: 'Connected',
  asked: 'Asked',
  offered: 'Got an offer',
  built: 'Got a transaction',
  signed: 'Signed',
}

export type FlowOutcome =
  | 'signed'
  | 'wallet-refused'
  | 'withheld'
  | 'built-unsigned'
  | 'offer-unanswered'
  | 'ask-walled'
  | 'asked-answered'
  | 'connected-idle'
  | 'door-error'
  | 'door-abandoned'
  | 'looked'
  | 'bounced'

export const OUTCOME_LABEL: Record<FlowOutcome, string> = {
  signed: 'Signed',
  'wallet-refused': 'Wallet refused the transaction',
  withheld: 'We withheld the transaction',
  'built-unsigned': 'Got a transaction, never signed',
  'offer-unanswered': 'Got an offer, never took it',
  'ask-walled': 'Asked, hit a wall',
  'asked-answered': 'Asked, got an answer, left',
  'connected-idle': 'Connected, never asked',
  'door-error': 'Sign-in failed',
  'door-abandoned': 'Opened sign-in, backed out',
  looked: 'Looked around, left',
  bounced: 'Bounced',
}

export const OUTCOME_TONE: Record<FlowOutcome, FlowTone> = {
  signed: 'good',
  'wallet-refused': 'bad',
  withheld: 'bad',
  'built-unsigned': 'warn',
  'offer-unanswered': 'warn',
  'ask-walled': 'bad',
  'asked-answered': 'info',
  'connected-idle': 'warn',
  'door-error': 'bad',
  'door-abandoned': 'warn',
  looked: 'info',
  bounced: 'info',
}

/** A visit that ends inside this many ms of its only page view is a bounce. */
export const BOUNCE_MS = 10_000
/** A gap this long starts a new visit on the same timeline. */
export const VISIT_GAP_MS = 30 * 60_000
/** Someone whose last event is this recent is still on the site. */
export const LIVE_MS = 3 * 60_000

export interface FlowFold {
  stage: FlowStage
  outcome: FlowOutcome
  /** One line saying what stopped them, in words, with the evidence in it. */
  stoppedAt: string
  /** They hit a script error or a failing endpoint somewhere along the way. */
  hadError: boolean
  /** Pointer, touch, scroll or key input was seen. False reads as a bot or an instant back-button. */
  human: boolean
  views: number
  clicks: number
  asks: number
  visits: number
  /** ms between first and last event */
  spanMs: number
  /** ms actually spent on pages, from leave events */
  activeMs: number
  pages: string[]
  landing: string | null
  exit: string | null
  usd: number
}

const has = (items: FlowItem[], ...kinds: FlowKind[]) => items.some((i) => kinds.includes(i.kind))
const last = (items: FlowItem[], ...kinds: FlowKind[]) => {
  for (let i = items.length - 1; i >= 0; i--) if (kinds.includes(items[i].kind)) return items[i]
  return null
}

function secs(ms: number): string {
  if (ms < 1000) return 'under a second'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`
  return `${(ms / 3_600_000).toFixed(1)} h`
}
export const humanMs = secs

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * The whole judgement over one person's timeline (ascending by time). The
 * stage is the furthest rung reached at any point; the outcome is what the
 * END of the timeline looks like, because a wall that was later climbed is
 * not where they stopped.
 */
export function foldFlow(itemsAsc: FlowItem[], opts?: { hasWallet?: boolean }): FlowFold {
  const items = itemsAsc
  const views = items.filter((i) => i.kind === 'view')
  const leaves = items.filter((i) => i.kind === 'leave')
  const clicks = items.filter((i) => i.kind === 'click').length
  const asks = items.filter((i) => i.kind === 'ask').length
  const pages: string[] = []
  for (const v of views) if (v.path && pages[pages.length - 1] !== v.path) pages.push(v.path)
  const maxScroll = leaves.reduce((m, l) => Math.max(m, l.n?.scroll ?? 0), 0)
  const activeMs = leaves.reduce((s, l) => s + (l.n?.ms ?? 0), 0)
  // Input is only reported by a browser. A timeline with no browser half
  // (history from before the log existed) can't be called silent.
  const browserHalf = items.some((i) => i.from === 'visitor')
  const human = !browserHalf || clicks > 0 || leaves.some((l) => l.n?.input === true) || has(items, 'ask', 'connect', 'signin', 'door')

  let visits = items.length ? 1 : 0
  for (let i = 1; i < items.length; i++) if (items[i].at - items[i - 1].at > VISIT_GAP_MS) visits++

  const stage: FlowStage = has(items, 'signed')
    ? 'signed'
    : has(items, 'reply-built', 'built', 'job', 'refused', 'withheld')
      ? 'built'
      : has(items, 'reply-offer')
        ? 'offered'
        : has(items, 'ask', 'reply-wall', 'reply-answer')
          ? 'asked'
          : opts?.hasWallet || has(items, 'connect', 'signin', 'account')
            ? 'connected'
            : has(items, 'door', 'door-error')
              ? 'door'
              : new Set(pages).size >= 2 || clicks > 0 || maxScroll >= 50
                ? 'engaged'
                : 'arrived'

  const exit = last(items, 'view', 'leave')?.path ?? null
  const spanMs = items.length ? items[items.length - 1].at - items[0].at : 0
  const usd = items.filter((i) => i.kind === 'signed').reduce((s, i) => s + (i.n?.usd ?? 0), 0)
  const hadError = has(items, 'error', 'api-error')

  let outcome: FlowOutcome
  let stoppedAt: string
  // The END of the story decides: read the last decisive item.
  const decisive = last(items, 'signed', 'refused', 'withheld', 'reply-built', 'built', 'job', 'job-failed', 'reply-offer', 'reply-wall', 'reply-answer', 'ask', 'door-error')
  const lastAsk = last(items, 'ask')
  const askWords = lastAsk ? `“${clip(lastAsk.title.replace(/^Asked:\s*/, ''), 90)}”` : 'their ask'

  if (stage === 'signed' && (!decisive || decisive.kind === 'signed' || (last(items, 'signed')?.at ?? 0) >= decisive.at - 1)) {
    outcome = 'signed'
    stoppedAt = usd > 0 ? `Signed $${usd.toFixed(2)}.` : 'Signed.'
  } else if (decisive?.kind === 'refused') {
    outcome = 'wallet-refused'
    stoppedAt = `Their wallet refused what we built for ${askWords}${decisive.detail ? `: ${clip(decisive.detail, 140)}` : '.'}`
  } else if (decisive?.kind === 'withheld') {
    outcome = 'withheld'
    stoppedAt = `We withheld a step of ${askWords}${decisive.detail ? `: ${clip(decisive.detail, 140)}` : '.'}`
  } else if (decisive?.kind === 'job-failed') {
    outcome = 'built-unsigned'
    stoppedAt = `A job failed${decisive.detail ? `: ${clip(decisive.detail, 140)}` : '.'}`
  } else if (decisive && (decisive.kind === 'reply-built' || decisive.kind === 'built' || decisive.kind === 'job')) {
    outcome = stage === 'signed' ? 'signed' : 'built-unsigned'
    stoppedAt = stage === 'signed' ? 'Signed earlier; the latest transaction is unsigned.' : `We built ${askWords} and they never signed it.`
  } else if (decisive?.kind === 'reply-offer') {
    outcome = 'offer-unanswered'
    stoppedAt = `We answered ${askWords} with ${clip(decisive.title.replace(/^Got\s*/, '').toLowerCase(), 80)} and they didn't take it.`
  } else if (decisive?.kind === 'reply-wall') {
    outcome = 'ask-walled'
    const funds = decisive.n?.hadFunds === true ? ' They had the money.' : decisive.n?.hadFunds === false ? ' Their wallet was empty.' : ''
    stoppedAt = `${askWords} ended with nothing to act on.${funds}`
  } else if (decisive?.kind === 'reply-answer' || decisive?.kind === 'ask') {
    outcome = 'asked-answered'
    stoppedAt = `Asked ${askWords}, got an answer, and left.`
  } else if (decisive?.kind === 'door-error' && stage === 'door') {
    outcome = 'door-error'
    stoppedAt = `The sign-in door failed${decisive.detail ? `: ${clip(decisive.detail, 140)}` : '.'}`
  } else if (stage === 'connected') {
    outcome = 'connected-idle'
    stoppedAt = `Connected a wallet${exit ? ` on ${exit}` : ''} and never asked for anything.`
  } else if (stage === 'door') {
    outcome = 'door-abandoned'
    stoppedAt = `Opened the sign-in door${exit ? ` on ${exit}` : ''} and backed out.`
  } else if (stage === 'engaged') {
    outcome = 'looked'
    const n = new Set(pages).size
    stoppedAt = `Looked at ${n} page${n === 1 ? '' : 's'}${activeMs ? ` for ${secs(activeMs)}` : ''}${exit ? `, left from ${exit}` : ''}. Never opened sign-in.`
  } else {
    outcome = 'bounced'
    const onPage = activeMs || spanMs
    stoppedAt = !browserHalf
      ? 'No page activity on record.'
      : !human
        ? `One page${exit ? ` (${exit})` : ''}, no scroll, tap or key. A bot or an instant back-button.`
        : onPage && onPage < BOUNCE_MS
          ? `Left ${exit ?? 'the page'} after ${secs(onPage)}.`
          : `Read ${exit ?? 'one page'}${onPage ? ` for ${secs(onPage)}` : ''}${maxScroll ? `, scrolled ${Math.round(maxScroll)}%` : ''}, clicked nothing.`
  }

  return {
    stage,
    outcome,
    stoppedAt,
    hadError,
    human,
    views: views.length,
    clicks,
    asks,
    visits,
    spanMs,
    activeMs,
    pages,
    landing: views[0]?.path ?? null,
    exit,
    usd,
  }
}

// ── one reply, read ───────────────────────────────────────────────────────

/**
 * What a finished chat turn handed the visitor, as a timeline kind plus the
 * words for it. Mirrors lib/ask-failure classifyTurn's idea of "actionable"
 * but keeps the difference between something to SIGN and something to CHOOSE,
 * because those are different walls.
 */
export function replyShape(body: Record<string, unknown> | null, moneyAsk: boolean): { kind: FlowKind; title: string } {
  if (!body) return { kind: 'reply-wall', title: 'Got an error instead of a reply' }
  const path = typeof body.buildPath === 'string' ? body.buildPath : null
  const via = path ? ` (${path})` : ''
  if (body.txRequest || body.txChain) return { kind: 'reply-built', title: `Got a transaction to sign${via}` }
  if (body.orderRequest) return { kind: 'reply-built', title: `Got an order to sign${via}` }
  if (body.voteRequest) return { kind: 'reply-built', title: `Got a vote to sign${via}` }
  if (body.jobId) return { kind: 'reply-built', title: `Got a multi-step job${via}` }
  if (body.guardianPolicyId) return { kind: 'reply-built', title: `Got a Guardian protection to arm${via}` }
  if (body.dcaScheduleId) return { kind: 'reply-built', title: `Got a recurring buy${via}` }
  if (body.connectWallet) return { kind: 'reply-offer', title: 'Got asked to connect a wallet' }
  if (body.clarify && typeof body.clarify === 'object') {
    // The card door rides as one of the chips (lib/onramp fundChipFor).
    const options = (body.clarify as { options?: unknown }).options
    const card = Array.isArray(options) && options.some((o) => !!o && typeof o === 'object' && 'fund' in (o as object))
    const funding = path === 'native-funding-offer' || /fund/i.test(path ?? '')
    return { kind: 'reply-offer', title: card ? `Got an offer to fund by card${via}` : funding ? `Got a plan to fund it from their own wallet${via}` : `Got choices to pick from${via}` }
  }
  if (body.door && typeof body.door === 'object') return { kind: 'reply-offer', title: 'Got asked to add an app first' }
  if (typeof body.awaiting === 'string' && body.awaiting) return { kind: 'reply-offer', title: 'Got a follow-up question' }
  if (body.rateGate) return { kind: 'reply-wall', title: 'Hit the unsigned-turn rate limit' }
  if (body.blocked) return { kind: 'reply-wall', title: 'Blocked by spend policy' }
  if (typeof body.error === 'string' && body.error) return { kind: 'reply-wall', title: `Got an error: ${clip(body.error, 120)}` }
  if (body.quiet === true) return { kind: 'reply-answer', title: `Told nothing needs doing${via}` }
  if (body.nfts || body.nftMarket || body.portfolio || body.chart) return { kind: 'reply-answer', title: `Got a read of their wallet or the market${via}` }
  if (typeof body.reply !== 'string' || !body.reply) return { kind: 'reply-wall', title: 'Got an empty reply' }
  if (!moneyAsk) return { kind: 'reply-answer', title: `Got an answer${via}` }
  return { kind: 'reply-wall', title: path?.startsWith('native') ? `Refused by ${path}` : 'Got prose where a transaction was wanted' }
}

// ── merging the two halves ────────────────────────────────────────────────

/** The same moment told twice (our API saw the reply AND a table kept it):
 *  keep the richer telling. Walls keep the table row (it carries the funds
 *  snapshot); builds keep the API's (it names what was built). */
const TWICE_MS = 120_000
export function mergeItems(items: FlowItem[]): FlowItem[] {
  const asc = [...items].sort((a, b) => a.at - b.at)
  const drop = new Set<number>()
  for (let i = 0; i < asc.length; i++) {
    const a = asc[i]
    if (drop.has(i)) continue
    for (let j = i + 1; j < asc.length && asc[j].at - a.at <= TWICE_MS; j++) {
      const b = asc[j]
      if (drop.has(j) || a.from === b.from) continue
      const wall = a.kind === 'reply-wall' && b.kind === 'reply-wall'
      const built = (a.kind === 'reply-built' && b.kind === 'built') || (a.kind === 'built' && b.kind === 'reply-built')
      const ask = a.kind === 'ask' && b.kind === 'ask' && a.title.slice(0, 60) === b.title.slice(0, 60)
      if (wall) drop.add(a.from === 'db' ? j : i)
      else if (built) drop.add(a.kind === 'built' ? i : j)
      else if (ask) drop.add(a.from === 'db' ? i : j)
      if (drop.has(i)) break
    }
  }
  return asc.filter((_, i) => !drop.has(i))
}

// ── the top of the page ───────────────────────────────────────────────────

export interface FlowSummaryInput {
  stage: FlowStage
  outcome: FlowOutcome
  source: FlowSource
  hadError: boolean
  human: boolean
  exit: string | null
}

export interface FlowSummary {
  people: number
  /** cumulative: everyone who reached AT LEAST this rung */
  funnel: { stage: FlowStage; n: number }[]
  outcomes: { outcome: FlowOutcome; n: number }[]
  sources: { source: FlowSource; n: number; engaged: number; asked: number; signed: number }[]
  exits: { path: string; n: number }[]
  withErrors: number
  silent: number
}

export function summarize(flows: FlowSummaryInput[]): FlowSummary {
  const rung = (s: FlowStage) => FLOW_STAGES.indexOf(s)
  const funnel = FLOW_STAGES.map((stage) => ({ stage, n: flows.filter((f) => rung(f.stage) >= rung(stage)).length }))
  const oc = new Map<FlowOutcome, number>()
  const sc = new Map<FlowSource, { n: number; engaged: number; asked: number; signed: number }>()
  const ex = new Map<string, number>()
  for (const f of flows) {
    oc.set(f.outcome, (oc.get(f.outcome) ?? 0) + 1)
    const s = sc.get(f.source) ?? { n: 0, engaged: 0, asked: 0, signed: 0 }
    s.n++
    if (rung(f.stage) >= rung('engaged')) s.engaged++
    if (rung(f.stage) >= rung('asked')) s.asked++
    if (f.stage === 'signed') s.signed++
    sc.set(f.source, s)
    // An exit page only means something for people who left without acting.
    if (f.exit && rung(f.stage) < rung('asked')) ex.set(f.exit, (ex.get(f.exit) ?? 0) + 1)
  }
  return {
    people: flows.length,
    funnel,
    outcomes: [...oc.entries()].map(([outcome, n]) => ({ outcome, n })).sort((a, b) => b.n - a.n),
    sources: [...sc.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.n - a.n),
    exits: [...ex.entries()].map(([path, n]) => ({ path, n })).sort((a, b) => b.n - a.n).slice(0, 8),
    withErrors: flows.filter((f) => f.hadError).length,
    silent: flows.filter((f) => !f.human).length,
  }
}

// ── a stored row → a line on the timeline ─────────────────────────────────

export interface VisitorEventRow {
  at: number
  kind: string
  path: string
  label: string | null
  detail: Record<string, unknown> | null
  referrer: string | null
}

const FLOW_KINDS = new Set<string>(Object.keys(KIND_TONE))
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const EVENT_WORDS: Record<string, string> = {
  example_chip: 'Tapped an example',
  ask_door: 'Used the ⌘K ask door',
  voice_ask: 'Spoke an ask',
  agent_added: 'Turned an app on',
  agent_removed: 'Turned an app off',
  wallet_flag_action: 'Acted on a wallet flag',
  wallet_rebalance: 'Sent a rebalance from the wallet page',
  chat_paid: 'A paid turn settled',
  api_key_minted: 'Minted an API key',
  grant_signed: 'Signed a spend grant',
  agent_approval_toggled: 'Changed an agent approval',
  docs_prompt_copied: 'Copied a docs prompt',
}

/**
 * One visitor_events row as a timeline item, or null for a row the timeline
 * is better without. Product events (the analytics chokepoint tees into the
 * log) are promoted to the kinds the fold understands: the sign-in door, a
 * connect, a sign-in.
 */
export function itemFromRow(r: VisitorEventRow): FlowItem | null {
  const d = r.detail ?? {}
  const from = r.kind === 'ask' || r.kind === 'reply' ? 'server' : 'visitor'
  const base = { at: r.at, path: r.path || null, from } as const
  switch (r.kind) {
    case 'view':
      return { ...base, kind: 'view', title: `Opened ${r.path}`, detail: r.referrer ? `came from ${r.referrer}` : null }
    case 'leave': {
      const ms = num(d.ms)
      const scroll = num(d.scroll)
      return {
        ...base,
        kind: 'leave',
        title: `Left ${r.path} after ${humanMs(ms)}`,
        detail: `${scroll >= 1 ? `scrolled ${Math.round(scroll)}%` : 'no scroll'}${d.input === false ? ' · no pointer, touch or key' : ''}`,
        n: { ms, scroll, input: d.input !== false },
      }
    }
    case 'click': {
      const to = str(d.to)
      return { ...base, kind: 'click', title: `Clicked “${r.label ?? '?'}”`, detail: to ? `→ ${to}` : null }
    }
    case 'error':
      return { ...base, kind: 'error', title: `Script error: ${r.label ?? 'unknown'}`, detail: [str(d.src), d.line ? `line ${num(d.line)}` : ''].filter(Boolean).join(' · ') || null }
    case 'api-error': {
      const status = num(d.status)
      return { ...base, kind: 'api-error', title: status ? `${r.label ?? 'An endpoint'} answered ${status}` : `${r.label ?? 'An endpoint'} could not be reached`, detail: null }
    }
    case 'ask':
      return { ...base, kind: 'ask', title: `Asked: ${r.label ?? ''}`, detail: d.money === true ? 'a money ask' : null }
    case 'reply': {
      const shape = str(d.shape)
      const kind = (FLOW_KINDS.has(shape) ? shape : 'reply-answer') as FlowKind
      return { ...base, kind, title: r.label ?? 'Got a reply', detail: str(d.said) || null }
    }
    case 'event': {
      const name = r.label ?? ''
      if (name === 'signin_door_open') return { ...base, kind: 'door', title: d.connectOnly === true ? 'Opened the connect-a-wallet door' : 'Opened the sign-in door' }
      if (name === 'signin_door_lane') return { ...base, kind: 'door', title: `Chose the ${str(d.lane) || '?'} lane` }
      if (name === 'signin_door_code_sent') return { ...base, kind: 'door', title: 'Was emailed a sign-in code' }
      if (name === 'signin_door_error') return { ...base, kind: 'door-error', title: 'The sign-in door showed an error', detail: str(d.message) || null }
      if (name === 'signin_door_cdp_timeout') return { ...base, kind: 'door-error', title: 'Email + Google sign-in never loaded', detail: 'The Coinbase SDK did not initialize (a blocker, usually). Only the wallet lane worked.' }
      if (name === 'siwe_failed') return { ...base, kind: 'door-error', title: 'The sign-in signature did not complete', detail: str(d.reason) || null }
      if (name === 'wallet_connected') return { ...base, kind: 'connect', title: `Connected a wallet${str(d.connector) ? ` (${str(d.connector)})` : ''}` }
      if (name === 'siwe_signed_in') return { ...base, kind: 'signin', title: 'Signed in' }
      // The server's own `ask` row is the record of a sent message. This one
      // only matters when that row is missing (see dropEchoedSends).
      if (name === 'chat_message_sent') return { ...base, kind: 'event', title: 'Sent a message', detail: 'chat_message_sent' }
      const words = EVENT_WORDS[name] ?? name.replace(/_/g, ' ')
      const extra = str(d.prompt) || str(d.slug) || str(d.action) || str(d.label)
      return { ...base, kind: 'event', title: extra ? `${words}: “${extra}”` : words }
    }
    default:
      return null
  }
}

/** A sent message the server also recorded is one fact, not two. One the
 *  server has NO record of is a finding: the request never arrived. */
export function dropEchoedSends(itemsAsc: FlowItem[]): FlowItem[] {
  const asks = itemsAsc.filter((i) => i.kind === 'ask').map((i) => i.at)
  return itemsAsc.flatMap((i) => {
    if (!(i.kind === 'event' && i.detail === 'chat_message_sent')) return [i]
    if (asks.some((t) => Math.abs(t - i.at) <= 20_000)) return []
    return [{ ...i, kind: 'api-error' as const, title: 'Sent a message the server never recorded', detail: 'The chat request did not reach /api/chat, or it failed before the turn ran.' }]
  })
}

/** The same control pressed again and again inside a few seconds is one
 *  line, and three or more is a wall worth reading: nothing happened. */
export const RAGE_CLICKS = 3
export function collapseClicks(itemsAsc: FlowItem[]): FlowItem[] {
  const out: FlowItem[] = []
  let run = 0
  for (const i of itemsAsc) {
    const prev = out[out.length - 1]
    if (i.kind === 'click' && prev?.kind === 'click' && prev.title.replace(/ ×\d+$/, '') === i.title && i.at - prev.at <= 4_000) {
      run++
      out[out.length - 1] = { ...prev, at: prev.at, title: `${i.title} ×${run + 1}`, detail: run + 1 >= RAGE_CLICKS ? `pressed ${run + 1} times in a row. Did nothing happen?` : prev.detail }
      continue
    }
    run = 0
    out.push(i)
  }
  return out
}

/** How many runs of repeated presses a timeline holds. */
export function rageRuns(items: FlowItem[]): number {
  return items.filter((i) => i.kind === 'click' && / ×(\d+)$/.test(i.title) && Number(/ ×(\d+)$/.exec(i.title)?.[1]) >= RAGE_CLICKS).length
}
