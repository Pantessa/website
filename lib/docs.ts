// Docs registry + SEO helpers. One source of truth for the sidebar, the
// landing cards, the sitemap, and per-page breadcrumbs: add a page here and
// every surface picks it up. `ready: false` entries are hidden everywhere
// until their iteration ships them (no dead links mid-run).
//
// ORDER IS THE READING ORDER (squad docs-clean, 2026-11-24). The four
// "doors" (creators, hosts, users, agent devs) became five groups, led by
// the trader: START HERE, EARN, SAFETY, BUILD, LEGAL. Within a group the
// array order is the sidebar order and the landing's card order. Retired
// pages (dca, spend-policy, transactions) and the 14 unrouted `_` pages left
// the registry; next.config redirects the three retired addresses.

import { SITE_URL } from './site-url'

/** Re-exported: docs pages have imported `SITE` from here since before
 *  lib/site-url existed. */
export const SITE = SITE_URL

export type DocsGroupId = 'start' | 'earn' | 'safety' | 'build' | 'legal'

export interface DocsPage {
  slug: string // '' = the /docs landing
  title: string // sidebar + breadcrumb label
  /** ≤60 chars: the <title>. */
  seoTitle: string
  /** ≤160 chars: meta description, and the card text on the landing. */
  description: string
  ready: boolean
  /** The group the page sits in (sidebar label, landing section). The
   *  landing itself has none. */
  group?: DocsGroupId
  /** @deprecated The four doors are gone (2026-11-24); no entry sets this.
   *  Kept on the type only so an old pin that reads it still compiles until
   *  lane qa re-pins it to `group`. */
  door?: string
}

/** Group display metadata: the sidebar labels and the landing's sections,
 *  in reading order. `label` is the short sidebar marker; `title` and
 *  `reader` head the landing section. */
export const DOCS_GROUPS: Array<{ id: DocsGroupId; label: string; title: string; reader: string }> = [
  { id: 'start', label: 'START HERE', title: 'Start here', reader: 'Look at a market, connect a wallet, press and sign.' },
  { id: 'earn', label: 'EARN', title: 'Earn', reader: 'For creators: share a trade and earn on the swaps it brings.' },
  { id: 'safety', label: 'SAFETY', title: 'Safety', reader: 'Why you can sign what Pantessa builds.' },
  { id: 'build', label: 'BUILD', title: 'Build', reader: 'For developers: buttons, the embed, the APIs.' },
  { id: 'legal', label: 'LEGAL', title: 'Legal', reader: 'The terms and the privacy policy.' },
]

