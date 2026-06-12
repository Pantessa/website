# Yeetful logo — install kit

The **agent-graph "Y"** mark (three wallet nodes settling to one hub) + the `yeetful`
wordmark. Flat, single-color, built to live on your dark site and scale down to a 16px favicon.

## What's in here
```
brand-assets/
  yeetful-mark.svg          ← mark, uses currentColor (best for inline / React)
  yeetful-mark-white.svg    ← mark hard-coded white  (for <img> on dark)
  yeetful-mark-black.svg    ← mark hard-coded black  (for <img> on light)
app-icon/
  icon.svg                  ← white mark in a black rounded tile (favicon / app icon)
  icon-512.png              ← 512×512 raster of the tile
  apple-icon.png            ← 180×180 (Apple touch icon)
  favicon-32.png            ← 32×32 raster
components/
  Logo.tsx                  ← drop-in React component (<Logo/> and <YeetfulMark/>)
```

## 1 · The component (nav, footer, anywhere in the app)
Copy `components/Logo.tsx` into your `components/` folder, then:

```tsx
import { Logo, YeetfulMark } from "@/components/Logo";

// full lock-up (mark + wordmark) — e.g. in the header
<Logo size={28} />

// mark only — e.g. compact nav, mobile, loading states
<YeetfulMark size={24} />

// wordmark hidden but same API
<Logo size={28} withWordmark={false} />
```

**Color:** the mark uses `currentColor`, so it takes the surrounding text color — white on your
black nav, black on a light surface. No variant swap needed. To force a color, wrap it:
`<span style={{ color: "#fff" }}><Logo/></span>`.

**Font:** the wordmark uses `Geist Mono` (matches the chosen direction). If your app exposes a
different CSS var for it, edit the one `fontFamily` line in `Logo.tsx`. To use the elegant serif
instead, swap it to `'"Instrument Serif", serif'` and bump `fontWeight` to `400`.

### Replacing the existing logo
Per your repo's structure, the logo lives in the header/footer components (e.g.
`components/Header*` and `Footer.tsx`). Replace the current logo lock-up (the white rounded
square + "yeetful" text) with `<Logo size={…} />` and delete the old mark markup.

## 2 · Favicon + app icons (Next.js App Router)
Drop these into your `app/` directory — the App Router picks them up automatically by filename:

```
app/icon.svg          ← copy from app-icon/icon.svg   (scalable favicon)
app/apple-icon.png    ← copy from app-icon/apple-icon.png
```

That's it — Next generates the `<link rel="icon">` / `apple-touch-icon` tags for you. No
`metadata.icons` config needed. (If you prefer a raster favicon for older browsers, also copy
`favicon-32.png` to `app/icon.png`.)

If you're on the Pages Router instead, put `icon.svg`, `apple-icon.png`, and `favicon-32.png` in
`/public` and add to `<Head>`:
```html
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-icon.png" />
```

## 3 · Static / social use
For OG images, README badges, emails, or anywhere you embed the logo as a file (not React),
use the **hard-coded** variants — `currentColor` does **not** inherit through an `<img>` tag:
- on dark → `yeetful-mark-white.svg`
- on light → `yeetful-mark-black.svg`
- app tile → `app-icon/icon.svg`

## Geometry notes (if you ever need to redraw)
- 40×40 viewBox. Nodes at (9,9), (31,9), (20,33), r=4.4. Hub at (20,20): open ring, r=3, stroke 2.2.
- Arms are `stroke-width` 2.2, round caps, drawn from the hub to each node; a mask cuts a 1.9r hole
  at the hub so the arm intersection stays clean and the center reads as an open ring on any background.
- Wordmark: Geist Mono 500, letter-spacing −0.02em, lowercase.
