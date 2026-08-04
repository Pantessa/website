# Pantessa Design System

**Single source of truth** for the Pantessa design system. These files are:

1. **Served by the website** at `/design-system/` (static, from `public/`), and
2. **Mirrored into Claude Design** (claude.ai/design) via the `DesignSync` tool +
   `/design-sync` skill.

Edit the files here → commit → deploy (the site updates), and push the same files
up to Claude Design (the cloud project mirrors the repo). One source, two
destinations — never edit the cloud copy as a separate fork.

Each `.html` is a self-contained preview; its first line carries a
`<!-- @dsCard group="…" -->` marker so it indexes into the Claude Design pane.

```
index.html          ← Overview · links every card
foundations/
  logo.html         ← Brand · agent-graph "Y" mark, lock-up, clear space, scale
  colors.html       ← Foundations · core palette + Yeet-green accent + functional
  typography.html   ← Foundations · Geist + JetBrains Mono, full type scale
components/
  buttons.html      ← primary / secondary / ghost / destructive, sizes, on-dark
  cards.html        ← service cards, light + dark
  inputs.html       ← default / focused (Yeet ring) / select / disabled
assets/
  yeetful-mark*.svg ← mark (currentColor / white / black)
  icon.svg, *.png   ← app icon + favicons
  Logo.tsx          ← drop-in React component
```

## Live URLs (once deployed)

- Overview: `https://yeetful.com/design-system/`
- e.g. `https://yeetful.com/design-system/foundations/colors.html`

## Updating

- **Change the look:** edit the file(s) here, commit, deploy. The live pages
  pick it up on the next deploy (static assets only change at build time).
- **Mirror to Claude Design:** in a session with design access
  (`/login` with a Claude subscription, or the desktop app's `/design-login`),
  run `/design-sync` — it pushes changed components to the cloud project.

Brand tokens (colors, type, voice) are canonical in the `yeetful-brand` skill;
this directory is the *rendered* component layer of that same brand.
