# Pantessa — the Open Seal

The mark (2026-08-27, supersedes the pangolin): a **guilloché seal** — three
bands of machine-turned lacework, framed by hairline circles, **open at the
heart**. Guilloché is the engine-turning that makes money look like money —
the oldest anti-forgery visual system there is; no hand can draw it, only a
machine holding perfectly steady, which is the product. The middle stays
empty on purpose: it's where the signature goes. A seal with a blank center
is a seal awaiting countersign.

## Construction

Every band is a phase-shifted family of sine-modulated rings on a 128 grid,
centered at (64,64): `r(θ) = R + A·sin(kθ + φ)`.

| band   | R    | A   | k  |
| ------ | ---- | --- | -- |
| outer  | 49   | 4   | 16 |
| middle | 35.5 | 6   | 9  |
| inner  | 21   | 6.5 | 6  |

Frames: hairline circles r 58 / 55.5 outside, r 13 around the open heart.
`generate.js` is the one source here and mirrors `lib/seal-geometry.ts`
(which feeds `components/Logo.tsx`, `components/protocol-marks.tsx` and
`lib/og-marks.ts`) — change constants in both places or nowhere.

## The ladder (which file to use)

Real currency is magnification-aware: lace at portrait size, one bold turn on
the coin edge. Same rule here:

- **defined** (`pantessa-seal*.svg`) — 6 passes per band, full weight.
  Hero art and print, anything **≥ 96 px**.
- **bold** (`pantessa-seal-bold*.svg`) — 4 heavier passes, deeper waves.
  **40–95 px**.
- **icon** (`pantessa-seal-icon*.svg`) — the essence: one heavy outer ring +
  a single two-pass woven band, three strokes total. Headers, tiles,
  favicons, avatars-in-feeds — **anything under 40 px** (the lacier cuts haze
  into a fuzzy circle there). `components/Logo.tsx` walks the ladder
  automatically (icon < 40, bold 40–95, defined ≥ 96); avatars, app icon and
  favicon chips in this kit are cut at icon weight.
- **microprint** (`pantessa-seal-microprint*.svg`) — the ceremonial cut with
  the banknote microtext ring. Screens **≥ 96 px** and print only; never a
  favicon. (Uses `<textPath>` — not satori-safe, so never in an OG card.)

## Colors

Single-ink line art — one color per file, so re-inking is trivial:

- green on ink `#3ECF8E` (mirrors `--accent`, dark theme)
- green on paper `#0E8F62` (mirrors `--accent`, light theme)
- black `#0D1712`, white `#FFFFFF`
- the React component rides `currentColor`; a white-label surface may pass a
  creator accent to re-ink the whole turning (there is no two-color state).

## Files

- `pantessa-seal[-dark|-black|-white].svg` — the mark, transparent ground.
- `pantessa-seal-bold[-dark|-black|-white].svg` — the mid-size cut.
- `pantessa-seal-icon[-dark|-black|-white].svg` — the small-size cut.
- `pantessa-seal-microprint[-dark].svg` — ceremonial.
- `pantessa-avatar-{ink,paper,black-on-white,white-on-black}.svg` — full-bleed
  square social avatars (safe under circular crops).
- `pantessa-app-icon.svg` / `pantessa-favicon.svg` — rounded ink chips
  (rx 30 / 28); the favicon chip is copied to `app/icon.svg`.
- `png/` — rasters: avatars at 400/800/1024, marks at 512/1024, app icon at
  180/512/1024, favicons at 16/32/48/64.

## Regenerating

```bash
node generate.js       # SVGs, written next to this file
# PNGs (needs npx; sharp-cli pulls its own binary):
cd public/brand/seal && for f in pantessa-avatar-ink:1024 ...; do
  npx --yes sharp-cli --input "${f%%:*}.svg" --output "png/${f%%:*}-${f##*:}.png" resize "${f##*:}" "${f##*:}"
done
```

## Don'ts

- Don't put the microprint cut anywhere it renders under 96 px.
- Don't use the defined cut below 96 px or ANY lacy cut below 40 — they
  haze into a fuzzy circle; that's what the icon cut is for.
- Don't fill the open heart on house surfaces — the void is the meaning.
  (White-label /l pages MAY seat the creator's mark in it; that's the one
  sanctioned tenant.)
- Don't rotate, crop the outer hairline, or add a drop shadow.
