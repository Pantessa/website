// The explainer video — ONE record shared by the landing facade
// (components/ExplainerVideo), the home page's VideoObject JSON-LD and the
// harness, so the id, title and running time can never disagree across the
// three. Everything here is the public metadata of our own YouTube upload.

export const EXPLAINER_VIDEO = {
  id: 'G8yVO_Y_E1I',
  title: 'How Pantessa’s Intent Links Work',
  /** The one-liner under the frame — what the viewer will actually see. */
  blurb: 'Overview, then a live run: “Buy $12 of AAPL on Robinhood Chain” from a plain sentence to a signed fill.',
  /** Search-facing summary for the VideoObject. */
  description:
    'Pantessa — you have an intent, we do the rest. An overview of intent links, then one run end to end: buying $12 of tokenized AAPL on Robinhood Chain from a plain sentence — the wallet scan, the cross-chain funding leg, the guarded build, the signature in the visitor’s own wallet, the receipt.',
  seconds: 407,
  uploadDate: '2026-09-03T08:33:36-07:00',
} as const

export const explainerWatchUrl = `https://www.youtube.com/watch?v=${EXPLAINER_VIDEO.id}`

/** The privacy-enhanced player: YouTube stores nothing about the visitor
 *  until they press play. */
export const explainerEmbedUrl = `https://www.youtube-nocookie.com/embed/${EXPLAINER_VIDEO.id}`

/** YouTube's own 1280×720 poster for the upload. Served through next/image,
 *  so the visitor's browser only ever talks to us — and it follows whatever
 *  thumbnail the upload wears, so a re-cut on YouTube lands here without a
 *  deploy. */
export const explainerPosterUrl = `https://i.ytimg.com/vi/${EXPLAINER_VIDEO.id}/maxresdefault.jpg`

/** 407 → "6:47" */
export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** 407 → "PT6M47S" — schema.org's ISO-8601 duration. */
export function isoDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `PT${m ? `${m}M` : ''}${s}S`
}