export const DOCS_PAGES: DocsPage[] = [
  {
    slug: '',
    title: 'Overview',
    seoTitle: 'Pantessa docs: the live market you can act on',
    description:
      'Look at live charts for free. Press a price and Pantessa builds the trade, checks it, and hands it to your own wallet to sign. Pantessa never holds your money.',
    ready: true,
  },

  // ── START HERE ──────────────────────────────────────────────────────────
  {
    slug: 'first-five-minutes',
    title: 'Your first five minutes',
    seoTitle: 'Your first five minutes with Pantessa',
    description:
      'Look at any market for free, no account needed. When you want to act, press a price or a chip, connect a wallet and sign.',
    ready: true,
    group: 'start',
  },
  {
    slug: 'markets',
    title: 'Markets',
    seoTitle: 'Markets: every chart is a trade',
    description:
      'Live charts for tokenized stocks (24/7 on Robinhood Chain), crypto spot and Hyperliquid perps. Press a chip and your wallet signs. Free watchlists and alerts.',
    ready: true,
    group: 'start',
  },
  {
    slug: 'called-it',
    title: 'Called it',
    seoTitle: 'Called it: an X account’s calls, judged by the chart',
    description:
      'Type an X handle and see every call it made on a market, pinned to the chart and judged by what the price did next. Hits and misses both count.',
    ready: true,
    group: 'start',
  },
  {
    slug: 'embedded-wallet',
    title: 'Sign in',
    seoTitle: 'Sign in to Pantessa: a wallet, Google or email',
    description:
      'You need a wallet to sign, not to look. Bring your own, or continue with Google or email and get a wallet only you control.',
    ready: true,
    group: 'start',
  },

  // ── EARN ────────────────────────────────────────────────────────────────
  {
    slug: 'links',
    title: 'Links that carry a trade',
    seoTitle: 'Links that carry a trade: share it, earn on the swap',
    description: 'Make a link that carries a trade as a sentence. The visitor connects their own wallet and signs, and you get half of Pantessa’s fee on swaps.',
    ready: true,
    group: 'earn',
  },
  {
    slug: 'creator-earnings',
    title: 'Creator earnings',
    seoTitle: 'Creator earnings: half the fee on link swaps',
    description: 'How creators are paid: half of Pantessa’s fee on swaps through their links, paid in the swap or claimed as USDC on Base. Perp trades do not pay yet.',
    ready: true,
    group: 'earn',
  },
  {
    slug: 'community',
    title: 'Community and rooms',
    seoTitle: 'Community: rooms, posts and trades with proof',
    description:
      'Start a room, join with Telegram or a sign-in, post an idea, a link, a video or a trade. What “verified on-chain” means on a trade post, and what it does not.',
    ready: true,
    group: 'earn',
  },

  // ── SAFETY ──────────────────────────────────────────────────────────────
  {
    slug: 'trust',
    title: 'Why you can sign it',
    seoTitle: 'Why you can sign what Pantessa builds',
    description: 'Pantessa never holds your money. Code builds each trade from live venue data, a second check runs, the fee is shown, and you sign.',
    ready: true,
    group: 'safety',
  },
  {
    slug: 'guardian',
    title: 'Guardian stops',
    seoTitle: 'Guardian: stops on Hyperliquid positions',
    description: 'A stop-loss or take-profit on a Hyperliquid position, checked every minute. It runs on an agent key you approve once, which cannot withdraw.',
    ready: true,
    group: 'safety',
  },
  // Field order inside this entry is read by scripts/venue-manifest-pins.ts
  // (slug, title, seoTitle, single-quoted description, ready, group): keep it.
  {
    slug: 'venues',
    title: 'Venues and checks',
    seoTitle: 'Venues: what Pantessa can ask you to sign',
    description: 'Every venue, chain and contract a Pantessa build can use, with the check in front of each signature. Read from the code, served as JSON.',
    ready: true,
    group: 'safety',
  },

  // ── BUILD ───────────────────────────────────────────────────────────────
  {
    slug: 'host-buttons',
    title: 'Site buttons',
    seoTitle: 'Site buttons: a trade button for your website',
    description: 'Put a plain HTML button on your site that opens a trade on Pantessa. Visitors sign with their own wallet and come back to your return URL.',
    ready: true,
    group: 'build',
  },
  {
    slug: 'embed',
    title: 'Embed the chat',
    seoTitle: 'Embed the Pantessa chat on your own site',
    description:
      'Put the Pantessa chat on your site with one package. Visitors ask in plain words and their own wallet signs on your page.',
    ready: true,
    group: 'build',
  },
  {
    slug: 'jobs',
    title: 'Jobs API',
    seoTitle: 'Jobs API: compound asks, built and guarded step by step',
    description:
      'Send one compound ask to POST /api/jobs and get a guarded step plan. A dry run builds step 1 live and creates nothing.',
    ready: true,
    group: 'build',
  },
  {
    slug: 'desk',
    title: 'Agent desk (MCP)',
    seoTitle: 'Agent desk: connect your agent to Pantessa over MCP',
    description:
      'Connect an agent over MCP. It asks in plain sentences, guarded builders write every transaction, and a person or the agent’s own key signs.',
    ready: true,
    group: 'build',
  },
  {
    slug: 'snapshot',
    title: 'Snapshot voting',
    seoTitle: 'Snapshot voting: browse proposals and vote from the chat',
    description:
      'Browse live Snapshot proposals and vote from the chat. Your wallet signs a gasless vote, and voting in the chat is free.',
    ready: true,
    group: 'build',
  },

  // ── LEGAL (page text is not the docs squad's; titles only) ──────────────
  {
    slug: 'terms',
    title: 'Terms of Service',
    seoTitle: 'Pantessa Terms of Service',
    description:
      'The terms for using Pantessa: acceptable use, crypto risk, third-party services, disclaimers, and liability.',
    ready: true,
    group: 'legal',
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    seoTitle: 'Pantessa Privacy Policy',
    description:
      'What Pantessa collects and why: wallet addresses, email/social sign-in via Coinbase CDP, usage receipts, and on-chain data. How it is used, shared, and kept.',
    ready: true,
    group: 'legal',
  },
]

export const readyPages = () => DOCS_PAGES.filter((p) => p.ready)
/** Guide docs: every ready page outside LEGAL (the landing included). */
export const guidePages = () => readyPages().filter((p) => p.group !== 'legal')
/** Legal pages: their own sidebar group, last. */
export const legalPages = () => readyPages().filter((p) => p.group === 'legal')
/** Ready pages in one group, in reading order: sidebar groups + landing sections. */
export const groupPages = (group: DocsGroupId) => readyPages().filter((p) => p.group === group)

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
      author: { '@type': 'Organization', name: 'Pantessa', url: SITE },
      publisher: { '@type': 'Organization', name: 'Pantessa', url: SITE },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs,
    },
  ])
}
