# Pantessa — the Cut P

Picked 2026-11-18, replacing the Emerald Cut (2026-09-01,
`public/brand/emerald/`, kept as the archive). The Emerald Cut was nested
octagons: pretty, but with no outline of its own at avatar size. The Cut P
keeps the stone, the emerald and the open table, and gives them a letter.

## Construction

On a 128 grid. A **square** stone (72 × 72) is the bowl of a P and its open
table is the counter; the stem is 22 wide and runs down from the left side.

- Because the stone is square, its top-right and lower-left miters lie on one
  line. That line is **the cut**: it runs from the top-right corner, through
  the table, to the left edge of the stem. Two pieces, two tones.
- **Every diagonal is parallel to the cut**: the top-left and lower-right
  chamfers, the table's two sharp corners, and the foot of the stem. The
  top-right corner stays sharp, where the cut enters.
- The cut is a **gap** between two polygons, never a painted line, so the mark
  sits on any ground. The table stays open.

`generate.js` here is the kit's source; **`lib/gem-geometry.ts` is the app's**.
The numbers mirror each other, so change both or neither, then re-run
`node generate.js --install` and re-rasterize (below).

## The weight ladder

The letter never changes. Only the width of the cut does, because a thin cut
closes up in a small box.

| cut    | width | floor   | use                         |
| ------ | ----- | ------- | --------------------------- |
| `fine` | 2.6   | ≥ 96px  | hero, print, banners        |
| `mark` | 3.2   | 32–95px | pages, cards, app icons     |
| `icon` | 6.5   | < 32px  | nav, tab bars, favicons     |

`gemWeightFor(px)` in `lib/gem-geometry.ts` walks this; the React component
picks by rendered size.

## Palette

Two tones, lit and shade. Dark grounds: `#3ECF8E` over `#159B68`. Paper
grounds: `#0e8f62` over `#0C7A52`. In the app these are the `--gem-5` and
`--gem-3` tokens in `app/x402-design.css`, which flip with the theme.
White-label surfaces re-ink both pieces in one accent (shade at 72%).

Single-ink marks fill both pieces with one color: white, black, ink
(`#101512`) or emerald. The cut carries the read. Icon ground: `#06110B`.

Wordmark: "pantessa", Fraunces 600, −0.015em, outlined to vectors in
`wordmark.json`, so no delivered file depends on a font.

## Files

- `pantessa-mark[-fine|-mark|-icon][-paper].svg` — the mark alone, every cut,
  dark and paper tones
- `pantessa-mark-mono-{white,black,ink,emerald}.svg` — single-ink marks
- `pantessa-app-icon.svg`, `pantessa-app-icon-maskable.svg`,
  `pantessa-apple-touch.svg`, `pantessa-favicon.svg` — tiled icons
- `pantessa-avatar[-emerald|-black|-white].svg` — square avatars for X,
  Telegram and GitHub (they crop to a circle)
- `pantessa-lockup[-ink|-mono-white|-mono-black].svg`,
  `pantessa-stacked[-ink|-mono-white|-mono-black].svg`,
  `pantessa-wordmark.svg` (currentColor)
- `pantessa-x-header[-black|-white].svg` (1500×500),
  `pantessa-linkedin-banner.svg` (1584×396), `pantessa-og-banner.svg`
  (1200×630), `pantessa-social-square[-emerald|-black|-white].svg` (1080×1080)
- `png/` — every one of the above rasterized: favicons 16/32/48/64,
  apple-touch 180, app icon 192/512/1024 + maskable 512, avatars 400/800,
  marks 512 (transparent), lockups 1600w, stacked 1200, the headers, banners
  and squares at their native sizes

## Don'ts

- Never fill the table, and never paint the cut as a line.
- Don't rotate, slant or mirror the mark, and don't stretch the stone off
  square: the cut only works because it is square.
- Don't round the corners or add a chamfer to the top-right one.
- Use the two-tone mark or a single ink. No gradients, no third tone.
- Keep clear space of at least the stem's width (22 on the grid) all round.
- The Emerald Cut, the pangolin and the seal are retired: don't mix eras.

## Regeneration

```
node generate.js --install
bash png-regen.sh   # rasterizes png/ + app/icon.png + apple-icon.png (sharp-cli)
```
