# Redesigning Yeetful in Claude design

The goal: keep the **exact structure** of the directory home, make it **prettier**,
then port the result back into the real components.

## Why this folder exists

Claude's design/artifact sandbox runs **one self-contained React file**. It can't
import from this repo, run Next.js, read your Postgres, use the zustand store, or
use `framer-motion`. So `yeetful-directory.artifact.tsx` is a flattened mirror of
the real page: same sections, same card layout, same fields — but with the catalog
inlined and all state local, so it renders and clicks live inside Claude.

## Steps

1. **Grab a screenshot** of the real page so Claude matches the current look:
   ```bash
   npm run dev    # then open http://localhost:3000 and screenshot the home page
   ```
   (Screenshot the `/chat` page too if you want that redesigned next.)

2. **Open Claude** (claude.ai), start a chat, and:
   - Paste the **screenshot**.
   - Paste the **entire contents of `yeetful-directory.artifact.tsx`**.
   - Use this prompt:

   > Here's a screenshot and the React source of my x402 agent directory.
   > Rebuild it as an artifact that keeps **the exact same structure and
   > sections** (top nav, hero, stats row, search, category pills, card grid,
   > floating active bar) and the **same card fields** (icon, name, category,
   > description, `$price/call`, Live/Directory badge, active state,
   > external-link). Just make it prettier and more polished. Don't change the
   > data shape, the props, or what each control does. Keep it a single
   > self-contained file using React + Tailwind + lucide-react only.

3. **Iterate** in Claude until you like it ("tighten the cards", "warmer hero",
   "better empty state", etc.).

4. **Bring it back.** Paste Claude's final artifact here (or tell me to pull it)
   and I'll port the restyle into the real components — the structure already
   lines up 1:1:

   | Artifact section            | Real file                          |
   | --------------------------- | ---------------------------------- |
   | top nav                     | `components/Header*` + `ConnectWallet.tsx` |
   | hero                        | `components/ParticleHeader.tsx`    |
   | stats / search / pills / grid | `app/page.tsx`                   |
   | `ServerCard`                | `components/McpServerCard.tsx`     |
   | floating active bar         | `components/ActiveServerBar.tsx`   |

   The port is mechanical: copy the new JSX/Tailwind classes into those files and
   re-wire the live bits (`useYeetfulStore`, `framer-motion`, `next/image`,
   `/api/servers`). Your logic and data flow don't change.

## Tips for staying "same structure, prettier"

- **Lock the data shape.** Tell Claude not to add/remove card fields — only restyle.
- **Design tokens, not one-offs.** Ask it to define a small palette + radius +
  type scale; that maps cleanly onto `tailwind.config.ts` / `app/globals.css`.
- **One surface at a time.** Home first, then `/chat`. Mixing both in one artifact
  makes the port messy.
- **Keep lucide-react icons** — they exist in both the artifact and the app, so
  icon swaps port for free.
