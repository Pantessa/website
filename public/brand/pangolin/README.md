# Pantessa — the pangolin mark

**Pan** (all) + **tessera** (a mosaic tile). A pangolin is the one animal
literally built out of tiles: every scale is a tessera, the whole creature is
the mosaic. It curls into armour around what it carries (the guardrail layer),
and it digs through everything to find one good thing (the router).

Served at `/brand/pangolin/…` — these files are public, so they can be linked
from press kits, docs and social profiles directly.

## Construction

Generated geometry, not hand-drawn — see `generate.js`:

    one cubic spine  →  tapering tube (body + tail, cosine-eased)
                     →  3 chevron grout cuts, spaced evenly by ARC LENGTH
                     →  a wider neck cut (so the head reads separate)
                     →  head disc + blunt snout

Exactly one plate carries the accent: **the set tessera**. The eye is *punched
through the mask*, so it is a hole rather than a painted dot and therefore works
on any ground. All art is fitted to its true ink box (`130.7 × 80.9` inside the
128 grid) — fitting to the grid instead clips the snout and tail tip.

Regenerate everything with:

    node generate.js

## Colours

| Token | Hex | Use |
|---|---|---|
| accent (set plate) | `#3ECF8E` | mirrors `--accent` in `app/x402-design.css` |
| ink | `#0A0A0B` | armour on light grounds; icon chips |
| paper | `#FAFAF7` | armour on accent/colour grounds |
| app gradient | `#0B4F35 → #2FBF80` | across the plates, pale plate `#EAFFF4` |

## Files

### Core marks — transparent, for layout
- `pantessa-pangolin.svg` — **master**; armour rides `currentColor`, accent plate. Use this inline.
- `pantessa-pangolin-white.svg` / `-ink.svg` / `-paper.svg` — hardcoded armour for `<img>` contexts.

### Single-ink — no accent, for one-colour contexts
- `pantessa-pangolin-mono.svg` (currentColor), `-mono-white.svg`, `-mono-ink.svg`
- `pantessa-pangolin-accent.svg` — the whole mark in `#3ECF8E`.

### Chips & icons — self-contained backgrounds
- `pantessa-favicon.svg` — white armour on an ink chip. This is `app/icon.svg`.
- `pantessa-icon-ink.svg` / `-accent.svg` / `-paper.svg` — square chips in each ground.
- `pantessa-app-icon.svg` — gradient across the plates on ink.
- `pantessa-apple-touch.svg` — full-bleed square (iOS rounds it itself).
- `pantessa-avatar.svg` — pre-scaled to survive a circle crop.

### Lockups — mark + wordmark
- `pantessa-lockup*.svg` (horizontal), `pantessa-stacked*.svg` — in `currentColor`, white and ink.
- The wordmark is Archivo 700 at `-0.035em`, **converted to outlines**: no file
  here depends on a font being installed.

### Social
- `pantessa-twitter-header.svg` — 1500 × 500.

### `png/` — rasters, transparent unless noted
- Marks: `pantessa-pangolin-{white,ink}-{16,24,32,48,64,128,256,512,1024}.png`
- Single-ink / accent / paper: `…-{mono-white,mono-ink,accent,paper}-{32,64,128,256,512}.png`
- Favicons: `favicon-{16,32,48,64}.png`
- Icons on chips: `pantessa-icon-ink-{256,512,1024}.png`, `pantessa-icon-{accent,paper}-{256,512}.png`
- App: `pantessa-app-icon-{512,1024}.png`, `apple-touch-icon-180.png`
- **Social: `pantessa-twitter-avatar-{400,800,1000}.png`** (X's recommended
  upload is 400×400; it renders as a circle), `pantessa-twitter-header-1500x500.png`
- Lockups: `pantessa-lockup-{white,ink}-{400,800,1600}.png`,
  `pantessa-stacked-{white,ink}-{400,800}.png`

## Where it is wired

| Surface | File |
|---|---|
| Nav, footer, chat rail, app shell | `components/Logo.tsx` → `PantessaMark` |
| First-party `yeetful-tool-*` MCP tiles | `components/protocol-marks.tsx` → `YeetfulMark` |
| Favicon / app icons | `app/icon.svg`, `app/icon.png`, `app/apple-icon.png` |
| Social card | `app/opengraph-image.tsx` |
| Design-system downloads | `public/design-system/assets/` |

`YeetfulMark` is kept as an alias of `PantessaMark` so existing import sites
keep working through the rebrand; both render the same art.

## Don'ts

- Don't recolour the armour and the plate independently — one accent, or none.
- Don't paint the eye; it is a mask hole by design.
- Don't scale the art to the 128 grid; use the supplied fit transform.
- Don't use a curled/coiled pose: **pangolin.exchange (Pangolin DEX) already
  uses a curled pangolin** in this industry. The walking profile is deliberate.
