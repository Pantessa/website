// Explicit social-card bindings for pages that set their own `openGraph` /
// `twitter` metadata. Next REPLACES the root's openGraph object with the
// page's (no deep merge), and the root's file-based opengraph-image does
// not ride into a page-level block — so a page that names its own title
// and description unfurled with NO image (/links, /links/embed, /sign,
// /inbox, /mosaic, /w — found 2026-09-08). Bind a card by path here.
//
// The bare file-based URLs resolve without Next's cache-busting query; the
// root layout's metadataBase makes them absolute.

const CARD = { width: 1200, height: 630 }

/** The site card (app/opengraph-image.tsx). */
export const SITE_CARD = [{ url: '/opengraph-image', ...CARD, alt: 'Pantessa — every dapp, one chat. Your wallet signs.' }]

/** The intent-links family card (app/links/opengraph-image.tsx). */
export const LINKS_CARD = [{ url: '/links/opengraph-image', ...CARD, alt: 'Pantessa intent links — a link that moves money.' }]
