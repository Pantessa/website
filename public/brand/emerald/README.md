# Pantessa — the Emerald Cut

Pan (all) + tessera (a mosaic tile). An emerald cut is the one gem made
entirely of tiles — rectangular step facets descending to an open table. The
brand emerald is the material itself; the open center is the table, the flat
plane where a signature lands. That open heart is the one idea every prior
mark kept: the mark holds a space only you can fill.

Picked 2026-09-01 from the four-direction restart round ("The Second Cut"),
replacing the pangolin (2026-08-05, `public/brand/pangolin/`) and the unmerged
Open Seal (#670).

## Construction

Nested octagonal bands on a 128 grid: stone 112×88 (the classic 1.27:1 emerald
cut), corner cut 17 scaling with each ring, centered 64,64. The eight corner
miters (width 2.6, outer corner-cut midpoints → table corner-cut midpoints)
are cut through a **mask** — holes, never painted lines — so the mark sits on
any ground. The miters are what make the octagons read as a cut stone rather
than a target: never drop them, never repaint them in a ground color.

`generate.js` here is the kit's source; **`lib/gem-geometry.ts` is the app's**
— the numbers mirror each other, so change both or neither, then re-run
`node generate.js --install` (also refreshes `app/icon.svg` + the
design-system assets) and re-rasterize (below).

## The weight ladder (load-bearing)

A lacy cut cannot share a small box — the seal-era fuzzy-header lesson.

| cut    | rings | band/gap  | floor   | use                          |
| ------ | ----- | --------- | ------- | ---------------------------- |
| `fine` | 5     | 4.6 / 2.4 | ≥ 96px  | ceremony, hero, print, banners |
| `mark` | 3     | 8.6 / 4.0 | 32–95px | pages, cards, app icons      |
| `icon` | 2     | 12.5 / 5.5| < 32px  | nav, tab bars, favicons      |

`gemWeightFor(px)` in `lib/gem-geometry.ts` walks this automatically; the
React component picks by rendered size. **Never ship a cut below its floor.**

## Palette

Facet ramp, deep → bright. Dark grounds: `#0B6B4A → #0F8156 → #159B68 →
#27B67A → #3ECF8E` (mark cut uses 1/3/5, icon 3/5). Paper grounds: `#084A33 →
#0A5C40 → #0C7A52 → #0D8158 → #0e8f62`. In the app these flip with the theme
via the `--gem-1..5` tokens in `app/x402-design.css`. White-label surfaces
re-ink with a single accent + fill-opacity ramp (`gemAccentRamp`). Single-ink
(mono) stones fill every band with one color — the cuts carry the read.

Tile ground behind icons: `#06110B`. Wordmark: "pantessa", Fraunces 600,
−0.015em — outlined to vectors in `wordmark.json`, so no delivered file
depends on a font.

## Files

- `pantessa-gem[-fine|-icon][-paper].svg` — bare stones, every cut, dark/paper
- `pantessa-gem-mono-{white,ink}.svg` — single-ink stones
- `pantessa-app-icon.svg` / `pantessa-apple-touch.svg` / `pantessa-favicon.svg`
  / `pantessa-avatar.svg` — tiled icons
- `pantessa-lockup[-ink|-mono-white].svg`, `pantessa-stacked.svg`,
  `pantessa-wordmark.svg` (currentColor)
- `pantessa-x-header.svg` (1500×500), `pantessa-og-banner.svg` (1200×630)
- `png/` — favicons 16/32/48/64, apple-touch 180, app icon 512/1024, avatars
  400/800, gem 512 (dark + paper), lockups 1600w, stacked 1200, X header, OG
  banner

## Don'ts

- No cut below its ladder floor; no fine cut in a nav or tab bar.
- Never fill the table — the open center is the point.
- Never repaint the miters as colored lines; they are mask holes.
- Don't rotate the stone or swap the proportions toward a square/diamond.
- The pangolin and the seal are retired: don't mix eras in one surface.

## Regeneration

```
node generate.js --install
bash png-regen.sh   # rasterizes png/ + app/icon.png + apple-icon.png (sharp-cli)
```
