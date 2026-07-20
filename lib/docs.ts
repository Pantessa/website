// Docs registry + SEO helpers. One source of truth for the sidebar, the
// landing cards, the sitemap, and per-page breadcrumbs — add a page here and
// every surface picks it up. `ready: false` entries are hidden everywhere
// until their iteration ships them (no dead links mid-run).

export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeetful.com'

export interface DocsPage {
  slug: string // '' = the /docs landing
  title: string // sidebar + breadcrumb label
  /** ≤60 chars — the <title> (suffix added by the template). */
  seoTitle: string
  /** ≤160 chars — meta description. */
  description: string
  ready: boolean
  /** 'legal' pages render in their own sidebar group, out of the dev-doc cards. */
  group?: 'guide' | 'legal'
  /**
   * The reader this page serves — the docs are structured around three doors:
   * embed it (hosts), trust it (users), pay it (agent devs). Drives the
   * sidebar groups and the landing's door sections. Legal pages have none.
   */
  door?: 'host' | 'user' | 'agent'
}

/** Door display metadata — one place for the labels the sidebar + landing share. */
export const DOORS: Array<{ id: 'host' | 'user' | 'agent'; label: string; reader: string }> = [
  { id: 'host', label: 'Embed it', reader: 'for hosts' },
  { id: 'user', label: 'Trust it', reader: 'for users' },
  { id: 'agent', label: 'Pay it', reader: 'for agent devs' },
]

