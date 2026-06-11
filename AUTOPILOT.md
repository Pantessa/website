# Autopilot — Run 4: the blog (staged 2026-06-11, owner-approved; start via /loop)

DB-backed blog on the website: Neon for post metadata, Vercel Blob for images,
the existing Bearer-key auth as the headless publish path (dogfooding the
product), and a Claude-authored first post. One item per iteration; PRs into
`autopilot`, never `main`. Prior runs summarized at the bottom.

## Rules (constitution — apply to every iteration)

1. **Branching**: `autopilot-<slug>` cut from `autopilot`. PRs target
   `autopilot`, never `main`. Items independent; unavoidable stacking
   declared in the PR with merge order. (Items 2–5 build on item 1's schema/
   API by nature — stack on the prior item's branch when files overlap and
   declare it; merge order is queue order.)
2. **Never**: merge any PR, push to `main`, force-push, deploy, publish to
   npm, or make live paid x402 calls. No spending of any kind.
3. **DB**: additive only (plain `db push`, never `--force-reset`); never
   destroy user data. Test rows under throwaway wallets, cleaned + verified.
   The first-post seed (item 5) is deliberate content, not test data — it
   stays, and its full text ships in the PR for review.
4. **Security**: blog markdown renders WITHOUT raw HTML (escaped, no
   rehype-raw / dangerouslySetInnerHTML) — publish access is wallet-gated but
   stored content must still never XSS readers. Admin = wallets listed in the
   `ADMIN_WALLETS` env (comma-separated, lowercased); unset → publish routes
   refuse with a clear error. Verification injects a throwaway admin via env.
5. **Verify before PR**: `npx tsc --noEmit` + `npm run build` minimum.
   Server logic: extend `npm run test:api` (preferred) — a blog section with
   throwaway admin + non-admin wallets. UI: preview at 1440px +
   headless-Chrome screenshots under `docs/autopilot/` on the PR branch.
6. **Honesty**: anything unverifiable is flagged, not claimed (e.g. Vercel
   Blob uploads until BLOB_READ_WRITE_TOKEN exists).
7. **Logging**: Progress log updated on `autopilot` after each item; one item
   failing twice → log + move on; two consecutive failures → stop.
8. **Isolation**: this session's worktree; don't touch PRs from other runs.
9. **Stop conditions**: queue exhausted, two consecutive failures, or owner
   message. Final iteration appends a run summary.

## Queue (ordered; one per iteration)

- [ ] **1. BlogPost model + publish API** — Prisma `BlogPost` (slug unique,
  title, description, content markdown, coverImageUrl?, tags String[],
  published Boolean default false, publishedAt?, authorAddress, timestamps;
  additive db push). Routes: `GET /api/blog` (public: published only, newest
  first; admin sees drafts with `?drafts=1`), `POST /api/blog` (admin only),
  `GET/PATCH/DELETE /api/blog/[slug]` (GET public when published, admin
  otherwise). Admin auth = `getAuthAddress` (SIWE or Bearer `yf_…` key) ∩
  `ADMIN_WALLETS` env allowlist — the Bearer path IS the headless
  Claude-publishes flow. Slug auto-derived from title when omitted; publishing
  sets publishedAt once. Extend test:api with a blog section (admin CRUD,
  non-admin 403, anon sees only published, draft flow, cleanup).
- [ ] **2. Public blog UI** — `/blog` index (post cards: title, description,
  date, tags, cover when present) + `/blog/[slug]` (markdown via
  react-markdown + remark-gfm, NO raw HTML; cover, date, tags; 404 for
  drafts/unknown). Existing dark design system (svc/ep-style classes or a
  small `blog__` section). Nav tab + footer link. generateMetadata per post
  (title/description/OG). Preview screenshots incl. a seeded-then-cleaned
  sample post at 1440px and 375px.
- [ ] **3. Image uploads (Vercel Blob)** — `POST /api/blog/upload` (admin
  only): multipart/byte upload to @vercel/blob, returns the public URL for
  use as coverImageUrl or inline markdown image. Graceful 503 with a clear
  message when BLOB_READ_WRITE_TOKEN is unset (it currently is — flag manual
  for after the owner adds it; verify the 503 path + auth gating in
  test:api; mock-level verification of the success path only if feasible
  without the token, otherwise flagged).
- [ ] **4. RSS + sitemap** — `/blog/rss.xml` (published posts, proper
  pubDate/guid) and a `/sitemap.xml` covering /, /developers, /servers/[slug]
  (callable few) + blog posts. Verified by fetching + parsing both routes in
  test:api or a script assertion (well-formed XML, post present).
