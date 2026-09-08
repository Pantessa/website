// Twitter card = the same links-first image as og:image. Without this file,
// clients that honor only twitter:image would miss the card (layout.tsx no
// longer pins a static /og.png).
export { default, alt, size, contentType } from './opengraph-image'