export const DOCS_PAGES: DocsPage[] = [
  {
    slug: '',
    title: 'Overview',
    seoTitle: 'Yeetful docs — the non-custodial back office for autonomous money',
    description:
      'Say what should happen, once. Yeetful compiles it into deterministic guarded transactions only your own wallet can sign — priced, capped, receipted, killable. Three doors: embed it, trust it, pay it.',
    ready: true,
  },

  // ── EMBED IT · for hosts ────────────────────────────────────────────────
  {
    slug: 'embed',
    title: 'Embed the chat',
    seoTitle: 'Embed the Yeetful chat — five lines on your own site',
    description:
      'Mount the full Yeetful chat on any site in five lines — guarded transactions, receipts, and signing with the wallet already connected to your page. Embed keys, postMessage API, telemetry.',
    ready: true,
    door: 'host',
  },

  // ── TRUST IT · for users ────────────────────────────────────────────────
  {
    slug: 'trust',
    title: 'Trust: the guardrails',
    seoTitle: 'Why you can sign what Yeetful builds',
    description:
      'What non-custodial means here: the model never writes calldata, every build is re-checked fail-closed, priced, and receipted, your wallet is the only thing that can sign, and one switch stops everything.',
    ready: true,
    door: 'user',
  },
  {
    slug: 'transactions',
    title: 'Native venues & guards',
    seoTitle: 'The transaction layer — venues, builders, and guards',
    description:
      'Every venue Yeetful builds natively — CoW, Uniswap v3/v4, NEAR Intents bridges, Aave, Hyperliquid, Snapshot — and the guard that re-derives each artifact before your wallet ever sees it.',
    ready: true,
    door: 'user',
  },
  {
    slug: 'jobs',
    title: 'Jobs: standing intents',
    seoTitle: 'Jobs API — compound intents, built and guarded step by step',
    description:
      'Say it once — "bridge, then deposit, then long, then protect it" — and the runner builds, guards, and offers each step for signature. Recurring buys included. dryRun previews everything for $0.',
    ready: true,
    door: 'user',
  },
  {
    slug: 'guardian',
    title: 'Guardian: autonomy, no custody',
    seoTitle: 'Guardian — stops and take-profits without giving up keys',
    description:
      'Arm a stop-loss or take-profit on a Hyperliquid position with one signature: a delegated agent key can ONLY reduce that position, every close re-guarded fail-closed, receipts on your dashboard.',
    ready: true,
    door: 'user',
  },
  {
    slug: 'spend-policy',
    title: 'Spend policy & caps',
    seoTitle: 'Spend policy — open by default, capped by default',
    description:
      'How your expense account protects you without walling you in: $200 caps on agent-initiated spend, an open allowlist you curate down, sales never gated, and a kill switch that outranks everything.',
    ready: true,
    door: 'user',
  },
  {
    slug: 'snapshot',
    title: 'Snapshot DAO voting',
    seoTitle: 'Snapshot voting — browse proposals and vote from chat',
    description:
      'Browse live Snapshot DAO proposals in the Yeetful chat and cast a vote your own wallet signs (EIP-712) — pay-per-call over x402 on Base, no API key.',
    ready: true,
    door: 'user',
  },
  {
    slug: 'embedded-wallet',
    title: 'Create an account (email)',
    seoTitle: 'Create an account — email wallet, no extension',
    description:
      'Sign up with just an email: Yeetful creates a Coinbase non-custodial wallet you control, no extension needed. Once connected it works exactly like MetaMask.',
    ready: true,
    door: 'user',
  },

  // ── PAY IT · for agent devs ─────────────────────────────────────────────
  {
    slug: 'paid-doors',
    title: 'Paid MCP doors (x402)',
    seoTitle: 'Paid doors — pay-per-call MCPs, no API key',
    description:
      'Every Yeetful MCP has a free door; some add a paid one. Same tools, no API key, no account: your agent pays per call in USDC on Base over x402. Try fund_and_build for $0.02.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'quickstart',
    title: 'Agent quickstart',
    seoTitle: 'Agent quickstart — pay per call with the yeetful SDK',
    description:
      'Install the yeetful SDK, define a spend grant, and make your first pay-per-call x402 request in USDC on Base — about twenty lines of TypeScript.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'expense-account',
    title: 'The expense account',
    seoTitle: 'Spend grants — allowlists, budgets, and receipts',
    description:
      'How yeetful spend grants work: host allowlists, per-call/per-day/lifetime USD caps, typed GrantError denials, and a receipt for every decision.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'agents',
    title: 'Agents & budgets',
    seoTitle: 'Agents & budgets — a daily cap for every connected app',
    description:
      'On Yeetful an agent IS an API key: give each connected app a per-day USD budget the SDK pre-flights via /api/agent/policy and enforces before paying.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'teams',
    title: 'Teams & organizations',
    seoTitle: 'Teams — a shared expense account for your whole org',
    description:
      'Yeetful organizations: invite teammates by wallet address, share agent keys, set a two-level budget (org daily cap over per-key budgets), export the report.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'api',
    title: 'Grants & policy API',
    seoTitle: 'Grants & policy API — the REST reference',
    description:
      'The REST reference: every /api/grants route (CRUD, EIP-712 signing, receipt sync), the GET /api/agent/policy pre-flight, and the receipt body fields — Bearer or session auth.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'ledger-sync',
    title: 'Dashboard ledger sync',
    seoTitle: 'Ledger sync — agent receipts on your Yeetful dashboard',
    description:
      'Mint a yf_ API key, set YEETFUL_GRANT_ID, and every settlement and denial your agent makes lands in your yeetful.com dashboard audit feed.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'x402',
    title: 'x402 v1 + v2',
    seoTitle: 'x402 protocol — what the SDK handles for you',
    description:
      'The x402 402-challenge flow, and the v1/v2 wire differences (amount fields, CAIP-2 networks, payment headers) the yeetful client absorbs automatically.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'funding',
    title: 'Funding (USDC on Base)',
    seoTitle: 'Funding — get USDC on Base for x402 calls',
    description:
      'How to fund a Yeetful account with USDC on Base: where to get it, how much to keep (EIP-3009 is gasless), mainnet vs Base Sepolia, and what happens if you run dry.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'router',
    title: 'Router: the paid catalog',
    seoTitle: 'Router — route MCP calls by plain-English ask',
    description:
      'Router is Yeetful’s MCP routing engine: ask in plain English, it weighs every route, picks the cheapest proven one under your cap, and your agent pays per call.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'claude-code',
    title: 'Add with Claude Code',
    seoTitle: 'Add Yeetful to your agent with one Claude prompt',
    description:
      'Paste one prompt into Claude Code and it wires the yeetful SDK into your agent, then walks you through minting an API key and copying your grant id.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'payer-demo',
    title: 'The payer loop (demo)',
    seoTitle: 'x402 payer demo — pay for data, leave with a guarded plan',
    description:
      'One script, the whole thesis: an external agent pays a ≤$0.05 x402 endpoint through the routing engine (receipted on-chain), then submits a compound intent as a $0 dryRun job.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'earn',
    title: 'Track MCP earnings',
    seoTitle: 'Track MCP earnings — report paid calls to your dashboard',
    description:
      'Add one async, non-blocking call to your MCP and every paid request shows up on your Yeetful dashboard: total earned, last 30 days, calls served, and paying agents.',
    ready: true,
    door: 'agent',
  },
  {
    slug: 'launchpad',
    title: 'Launchpad: claim & launch',
    seoTitle: 'Yeetful launchpad — claim your MCP and launch its token',
    description:
      'Own a piece of an MCP. Claim it by signing in with the wallet it is paid to, launch a token, and earn a share of every paid call in USDC as agents use it.',
    // Token launching shelved 2026-07-15 — UI removed everywhere, code kept
    // for a possible pivot back. The page dir is unrouted (app/docs/_launchpad)
    // and this entry hidden so no surface links to it.
    ready: false,
    door: 'agent',
  },
  {
    slug: 'terms',
    title: 'Terms of Service',
    seoTitle: 'Terms of Service — Yeetful',
    description:
      'The terms for using Yeetful: a non-custodial control plane for agent payments. Acceptable use, crypto risk, third-party services, disclaimers, and liability.',
    ready: true,
    group: 'legal',
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    seoTitle: 'Privacy Policy — Yeetful',
    description:
      'What Yeetful collects and why: wallet addresses, email/social sign-in via Coinbase CDP, usage receipts, and on-chain data. How it is used, shared, and kept.',
    ready: true,
    group: 'legal',
  },
]

export const readyPages = () => DOCS_PAGES.filter((p) => p.ready)
/** Dev/guide docs — the cards on the landing + the main sidebar list. */
export const guidePages = () => readyPages().filter((p) => (p.group ?? 'guide') === 'guide')
/** Legal pages — their own sidebar group; excluded from the dev-doc cards. */
export const legalPages = () => readyPages().filter((p) => p.group === 'legal')
/** Ready guide pages behind one door — sidebar groups + landing door sections. */
export const doorPages = (door: 'host' | 'user' | 'agent') =>
  guidePages().filter((p) => p.door === door)

export function docsUrl(slug: string): string {
  return slug ? `${SITE}/docs/${slug}` : `${SITE}/docs`
}

/** TechArticle + BreadcrumbList JSON-LD for a docs page. */
export function docsJsonLd(page: DocsPage): string {
  const url = docsUrl(page.slug)
  const crumbs = [
    { '@type': 'ListItem', position: 1, name: 'Docs', item: `${SITE}/docs` },
    ...(page.slug
      ? [{ '@type': 'ListItem', position: 2, name: page.title, item: url }]
      : []),
  ]
  return JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: page.seoTitle,
      description: page.description,
      url,
      author: { '@type': 'Organization', name: 'Yeetful', url: SITE },
      publisher: { '@type': 'Organization', name: 'Yeetful', url: SITE },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs,
    },
  ])
}
