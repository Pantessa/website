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

## Backlog (priority order)

### EPIC B — Routable-MCP docs + unified upgrade prompt  (do first: dependency)
- [ ] B1 `/docs/routable-mcp` canonical spec page (conventions + 5 lint dims + mcp-kit), register in `lib/docs.ts`.
- [ ] B2 Unify prompt generators → `lib/upgrade-prompt.ts`, cite the spec URL + mcp-kit. Used by RoutabilityPanel + EmbedInsights.

### EPIC A — Self-heal from usage & analytics  (TOP PRIORITY)
- [ ] A1 Bridge: cluster embed_turns dead-ends per MCP into deduped health signals (new table + `lib/embed-heal.ts` + `scripts/embed-heal-scan.ts`).
- [ ] A2 Unified **MCP health** score (routability + reputation + embed dead-end rate) — `lib/mcp-health.ts`, shown on server pages + a dashboard health view.
- [ ] A3 Feed the loop: health signals surface as an improvement backlog with an auto-generated, ask-grounded Claude Code prompt (reuses B2).

### EPIC C — Onboarding
- [ ] C1 Reconcile onboarding to embed-first (rework OnboardingChecklist + WelcomeNudge): mount chat → get key → watch analytics → improve MCPs.
- [ ] C2 Homepage → a real "get a key" path, not just docs.

### EPIC D — SDK integration
- [ ] D1 Kill SDK version drift (single source constant).
- [ ] D2 Polish the "Install with Claude" prompt; align to routable-mcp doc.

### EPIC E — UI/UX vibe propagation
- [ ] E1 /docs pages → hero vibe.   [ ] E2 /pricing.   [ ] E3 /benchmarks + /tools.
- [ ] E4 dashboard headers.          [ ] E5 /servers, /activity, /blog polish.

## Gotchas
- Neon DB is `yeetful` (pass databaseName:'yeetful' to run_sql). Additive schema
  changes pre-approved. Apply via RAW SQL (never `prisma db push` — it wants to drop
  `harness_results`). After editing schema.prisma, run `prisma generate` only.
- Verify: `npx tsc --noEmit`, `npm run build`, preview on 3240.
- Deps installed with `npx pnpm@8 install`.
