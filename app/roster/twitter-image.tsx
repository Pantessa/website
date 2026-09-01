// Twitter card = the same roster image as og:image. Without this file,
// clients that honor only twitter:image would miss the card.
export { default, alt, size, contentType } from './opengraph-image'

// Route-segment config can't be re-exported — declare it directly.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
