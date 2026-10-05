// Twitter card = the same call card as og:image. Segment config must be
// declared here literally — Next refuses to read `runtime`/`dynamic`
// through a re-export.
export { default, alt, size, contentType } from './opengraph-image'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