- [ ] **5. First post (Claude-authored)** — written in the yeetful brand
  voice (dry, precise, one wink): "An agent shipped this blog" — the story of
  the autopilot runs (constitution → queue → PRs → guardrails catching real
  bugs: the wipe-on-empty incident, Venice's exact-$10 challenge), what the
  expense-account product is, and that this very post was published through
  the Bearer-key API the post describes. ~600–900 words, honest, no hype
  words. Committed seed script (idempotent, full text in the PR body for
  review); seeded as published=true (invisible in prod until the blog
  deploys). Rendered-page screenshot in the PR.

## Progress log — Run 4

_(autopilot appends here — branch, PR, verification evidence, caveats)_

---

## Run 3 summary (2026-06-11)

**Queue: 5/5 complete.** Zero failed iterations. Nothing merged, no deploys, no spending; prod-DB items executed within guardrails. All website PRs target `autopilot`.

| # | Item | PR |
|---|------|----|
| 1 | test:api harness (25 checks) | [#42](https://github.com/Yeetful/website/pull/42) |
| 2 | Runner-feed duplicate-key fix | [#43](https://github.com/Yeetful/website/pull/43) |
| 3 | SDK 0.3 ripple | [example-agent#1](https://github.com/Yeetful/example-agent/pull/1) · [demo#2](https://github.com/Yeetful/demo/pull/2) |
| 4 | Ingest auto-wire probe + wipe-on-empty fix | [#44](https://github.com/Yeetful/website/pull/44) |
| 5 | Stale BlockRun URL fix-up | [#45](https://github.com/Yeetful/website/pull/45) |

**Merge order**: #42 → #43 → #44 → #45 (all independent); example-agent#1 + demo#2 any time.

**Notable**: item 4's integrity check caught the ingest deleting yeetful-claude's hand-seeded endpoint (wipe-on-empty) — fixed + seed survival proven. Venice's gateway demands an exact $10 authorization per call (probe evidence — vindicates the auto-wire cap). Item 3 found the website needed no caveat removal (queue over-assumed). DB net effect this run: 13 URL rewrites, +3 upstream endpoints, wiring 7/7 intact throughout.

**Owner manual passes**: unchanged from Run 2 (one wallet session) + demo `--live` on 0.3.0.

---

## Run 2 summary (2026-06-10 evening)

**Queue: 7/7 complete.** Zero failed iterations. Nothing merged, no deploys, no spending. All PRs target `autopilot`.

| # | Item | PR |
|---|------|----|
| 1 | API-key management UI | [#34](https://github.com/Yeetful/website/pull/34) |
| 2 | "Connect an agent" card | [#35](https://github.com/Yeetful/website/pull/35) — stacked on #34, merge #34 first |
| 3 | "Sign grant" wallet button | [#36](https://github.com/Yeetful/website/pull/36) |
| 4 | Chat payments-footer dedup | [#37](https://github.com/Yeetful/website/pull/37) |
| 5 | Directory refresh + Claude seed (prod DB) | [#38](https://github.com/Yeetful/website/pull/38) — DB changes already live |
| 6 | Responsive pass | [#39](https://github.com/Yeetful/website/pull/39) |
| 7 | /developers page | [#40](https://github.com/Yeetful/website/pull/40) |

**Suggested merge order**: #34 → #35 → #36 → #37 → #38 → #39 → #40. All independent except #35 (stacks on #34). NOTE: #33 (inference providers, targets main) shares files with #36/#37/#38 — merge autopilot→main AFTER #33, or vice versa; the ingest-map hunk in #38 is identical to #33's so it merges clean.

**Manual passes for the owner** (most fold into one wallet session):
- Dashboard glance: key panel (mint→reveal→copy→revoke), connect-agent card, sign-grant button + one wallet signature.
- One live paid chat turn (~$0.001–0.01): covers #30/#33/#37 receipts end-to-end.
- demo repo: `npm run grant -- --live`.

**Deviations/notes**: #35 stacking declared per rule 1's escape hatch; #38's safety catch (ingest map predated #33 — would have unwired prod inference providers; fixed before running); headless-Chrome mobile captures clip ~15px (camera artifact, programmatic overflow scan is authoritative); mcp_endpoints has no `source` column so hand-seed provenance lives in the description + committed script.

---

## Run 1 (2026-06-10) — COMPLETE, 6/6, all merged to main

| # | Item | PR |
|---|------|----|
| 1 | API keys for headless agents | website#26 + sdk#2 |
| 2 | EIP-712 grant signing (server) | website#27 |
| 3 | Service detail page /servers/[slug] | website#28 |
| 4 | Cost-at-volume warnings | website#29 |
| 5 | Example integration | github.com/Yeetful/example-agent |
| 6 | Receipts → Message.meta + footnotes | website#30 |

Follow-ups merged same day: #31 (Details links), #32 (autopilot→main),
demo#1 (live mode via published SDK). Manual passes still pending from Run 1:
wallet-paid chat turn, demo `--live`, SDK↔prod sync, dashboard visuals.
Full iteration log: `git log --follow AUTOPILOT.md` (pre-Run-2 revisions).
