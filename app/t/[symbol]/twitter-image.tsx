// Twitter card = the same symbol card as og:image (clients that honor only
// twitter:image would otherwise miss the chart). Segment config must be
// declared here literally — Next refuses to read `runtime`/`dynamic`
// through a re-export.
export { default, alt, size, contentType } from './opengraph-image'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
