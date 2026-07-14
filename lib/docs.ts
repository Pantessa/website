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
}

export const DOCS_PAGES: DocsPage[] = [
  {
    slug: '',
    title: 'Overview',
    seoTitle: 'Yeetful docs — the guarded transaction layer for agents',
    description:
      'One intent in, a guarded transaction out: Yeetful compiles plain-English asks into deterministic, guard-checked artifacts your users sign with their own wallet — from the API, the chat, or an embed on your site.',
    ready: true,
  },
  {
    slug: 'jobs',
    title: 'Jobs: compound intents',
    seoTitle: 'Jobs API — compound intents, built and guarded step by step',
    description:
      'POST one compound intent — "bridge, then deposit, then long, then protect it" — and the runner builds, guards, and offers each step for signature. dryRun previews the whole plan for $0.',
    ready: true,
  },
  {
    slug: 'guardian',
    title: 'Guardian: autonomy, no custody',
    seoTitle: 'Guardian — stops and take-profits without giving up keys',
    description:
      'Arm a stop-loss or take-profit on a Hyperliquid position with one signature: a delegated agent key can ONLY reduce that position, every close re-guarded fail-closed, receipts on your dashboard.',
    ready: true,
  },
  {
    slug: 'transactions',
    title: 'Native venues & guards',
    seoTitle: 'The transaction layer — venues, builders, and guards',
    description:
      'Every venue Yeetful builds natively — CoW, Uniswap v3/v4, NEAR Intents bridges, Aave, Hyperliquid, Snapshot — and the guard that re-derives each artifact before your wallet ever sees it.',
    ready: true,
  },
  {
    slug: 'embed',
    title: 'Embed the chat',
    seoTitle: 'Embed the Yeetful chat — an iframe on your own site',
    description:
      'Drop the Yeetful chat into any site as an iframe, scoped to the MCPs you pick — swaps, receipts, and signing included. URL params, postMessage API, SDK snippet.',
    ready: true,
  },
  {
    slug: 'router',
    title: 'Router: the routing engine',
    seoTitle: 'Router — route MCP calls by plain-English ask',
    description:
      'Router is Yeetful’s MCP routing engine: ask in plain English, it weighs every route, picks the cheapest proven one under your cap, and your agent pays per call.',
    ready: true,
  },
  {
    slug: 'quickstart',
    title: 'Quickstart',
    seoTitle: 'Quickstart — first paid x402 call with the yeetful SDK',
    description:
      'Install the yeetful SDK, define a spend grant, and make your first pay-per-call x402 request in USDC on Base — about twenty lines of TypeScript.',
    ready: true,
  },
  {
    slug: 'funding',
    title: 'Funding (USDC on Base)',
    seoTitle: 'Funding — get USDC on Base for x402 calls',
    description:
      'How to fund a Yeetful account with USDC on Base: where to get it, how much to keep (EIP-3009 is gasless), mainnet vs Base Sepolia, and what happens if you run dry.',
    ready: true,
  },
  {
    slug: 'claude-code',
    title: 'Add with Claude Code',
    seoTitle: 'Add Yeetful to your agent with one Claude prompt',
    description:
      'Paste one prompt into Claude Code and it wires the yeetful SDK into your agent, then walks you through minting an API key and copying your grant id.',
    ready: true,
  },
  {
    slug: 'embedded-wallet',
    title: 'Create an account (email)',
    seoTitle: 'Create an account — email wallet, no extension',
    description:
      'Sign up with just an email: Yeetful creates a Coinbase non-custodial wallet you control, no extension needed. Once connected it works exactly like MetaMask.',
    ready: true,
  },
  {
    slug: 'expense-account',
    title: 'The expense account',
    seoTitle: 'Spend grants — allowlists, budgets, and receipts',
    description:
      'How yeetful spend grants work: host allowlists, per-call/per-day/lifetime USD caps, typed GrantError denials, and a receipt for every decision.',
    ready: true,
  },
  {
    slug: 'spend-policy',
    title: 'The spend-policy switch',
    seoTitle: 'Spend policy — the on/off master switch for caps',
    description:
      'The master switch on your Yeetful account: off means unrestricted (trial mode), on enforces your allowlist and budgets. Toggling it preserves per-agent approvals.',
    ready: true,
  },
  {
    slug: 'ledger-sync',
    title: 'Dashboard ledger sync',
    seoTitle: 'Ledger sync — agent receipts on your Yeetful dashboard',
    description:
      'Mint a yf_ API key, set YEETFUL_GRANT_ID, and every settlement and denial your agent makes lands in your yeetful.com dashboard audit feed.',
    ready: true,
  },
  {
    slug: 'api',
    title: 'Grants & policy API',
    seoTitle: 'Grants & policy API — the REST reference',
    description:
      'The REST reference: every /api/grants route (CRUD, EIP-712 signing, receipt sync), the GET /api/agent/policy pre-flight, and the receipt body fields — Bearer or session auth.',
    ready: true,
  },
  {
    slug: 'agents',
    title: 'Agents & budgets',
    seoTitle: 'Agents & budgets — a daily cap for every connected app',
    description:
      'On Yeetful an agent IS an API key: give each connected app a per-day USD budget the SDK pre-flights via /api/agent/policy and enforces before paying.',
    ready: true,
  },
  {
    slug: 'teams',
    title: 'Teams & organizations',
    seoTitle: 'Teams — a shared expense account for your whole org',
    description:
      'Yeetful organizations: invite teammates by wallet address, share agent keys, set a two-level budget (org daily cap over per-key budgets), export the report.',
    ready: true,
  },
  {
    slug: 'x402',
    title: 'x402 v1 + v2',
    seoTitle: 'x402 protocol — what the SDK handles for you',
    description:
      'The x402 402-challenge flow, and the v1/v2 wire differences (amount fields, CAIP-2 networks, payment headers) the yeetful client absorbs automatically.',
    ready: true,
  },
  {
    slug: 'snapshot',
    title: 'Snapshot DAO voting',
    seoTitle: 'Snapshot voting — browse proposals and vote from chat',
    description:
      'Browse live Snapshot DAO proposals in the Yeetful chat and cast a vote your own wallet signs (EIP-712) — pay-per-call over x402 on Base, no API key.',
    ready: true,
  },
  {
    slug: 'launchpad',
    title: 'Launchpad: claim & launch',
    seoTitle: 'Yeetful launchpad — claim your MCP and launch its token',
    description:
      'Own a piece of an MCP. Claim it by signing in with the wallet it is paid to, launch a token, and earn a share of every paid call in USDC as agents use it.',
    // Testnet, but listed in the nav so operators can find the claim/launch
    // walk-through. (The page itself states the testnet/mainnet status.)
    ready: true,
  },
  {
    slug: 'earn',
    title: 'Track MCP earnings',
    seoTitle: 'Track MCP earnings — report paid calls to your dashboard',
    description:
      'Add one async, non-blocking call to your MCP and every paid request shows up on your Yeetful dashboard: total earned, last 30 days, calls served, and paying agents.',
    ready: true,
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
