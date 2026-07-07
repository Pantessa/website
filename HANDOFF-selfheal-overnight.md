# Overnight run — self-heal + onboarding + docs + vibe (2026-07-07)

Branch `self-heal-onboarding` (worktree `website-selfheal`, preview port 3240).
Do NOT merge to main — commit freely to this branch; open a PR for Nate at the end.

Nate's brief: site-wide auto pass to **nail onboarding, SDK integration, and docs
(priority: copy-paste Claude Code prompts to update MCP servers to work well with
the system)**; scan for stale/rough UI, polish UX; **continue the new landing hero
vibe throughout the site**. TOP PRIORITY: **self-healing MCPs — turn user usage +
analytics into "how well is this MCP working" and an actionable improvement loop.**

## Findings (from 4 recon scans)
- **Self-heal today = two disconnected loops.** Router failures → `route_incidents`
  (deduped) → `.github/workflows/self-heal.yml` autonomous fixer (Phase 2, wired).
  Embed dead-ends (`embed_turns`, outcome≠signed) → only a manual copy-paste prompt
  in `/dashboard/embeds`. **The bridge is missing:** embed friction never becomes an
  incident, so nothing automates MCP improvement from real visitor asks.
- **No "MCP health" unification.** routability (`mcp_servers.routability`, mcp:lint),
  reputation (`lib/reputation.ts`, 6 dims), and embed dead-end rate live apart.
- **No published "Routable MCP" spec.** The canonical conventions exist only inside
  `buildUpgradePrompt` (`lib/mcp-lint-report.ts`). Two prompt generators drift
  (`buildUpgradePrompt` vs `EmbedInsights.upgradePrompt`). mcp-kit never referenced.
- **Onboarding = two fighting narratives** — embed-first (`EmbedsPanel`) vs old
  expense-account (`OnboardingChecklist`/`WelcomeNudge`). Homepage CTAs go to docs,
  never to minting a key. SDK version drift (0.9 vs 0.10) across 3 surfaces.
- **Vibe propagation kit already exists** (`.x-grad` gradient word + section mist
  `::before` + serif H1 + pill `.btn` + mono eyebrows). Applied on the homepage;
  NOT on `/docs`, `/pricing`, `/benchmarks`, `/tools`, dashboard headers.

## Backlog (priority order) — ✅ = done this run

### EPIC B — Routable-MCP docs + unified upgrade prompt
- [x] B1 `/docs/routable-mcp` canonical spec page (conventions + 5 lint dims + mcp-kit), registered in `lib/docs.ts`. `lib/routable-mcp.ts` = single source.
- [x] B2 Both prompt generators (routability panel `buildUpgradePrompt` + embed `upgradePrompt`) now cite the shared conventions + spec URL.

### EPIC A — Self-heal from usage & analytics  (TOP PRIORITY)
- [x] A2 Unified **MCP health** — `lib/mcp-health.ts` fuses reputation (usage) + routability + unresolved route_incidents → score/status/headline. `McpHealthPanel` on every server page.
- [x] A3 `/health` cockpit ranks the whole fleet worst-first; attention MCPs get a one-click, health-grounded `buildHealthUpgradePrompt`. Nav + sitemap.
- [ ] A1 (DEFERRED) embed_turns dead-ends → route_incidents bridge. Blocker: embed_turns has no per-MCP attribution + the autonomous fixer targets the monorepo, not third-party MCP repos. Needs the routing trace's serviceName threaded into embed telemetry. Noted for a follow-up.

### EPIC C — Onboarding
- [x] C1 OnboardingChecklist + WelcomeNudge reframed to the embed-first pivot with a self-heal step (mount → watch asks → improve MCPs → optional SDK payer). Ticks off live embed insights.
- [x] C2 EmbedAnywhere gains a "Mint your embed key" CTA → /dashboard.

### EPIC D — SDK integration
- [x] D1 `lib/sdk.ts` single-sources the SDK version; EmbedsPanel + EmbedAnywhere interpolate it (was v0.9 vs >=0.10).
- [ ] D2 (optional) further "Install with Claude" prompt polish.

### EPIC E — UI/UX vibe propagation
- [x] E (core) `.hero__em` + `.pricing__em` upgraded to the hero emerald→gold gradient → lifts docs/benchmarks/tools/activity/servers/pricing at once. /health + /docs/routable-mcp built in-vibe.
- [ ] E4 dashboard headers (mono eyebrows).   [ ] E5 deeper /servers, /activity, /blog polish.

### Verify status
tsc clean throughout; dev server on 3240; new routes /health + /docs/routable-mcp
return 200 with real Neon data; server-page health panels show real signals
(snapshot-free/uniswap-free "Watch" w/ real failures). Chrome extension offline
this run → no screenshots captured (curl content-verified instead).

## Gotchas
- Neon DB is `yeetful` (pass databaseName:'yeetful' to run_sql). Additive schema
  changes pre-approved. Apply via RAW SQL (never `prisma db push` — it wants to drop
  `harness_results`). After editing schema.prisma, run `prisma generate` only.
- Verify: `npx tsc --noEmit`, `npm run build`, preview on 3240.
- Deps installed with `npx pnpm@8 install`.
