import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// THE FACES OF A BRAND CARD (squad mobile-sleek, 2026-11-24; brand guidelines
// section 4): Geist is the text; the one display line is Fraunces 600,
// upright; labels and numbers are Geist Mono. The cards ask for them by ROLE
// (`Display`, `Mono`), so a card never names a file.
//
// Fraunces 600 and Geist Mono are read from assets/og-fonts when their files
// are there (`fraunces-600.ttf`, `geist-mono-500.ttf`: static TrueType, the
// renderer reads neither woff2 nor a variable font). Until they are, the
// display line is Newsreader upright (the site's own fallback for the display
// face) and the labels are Geist, spaced: the look holds, the faces are one
// step off. Adding the two files switches every card, with no change in code.

export const OG_DISPLAY = 'Display'
export const OG_MONO = 'Mono'

export interface OgFont {
  name: string
  data: Buffer
  weight: 500 | 600
  style: 'normal'
}

let fontsP: Promise<OgFont[]> | null = null

/** The faces, read once per process. A failed read is retried on the next card. */
export function brandOgFonts(): Promise<OgFont[]> {
  if (!fontsP) {
    const dir = join(process.cwd(), 'assets', 'og-fonts')
    const opt = (f: string) => readFile(join(dir, f)).catch(() => null)
    fontsP = Promise.all([readFile(join(dir, 'geist-500.ttf')), readFile(join(dir, 'geist-600.ttf')), opt('fraunces-600.ttf'), opt('geist-mono-500.ttf'), readFile(join(dir, 'newsreader-500.ttf'))]).then(([sans, sansSemi, fraunces, mono, newsreader]): OgFont[] => [
      { name: 'Geist', data: sans, weight: 500, style: 'normal' },
      { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
      { name: OG_DISPLAY, data: fraunces ?? newsreader, weight: 600, style: 'normal' },
      { name: OG_MONO, data: mono ?? sans, weight: 500, style: 'normal' },
      { name: OG_MONO, data: mono ?? sansSemi, weight: 600, style: 'normal' },
    ])
    fontsP.catch(() => {
      fontsP = null
    })
  }
  return fontsP
}

/** Spaced capitals: 0.12em at this size. */
export const ogTrack = (size: number): number => Math.round(size * 0.12 * 10) / 10
