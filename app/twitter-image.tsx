// Twitter card = the same board card as og:image. Without this file, clients
// that honor only twitter:image would miss the card (layout.tsx no longer
// pins a static /og.png).
export { default, alt, size, contentType } from './opengraph-image'

// Route-segment config can't be re-exported — declare it directly.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
