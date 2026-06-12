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
}

export const DOCS_PAGES: DocsPage[] = [
  {
    slug: '',
    title: 'Overview',
    seoTitle: 'Yeetful docs — spend-controlled x402 payments for agents',
    description:
      'Give your AI agent an expense account: an allowlist plus per-call and per-day USDC budgets, enforced before any x402 payment is signed. Integration docs.',
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
    slug: 'expense-account',
    title: 'The expense account',
    seoTitle: 'Spend grants — allowlists, budgets, and receipts',
    description:
      'How yeetful spend grants work: host allowlists, per-call/per-day/lifetime USD caps, typed GrantError denials, and a receipt for every decision.',
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
    slug: 'x402',
    title: 'x402 v1 + v2',
    seoTitle: 'x402 protocol — what the SDK handles for you',
    description:
      'The x402 402-challenge flow, and the v1/v2 wire differences (amount fields, CAIP-2 networks, payment headers) the yeetful client absorbs automatically.',
    ready: true,
  },
  {
    slug: 'claude-code',
    title: 'Add with Claude Code',
    seoTitle: 'Add Yeetful to your Coinbase agent with one Claude prompt',
    description:
      'Paste one prompt into Claude Code and it wires the yeetful SDK into your Coinbase Developer Platform agent, then walks you through keys and grant setup.',
    ready: false,
  },
]

export const readyPages = () => DOCS_PAGES.filter((p) => p.ready)

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
