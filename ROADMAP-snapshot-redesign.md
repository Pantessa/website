# Roadmap — redesign the token / service page (`/servers/[slug]`)

Target page: **`/servers/yeetful-snapshot`** (the richest launched-token example).
North star: **Hyperliquid's trade screen** — a dense, width-aware, multi-panel
layout where the chart is the hero and a persistent "ticket" rail holds the
buy/sell action.

Branch: `autopilot-snapshot-redesign` (isolated worktree off `origin/main`, so it
does not collide with the live `earn-side` process). Base = commit `2de1b57`
(merge #150), which already contains the full launched-state UI.

---

## 1. What exists today (code-grounded)

| Piece | File | State |
|---|---|---|
| Page shell | `app/servers/[slug]/page.tsx` | Server component, `.x-main` (fixed `--maxw` centered column). Header → approve toggle → desc → `<TokenPanel>` → endpoints list. |
| Token panel | `components/TokenPanel.tsx` | Server component. **Launched** state is one tall bordered box stacking ~8 sub-sections vertically. Pure **inline styles**. |
| Buy/Sell | `components/TradeToken.tsx` | Client. Buy/Sell tabs + one input + button. Inline styles. Works (buy proven live; sell via Permit2). |
| Stake | `components/StakeToken.tsx` | Client. Stake / Unstake / Claim. Inline styles. |
| Stakers | `components/Stakers.tsx` | Client. Bounded log scan, renders nothing until ≥1 staker. |
| Price chart | `components/TokenPriceChart.tsx` + `LazyCharts.PriceChart` | Client. Polls `/api/servers/[slug]/price` (30s), Recharts area, <2 pts → empty state. |
| Design system | `app/x402-design.css` | `.svc*`, `.card`, OKLCH dark palette, `--accent #3ECF8E`, `--line`, `--surf-1/2`, `--fg`, `--muted`. **The token panel ignores all of it.** |

### The three core problems
1. **No width-awareness.** Everything is a single vertical stack at every screen
   size. On a wide monitor the page is a narrow ribbon of whitespace; HL fills
   the width with purposeful panels. Because the panel is **inline-styled, it
   literally cannot hold a media query** — responsiveness requires CSS classes.
2. **Flat hierarchy.** Pitch line, three full-width contract addresses, a stat
   row, prose, chart, trade, stake, stakers, and an explorer link all sit at the
   same visual weight in one box. The two things a visitor wants first — *the
   price chart* and *the buy/sell ticket* — are buried mid-scroll.
3. **Inconsistent + unpolished.** Inline styles diverge from the site's `.svc`/
   `.card` language; the trade + stake forms read as raw inputs, not a "slick"
   ticket.

---

## 2. Target layout (Hyperliquid-style, by breakpoint)

```
DESKTOP  ≥1080px — two columns, sticky ticket rail
┌─────────────────────────────────────────────┬───────────────────────┐
│ ◄ Directory                                   │                       │
│ [icon]  YEETFU · Yeetful Snapshot   [badges]  │   ┌─ TICKET (sticky)─┐ │
│ ── market strip ───────────────────────────── │   │  Buy | Sell      │ │
│  price $9.3e-8 · mcap $9.3K · staked 1.5K ·   │   │  amount [____] Max│ │
│  rev share 10% · 24h ▲ —                       │   │  ≈ you receive    │ │
│                                                │   │  [  Buy YEETFU  ] │ │
│ ┌─ PRICE (hero chart) ───────────────────────┐ │   ├─ Earn ───────────┤ │
│ │  $9.30e-8        1H 1D 1W 1M  ▲ —          │ │   │ Stake|Unstake|Clm │ │
│ │  ████ area chart, gradient ████            │ │   │  staked 500       │ │
│ └────────────────────────────────────────────┘ │   │  claimable $0     │ │
│                                                │   │  [   Stake    ]   │ │
│ How it trades  (prose, secondary)              │   └───────────────────┘ │
│ ▸ Contract details (collapsed: token/vault/…)  │                       │
│ Participating (stakers table)                  │                       │
│ x402 endpoints (existing list)                 │                       │
└─────────────────────────────────────────────┴───────────────────────┘

TABLET  768–1080px — one column, but ticket becomes a 2-up Trade|Earn card row
MOBILE  <768px — single column; chart → ticket → details; primary CTA can
        condense to a sticky bottom "Buy / Sell" bar (P5, optional)
```

Mapping to HL: **market strip** = HL's top stat bar; **hero chart** = HL's center
chart; **sticky ticket** = HL's right order form; **stakers/endpoints/details** =
HL's lower tabs (Positions / Balances). Selling parity already exists in
`TradeToken`, so the ticket is two-way from day one.

---

## 3. Phased build loop

Each phase is independently shippable as its own PR and verifiable headless
(`tsc`, `next build`, preview MCP screenshot at 1440 / 834 / 390 widths).

### P0 — Responsive shell + market strip  *(biggest visual win, lowest risk)*
- Add a `.tok` class family to `app/x402-design.css` (mirrors `.svc`/`.card`
  tokens). Introduce the page grid:
  - `.tok__grid { display:grid; grid-template-columns: minmax(0,1fr) 360px; gap: 28px; align-items:start }`
  - `@media (max-width:1080px){ grid-template-columns: 1fr }` (ticket flows below).
  - `.tok__rail { position: sticky; top: 88px }` (clears the nav).
- In `page.tsx`, widen the launched page to a fluid container (consider
  `.x-main--fluid` for launched tokens only — keep the 70ch column for prose /
  unclaimed states).
- Build the **market strip**: a horizontal, monospace, tabular stat row
  (price · market cap · staked · rev share · 24h). Pull values from
  `panel.token.market` (already on `lib/launch-token.ts`). This replaces the
  current loose stat line and the duplicated price-in-chart.
- **Done when:** page is a real 2-col at ≥1080px, collapses cleanly to 1-col,
  no horizontal scroll at 390px.

### P1 — The trade ticket (slick buy/sell)  *(the headline ask)*
Refactor `TradeToken.tsx` into a proper ticket (still client, still Flaunch SDK):
- **Segmented Buy/Sell** with semantic color — Buy = `--accent` green, Sell = a
  red token (add `--sell:#E5484D` or reuse `--error`). HL-style pill toggle.
- **Amount field** as a single bordered group: large numeric input, unit suffix
  (`ETH` / ticker) inside the field, and **% chips (25/50/75/Max)** that compute
  from the balance already read (`eth.data` / `tokenBal.data`).
- **Live quote preview** — "≈ you receive `N TICKER`" / "≈ `N ETH`". Flaunch SDK
  can quote (`getBuyQuote`/`getSellQuoteExactInput` or equivalent); debounce on
  amount change. Show "—" while loading; never block the button on it.
- **Balance + slippage line** under the input (HL "Available"). Keep the 15%
  testnet-slippage note but style it as fine print.
- **Full-width primary CTA**, busy states reuse the existing `buy/permit/sell`
  copy. Inline success/error rows stay.
- **Done when:** ticket reads like an exchange order form; % chips + quote work;
  buy and sell both still execute on Base Sepolia.

### P2 — Chart as hero
- Promote `TokenPriceChart` to the top of the left column with a header overlay:
  big current price + 24h change chip (green/red) sitting above the area chart,
  HL-style.
- Add **timeframe toggles** (1H / 1D / 1W / 1M / All). The `/price` endpoint
  returns a 30-day series — filter client-side now; widen the window later. If a
  range has <2 points, keep the existing "builds as it trades" empty state.
- Unify the sub-$1 price formatter (the `usd()` helper is duplicated in
  `TokenPanel`, `TokenPriceChart`; hoist to `lib/launch-token.ts` and import).
- Taller chart on desktop (~260px), responsive height down to ~180px on mobile.
- **Done when:** chart is the visual anchor; timeframes switch; formatting is
  one shared helper.

### P3 — Earn / stake card
- Restyle `StakeToken.tsx` to live in the rail under the trade ticket (or as a
  second tab of the same card: **Trade | Earn**).
- Sub-tabs Stake / Unstake / Claim; surface **claimable USDC** as the hero
  number (it's the payoff). Keep approve→stake flow.
- **Done when:** staking reads as a clean "earn" panel, claimable is prominent.

### P4 — Secondary info & density
- Collapse the three contract addresses (Token / Staking vault / Creator) into a
  `▸ Contract details` `<details>` block — keep the verified badge visible, hide
  the hashes by default (HL hides contract minutiae).
- Move "How it trades" + "Progressive Bid Wall" prose into a compact secondary
  card below the chart.
- Restyle `Stakers` as a tidy table (address · staked), matching `.eps` row
  styling.
- Leave the existing **x402 endpoints** list as-is structurally — it's already
  on `.eps` classes — but ensure it sits below the fold in the left column.
- **Done when:** the first screen is chart + ticket + strip; everything else is
  scannable, collapsible, and consistent with `.svc`/`.eps`.

### P5 — Polish & mobile finish  *(optional / stretch)*
- Migrate **all** remaining inline styles in the four client components to `.tok`
  classes (theming, hover/focus states, motion).
- Mobile: optional **sticky bottom Buy/Sell bar** that opens the ticket (HL
  mobile pattern).
- A11y pass: focus rings on tabs/inputs, `aria-pressed` on segmented controls,
  reduced-motion for the chart gradient, ≥40px tap targets (project standard).
- Re-run the 26-combo responsive sweep used in prior runs; watch the recurring
  implicit-grid-track bug (`min-w-0` / `grid-cols-1` base).

---

## 4. Constraints & gotchas (carry forward)
- **`TokenPanel` is a server component**; `TradeToken`/`StakeToken`/`Stakers`/
  `TokenPriceChart` are client. Keep that boundary — push interactivity into the
  client leaves, do layout/CSS in the server parent + stylesheet.
- **Inline → CSS is the unlock.** Media queries are impossible on the current
  inline styles; P0's `.tok` classes are a prerequisite for true responsiveness.
- Testnet (`LAUNCH_CHAIN` = Base Sepolia), thin pools, ~15% slippage — quotes
  and prices will look jumpy; design for the sparse/empty case.
- Flaunch SDK bundles its own viem (the `as never` casts in `TradeToken`); any
  new SDK calls (quotes) inherit that pattern.
- Don't regress states: **unclaimed** and **claimed** panels stay simple — the
  redesign targets the **launched** state. Verify all three render.
- Verify against `next start` (not the dev server) per project convention; the
  `earn-side` process holds :3000 — use a different port.

## 5. Suggested PR sequence
1. P0 shell + strip → 2. P1 ticket → 3. P2 chart → 4. P3 earn → 5. P4 density →
6. P5 polish. Land P0 first (everything else hangs off the grid + `.tok` tokens).
