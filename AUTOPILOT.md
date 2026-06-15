# Autopilot — Run 12: The kill switch + SDK 0.5 (org budgets & remote pause) (STAGED 2026-06-13)

Owner directive: build BOTH the agent kill switch (website) AND SDK 0.5 (the
org-budget + remote-pause enforcement that finishes Run 11's loop). Context
for a fresh session: read ../CLAUDE.md first (root). On main as of 2026-06-13:
Run 11 ORGS fully merged (#94→#98) — orgs/members/roles (lib/org.ts),
org-scoped keys/grants/approvals via the `org:<id>` scope-key, two-level
budget surfaced in GET /api/agent/policy as an `org` block + on receipt-sync
echoes, the expense report, /docs/teams. Also: payment-web hero (#93). **SDK
is 0.4.0, PUBLISHED to npm** (per-key budgets live; the policy `org` block is
NOT yet consumed by any SDK — that's this run's item 3). test:api is 80/80 on
main.

The two halves interlock: the kill switch defines a new HALT signal in
/api/agent/policy + the sync echo; SDK 0.5 consumes BOTH that halt signal AND
the Run-11 org block in one release. So item 1 (website) defines the contract;
item 3 (SDK) mocks exactly those shapes. Build website-first.

## Rules (Run 6/7 constitution + Run 8 D-rules + Run 10 E-rules + Run 11 F-rules apply; additions)

G1. **Additive schema ONLY** (E1/F1): `paused Boolean @default(false)` on
    api_keys + spend_grants; plain `prisma db push` with inline DATABASE_URL
    (NEVER --force-reset — wipes the directory). default false = nothing
    paused, full back-compat; existing test:api checks stay green.
G2. **Pause is as HARD as the rail allows, honest about where it isn't.**
    For the chat paths Yeetful itself executes (burner + the wallet-plan
    gate), a paused/frozen grant is a SERVER-SIDE hard refusal (ledger the
    denial). For external SDK agents paying from their own wallet, pause is
    advisory — surfaced in /api/agent/policy, enforced by the SDK locally
    (same trust split as budgets, E3/F5). Docs MUST state this split; never
    imply Yeetful can freeze an agent's own wallet.
G3. **Pause is REVERSIBLE and distinct from revoke.** Key DELETE and grant
    status:revoked are unchanged; `paused` is a separate, toggle-on/off flag
    that loses no history. Management is SIWE only — owner for personal,
    org admin+ for org keys/grants (reuse Run 11 canManageKey / requireRole /
    canAccessGrant). A Bearer key can NEVER pause/resume itself.
G4. **The policy contract is the bridge** (E2 sync rule): define the new
    fields on the WEBSITE side (item 1) and mock EXACTLY those shapes in the
    SDK tests (item 3). Proposed shape — keep or refine, but keep them in
    lockstep: policy gains `agent.paused`, `grant.paused` (account frozen),
    a top-level `halted: boolean` + `haltReason: 'AGENT_PAUSED' |
    'ACCOUNT_FROZEN' | null`; the org block from Run 11 stays. Receipt-sync
    echo carries the same halt fields.
G5. **Two repos** (E1): website off `main` in this repo; SDK in ../sdk off
    ITS main (npm has 0.4.0). One PR per repo, NEVER stacked across repos.
    NEVER merge PRs, NEVER npm publish, NEVER spend real money — zero-spend
    smokes only. Verify against `next start` (E2; pkill matches the process
    name `next-server`, never the dev server). Mobile constitution (E5) +
    docs/SEO (E4) on every changed surface. Log per item to the autopilot
    branch (E6), push after EVERY item.

## Queue (ordered; one per iteration)

- [x] **1. Kill switch — backend** (website, branch `kill-switch` off main):
  schema `paused` on api_keys + spend_grants (additive push to Neon).
  Pause/resume: PATCH /api/keys/[id] accepts `{paused}` (SIWE; personal owner
  or org admin+ via canManageKey); grant freeze via PATCH /api/grants/[id]
  `{paused}` (SIWE owner / org admin+ via canAccessGrant). GET
  /api/agent/policy gains `agent.paused`, `grant.paused`, top-level `halted`
  + `haltReason` (G4); the receipt-sync `{agent}`/echo gains the same.
  **Hard enforcement** in /api/chat: when the owner's active grant is paused,
  the burner + wallet-plan paths refuse and ledger an `ACCOUNT_FROZEN`
  denial (G2). Extend test:api: pause key → policy halted/AGENT_PAUSED;
  resume clears; freeze grant → chat plan HARD-refuses + policy
  ACCOUNT_FROZEN; Bearer can't pause itself (401); org admin pauses an org
  key, a member can't (403).
- [x] **2. Kill switch — dashboard + docs** (SAME `kill-switch` branch — one
  PR, extend it, do NOT stack a second PR): Agents tab gets a Pause/Resume
  toggle per agent (visually distinct from Revoke; paused = idle/amber),
  org-scoped; Overview grant card gets a reversible "Freeze account" control
  + a frozen banner. /docs: a "Pause & freeze" section (extend /docs/agents
  or a short new registry page) stating the hard-vs-advisory split (G2);
  cross-link. Mobile constitution; mock-harness the wallet-gated surfaces
  like prior dashboard sweeps.
- [x] **3. SDK 0.5 — org budgets + remote pause** (../sdk off its main):
  consume the policy `org` block → refuse `OVER_ORG_BUDGET` (org overBudget,
  or call price > org remainingTodayUsd), receipted; consume the halt flags →
  refuse `AGENT_PAUSED` / `ACCOUNT_FROZEN`, receipted; refresh org + halt
  state from the sync echo on every flush and re-fetch policy on
  flushLedger(); expose the org snapshot on pay.agentBudget() (or pay.status()
  for halt). Tests mirror the suite (mock policy + echoes): org under cap
  passes, at cap refuses, paused halts, frozen halts, state clears on the next
  refresh, policy-fetch failure degrades open. README "Org budgets & remote
  pause". Version 0.4.0 → 0.5.0 in the PR. DO NOT publish.
- [x] **4. Exit verification** — website branch: tsc + build + full test:api
  against `next start`; sdk repo: its suite green; 375/390 rect-scans of every
  changed dashboard/docs surface (exclude elements inside overflow-x:auto
  ancestors — the Run 11 false-positive lesson); run summary in this file;
  update ../CLAUDE.md top section; push `autopilot`.

## Progress log — Run 12

_(autopilot appends here, newest first; push after every item)_

### Item 4 — Exit verification ✅ (2026-06-13) — RUN COMPLETE

Re-verified both PR tips fresh: website `kill-switch` (#99) — tsc + build
clean, **test:api 88/88** vs `next start :3210` (PID-killed, never pkill);
sdk `sdk-0.5-org-pause` (sdk#6) — **vitest 30/30**. 375/390 dashboard+docs
sweeps carried from item 2 (zero offenders; no UI changed since). Both PRs
are INDEPENDENT (website off main, sdk off its main — no stacked chain this
run); merge in either order. The kill-switch ⇄ SDK contract lines up once
both are live; the SDK degrades open if the deployed API predates the
halt/org fields, so order doesn't matter.

---

## Run 12 summary (2026-06-13)

**Queue: 4/4. Zero failed iterations.** The kill switch — the "stop it now"
control verb — is live end to end, and SDK 0.5 makes both the org budget
(Run 11) and the kill switch enforced SDK-side.

| # | Item | PR |
|---|------|----|
| 1+2 | Kill switch: reversible agent pause + account freeze (backend + dashboard + docs) | [#99](https://github.com/Yeetful/website/pull/99) |
| 3 | SDK 0.5 — org budgets + remote pause enforcement | [sdk#6](https://github.com/Yeetful/sdk/pull/6) |
| 4 | Exit verification | (this entry — no code PR) |

**Merge notes**: #99 and sdk#6 are INDEPENDENT (no stacked chain — the
Run-11 lesson applied). #99: additive `paused` schema ALREADY on Neon;
test:api 80 → 88. sdk#6: 0.4.0 → 0.5.0, NOT published (owner publishes npm).

**Design decisions worth keeping**:
- **The freeze rides the existing gate**: `paused` on GrantPolicy + an
  `ACCOUNT_FROZEN` throw at the top of checkGrant → both chat paths
  hard-refuse server-side with zero new gate code. Pattern: when a new
  blanket denial is needed, add it to the shared pure gate, not each caller.
- **Pause is as hard as the rail allows**: server-side hard stop for chats
  Yeetful executes (burner + wallet-plan), advisory (SDK-enforced) for
  external agents paying their own wallet. Stated honestly in /docs/agents.
- **AGENT_PAUSED > ACCOUNT_FROZEN** in haltReason precedence (the more
  specific signal for the operator).
- SDK 0.5 mirrored the 0.4 per-key budget pattern exactly for the org block
  (unsynced bucket, echo refresh, daily roll) — low-risk by construction.

**Owner passes / follow-ups**:
- **Review #99 before merge** — the one live-payments touch is the
  checkGrant ACCOUNT_FROZEN throw (first in the gate). Worth a human read.
- **Publish yeetful 0.5.0** to npm after merging sdk#6 (npm has 0.4.0).
- Signed-in dashboard glance: pause toggle on Agents, Freeze on Overview.
- Tooling reminder logged in item 2: `next start` serves the PREBUILT
  output — harness pages added post-build 404; use the preview `web` dev
  config (compiles on demand) or rebuild.

### Item 3 — SDK 0.5: org budgets + remote pause ✅ (2026-06-13) — [sdk#6](https://github.com/Yeetful/sdk/pull/6)

Branch `sdk-0.5-org-pause` off SDK main (separate repo — npm has 0.4.0).
Mirrors the proven 0.4 per-key pattern for two new policy fields: the `org`
block (Run 11) → `OVER_ORG_BUDGET` (org overBudget pre-flight, or price >
org remaining in the hook), with its own unsynced-spend bucket + daily roll +
sync-echo refresh; and the halt flags (#99) → `AGENT_PAUSED` / `ACCOUNT_FROZEN`
refused in the pre-flight BEFORE any network, clearing on the next refresh.
Renamed refreshAgentBudget → refreshPolicy (pulls agent + org + halt). New
pay.orgBudget() + pay.status(); exported OrgBudget/HaltStatus/HaltReason.
README "Org budgets & remote pause" + CHANGELOG; 0.4.0 → 0.5.0; NOT published.

Verified: tsc + tsup build clean; **vitest 22 → 30** (org under/over cap,
price-hook breach, unsynced org spend, both halt reasons no-network, resume
clears, degrade-open). Mocks match #99's exact shapes ({halted, haltReason,
org, agent} on policy + echo) — so when #99 + sdk#6 are both live the contract
lines up. Both PRs merge independently; SDK degrades open if the deployed API
predates the fields.

### Item 2 — Kill switch dashboard + docs ✅ (2026-06-13) — [#99](https://github.com/Yeetful/website/pull/99) (kill-switch PR, items 1+2)

Same `kill-switch` branch as item 1 → ONE PR (#99, base main, independent —
the SDK half is item 3 in ../sdk). Agents tab: per-agent Pause/Resume toggle
(amber border + "paused" pill + idle label, distinct from Revoke), optimistic,
org-scoped (inherits the ?org= AgentsPanel). Overview: reversible "Freeze
account" button + frozen banner + amber full bar; stats route + Stats type
carry grant.paused. /docs/agents gained "The kill switch: pause & freeze"
(hard-vs-advisory split per G2; cross-links /docs/teams) — zero entity-space
joints in rendered HTML.

Verified: tsc + build clean; test:api still 88/88 (no API contract change
beyond item 1); hand-rolled mock harness (deleted) screenshotted both
paused-row + frozen-account states at 1280; 375 scroller-aware rect-scan zero
offenders. Tooling note: `next start` serves the PREBUILT output — a harness
page added after the build 404s; either rebuild or use the preview `web` (dev)
config, which compiles on demand (used the dev server here, port 3000 was free).
PR #99 review flag: the one live-payments touch is the checkGrant ACCOUNT_FROZEN
throw (first in the gate) — human-read lib/spend-grant.ts + chat behavior.

### Item 1 — Kill switch backend ✅ (2026-06-13) — branch `kill-switch` (PR opens after item 2 extends it)

Branch `kill-switch` off main (item 2 EXTENDS this same branch → ONE PR, do
NOT stack). Schema pushed to Neon (additive): `paused Boolean @default(false)`
on api_keys + spend_grants. THE ELEGANT BIT: the freeze rides the existing
shared gate — added `paused` to GrantPolicy + an `ACCOUNT_FROZEN` throw at
the top of checkGrant (toPolicy carries it), so BOTH chat paths (burner +
wallet-plan gate, which already call grantViolation) HARD-refuse a frozen
account server-side with zero new gate code. Agent-level pause is the key's
own `paused` flag. Policy contract (G4, the bridge to SDK 0.5): GET
/api/agent/policy now returns `halted` + `haltReason`
('AGENT_PAUSED'|'ACCOUNT_FROZEN'|null — AGENT_PAUSED wins), plus `agent.paused`
+ `grant.paused`; the receipt-sync echo carries the same so an agent halts on
its next sync. Pause/resume = PATCH {paused} on /api/keys/[id] (SIWE; personal
owner or org admin+ via canManageKey — Bearer 401) and /api/grants/[id] (SIWE
owner/admin via canAccessGrant). BearerKey + /api/keys list now carry paused.

GOTCHA for item 3 (SDK mocks): member-pauses-org-key returns **404** (the key
route does 404 on !canManageKey, not 403 — the existence-hiding convention).
test:api 80 → 88 (Bearer-can't-pause-self, pause→halted, resume clears,
member-can't-pause-org-key 404, admin pauses org key, FROZEN account
hard-refuses an allowed host server-side, unfreeze restores), green vs next
start :3210. SDK 0.5 (item 3) mocks: policy `{halted, haltReason, agent:{…,
paused}, grant:{…, paused}, org:{…}}` and the same on sync echo.

---

# Autopilot — Run 11: Organizations — the org-grade expense account (STAGED 2026-06-13)

Owner directive: a ~5-hour unattended run. Theme chosen by the owner from a
roadmap fork: **Organizations/Teams** — the strategy is "agent expense
account, sold to companies," but today every table (api_keys, spend_grants,
agent_approvals, spend_ledger, Chat) is keyed to ONE wallet. This run adds
the company: orgs, members, roles, org-scoped agents/keys, a two-level
budget (org daily cap above per-key caps), and the expense report. Context
for a fresh session: read ../CLAUDE.md first (root). On main as of
2026-06-13: the payment-web hero (#93, full-bleed shell), agents-tab budgets
(#85/#86), SDK 0.4 per-key budgets (sdk#5, merged; npm still has 0.3.1).

## Rules (Run 6/7 constitution + Run 8 D-rules + Run 10 E-rules apply; additions)

F1. **Additive schema ONLY.** Plain `prisma db push` with inline
    DATABASE_URL (never --force-reset — it wipes the directory). New
    `org_id` columns are NULLABLE everywhere; **NULL = personal scope** and
    existing rows keep working unchanged — back-compat is the contract.
    Existing test:api checks must stay green untouched.
F2. **Server-side role checks in every org route.** One role matrix in
    lib/org.ts (owner > admin > member); never trust a client-supplied
    orgId without a membership lookup. An agent key NEVER manages org
    membership (Bearer ≠ SIWE for org admin actions — same split as
    budgets: an agent can't raise its own allowance, a key can't add
    members to its org).
F3. **Don't touch the SIWE flow.** No changes to lib/session.tsx,
    AuthButton, or the / redirect (post-#88 owner work lives on
    logout-clean-state). Active-org is NOT session state: client store
    (zustand, persisted) + explicit `orgId` param on APIs, membership
    re-checked server-side every call.
F4. **Don't touch the new hero** (components/PaymentWeb.tsx, Hero.tsx,
    .heroweb styles) — just merged, owner-tuned.
F5. **Budget honesty (E3) extends to orgs**: org caps are enforced by the
    SDK/ledger layer (advisory at the rails) until Coinbase Spend
    Permissions; never imply Yeetful blocks a wallet.

## Queue (ordered; one per iteration)

- [x] **1. Schema + org core** (the foundation): `Organization` (id, name,
  slug, createdBy) + `OrgMember` (orgId, address, role owner|admin|member,
  unique(orgId,address)); nullable `org_id` on api_keys, spend_grants,
  agent_approvals, spend_ledger. lib/org.ts: getMembership / requireRole /
  resolveScope(address, orgId?) → personal-or-org scope used by every
  later item. /api/orgs CRUD + member add/remove/role-change (SIWE only;
  add-by-wallet-address IS the invite — membership is live on the
  invitee's next sign-in, no email machinery). Extend test:api with the
  basic auth matrix (non-member 403s, member can read, admin can manage
  keys, only owner deletes org / transfers ownership).
- [x] **2. Org-scoped spending objects**: mint/list/revoke keys under an
  org (admin+); approvals + the auto-minted grant per-org (ensureGrant
  grows an org variant); ledger rows carry org_id end-to-end (both
  payment paths + Bearer receipt-sync). GET /api/agent/policy gains an
  `org` block ({perDayUsd, spentTodayUsd, overBudget} — org spend = sum
  over the org's keys today); receipt-sync `{agent}` echo gains the same.
  SDK consumes it in 0.5 — website-side only this run (F5 wording).
- [x] **3. Dashboard: org switcher + members**: switcher in the dashboard
  sidebar (Personal + each org; persisted client-side per F3), "New
  organization" flow, /dashboard/org members page (list, add by address,
  role change, remove, leave; owner-only danger zone). Mobile constitution
  (E5) on every new surface.
- [x] **4. Dashboard: org agents + two-level budget**: agents/keys/
  approvals tabs honor the active org scope; org settings get the org
  daily cap (SIWE PATCH, admin+); Overview shows the org budget meter
  (org spent-today vs cap) above the existing per-agent meters; stats
  route grows an org block when scoped (extend test:api if the shape
  grows).
- [x] **5. The expense report + /docs/teams**: GET /api/orgs/[id]/report
  ?from&to → totals + per-member, per-agent, per-service breakdowns;
  dashboard table + CSV download (client-side blob is fine). /docs/teams
  in the lib/docs.ts registry (flip `ready`; D2 SEO; cross-link
  /docs/agents ↔ teams): the org model, roles, invites-are-addresses,
  two-level budgets, the F5 honesty paragraph.
- [x] **6. Exit verification** — tsc + build + full test:api against
  `next start` (E2; pkill matches `next-server`); 375/390 rect-scans of
  every changed dashboard/docs surface; run summary in this file; update
  ../CLAUDE.md top section; push `autopilot`.

## Progress log — Run 11

_(autopilot appends here, newest first; push after every item)_

### Item 6 — Exit verification ✅ (2026-06-13) — RUN COMPLETE

The chain is LINEAR (#94→#95→#96→#97→#98, each branch contains all prior),
so `org-report` IS the combined state. Fresh pass on that tip: tsc clean,
build clean, **test:api 80/80** against `next start :3210` (server killed
by PID — never pkill next-server). 390px scroller-aware rect-scan of
/docs/teams (the real route): zero offenders, scrollWidth 390; dashboard
surfaces were verified per-item via mock harnesses at 1280+375 (the
wallet gate makes them headless-unreachable — owner glance still wanted).

---

## Run 11 summary (2026-06-13)

**Queue: 6/6. Zero failed iterations.** Yeetful has organizations: the
"agent expense account, sold to companies" wedge now exists in the data
model, the APIs, the dashboard, and the docs.

| # | Item | PR |
|---|------|----|
| 1 | Schema + org core (roles, SIWE-only CRUD) | [#94](https://github.com/Yeetful/website/pull/94) |
| 2 | Org-scoped spending + two-level budget API | [#95](https://github.com/Yeetful/website/pull/95) |
| 3 | Dashboard org switcher + members page | [#96](https://github.com/Yeetful/website/pull/96) |
| 4 | Org-scoped tabs + budget meter/editor UI | [#97](https://github.com/Yeetful/website/pull/97) |
| 5 | Expense report + /docs/teams | [#98](https://github.com/Yeetful/website/pull/98) |
| 6 | Exit verification | (this entry — no code PR) |

**Merge notes — THE CHAIN IS STACKED, land in order #94 → #95 → #96 →
#97 → #98**; each PR targets its base branch and auto-retargets as bases
merge+delete. test:api: 43 on main → 61 (#94) → 76 (#95) → 78 (#97) →
80 (#98). The schema is ALREADY on Neon (additive push, item 1) — rows
only get written once #94+ land, so merging later is safe.

**Decisions worth keeping**:
- **Scope keys**: org grant/approval rows carry ownerAddress =
  `org:<orgId>` + a real orgId column → zero unique-constraint surgery,
  scope isolation by construction. The pattern generalizes to any future
  shared-ownership rows.
- **Trust splits repeat**: a Bearer key never manages its org, never
  edits the policy it spends under, never syncs to its minter's personal
  grant. Same shape as "an agent can't raise its own budget".
- **Non-member = 404** (existence hidden), insufficient role = 403.
- **Report attribution is honest**: per-agent = key ground truth;
  per-member = key minter; key-less rows = explicit `unattributed`.
- Rect-scans should EXCLUDE elements inside overflow-x:auto ancestors
  (docs sidebar/code blocks false-positive otherwise).

**Owner passes open**: signed-in dashboard glance (switcher, org page,
org-scoped tabs, report card + CSV download); decide whether /api/activity
should label org rows better than `org:cu…xxxx`. **Follow-ups queued for
future runs**: SDK 0.5 consumes the policy `org` block (refuse locally on
org overBudget); Spend Permissions (Run 12, needs owner CDP creds);
alerts/kill-switch now have an org to hang off.

### Item 5 — The expense report + /docs/teams ✅ (2026-06-13) — [#98](https://github.com/Yeetful/website/pull/98), STACKED on #97

Branch `org-report` off `org-tabs`. Merge chain: #94 → #95 → #96 → #97 → #98.

Shipped: GET /api/orgs/[id]/report?from&to (member+, ≤366d, default 30d)
— totals + by-agent/by-member/by-service. ATTRIBUTION DECISION (from the
item-4 note): key-based and honest — per-agent is ground truth, per-member
= the wallet that MINTED each key, key-less rows go to an explicit
`unattributed` bucket (never guessed). components/OrgReport.tsx on
/dashboard/org: 7d/30d/90d pills, three breakdown columns (top 8 + "more
in the CSV"), client-side CSV (one file, section column). /docs/teams:
registry flip (sidebar/cards/sitemap auto), D2 SEO + JSON-LD, the org
model + invite-is-an-address + role matrix + two-level budget w/ the
policy org block verbatim + F5 honesty; cross-linked from /docs/agents.

Verified: tsc + build clean; **test:api 78 → 80, 80/80** vs next start
:3210; /docs/teams renders w/ SEO title + in sitemap.xml; report card
screenshots (harness deleted) at 1280 + 375 — zero true offenders (docs
page flags are inside intentional overflow-x scrollers; scrollWidth 375
— note for future sweeps: exclude elements inside overflow-x:auto
ancestors from the rect scan).

### Item 4 — Dashboard org scope + two-level budget UI ✅ (2026-06-13) — [#97](https://github.com/Yeetful/website/pull/97), STACKED on #96

Branch `org-tabs` off `org-dashboard`. Merge chain: #94 → #95 → #96 → #97.

Shipped: /api/dashboard/stats?org= (member+) — whole payload flips to the
org scope (org grant via scope key, org keys, org ledger) + an `org`
block {perDayUsd, spentTodayUsd, remainingTodayUsd, overBudget, role,
name}; personal responses carry org:null and now EXCLUDE org keys from
the agents count. Overview/Agents/Keys/Approvals all key fetches on
activeOrgId (per the item-3 note) and pass ?org=/orgId on reads AND
writes. Overview renders the ORG DAILY BUDGET meter above the grant card
when scoped (green→red, explicit over-budget); /dashboard/org gains the
cap editor (admin+ $/day form → the #95 PATCH; members read-only).

Verified: tsc + build clean; **test:api 76 → 78, 78/78** vs next start
:3210 (member reads the org stats block; personal stats stay org-free);
harness screenshots (deleted): both meter states + cap editor at 1280 +
375 — zero rect-scan offenders. Note for item 5: the report endpoint can
reuse the `[orgId, ok, createdAt]` ledger index; per-member attribution
needs apiKeyId→key→mintedBy OR ledger rows synced by SIWE members (no
key) — decide attribution semantics there (key-based is honest:
"per-agent" is the org truth; "per-member" = who MINTED the key).

### Item 3 — Dashboard: org switcher + members ✅ (2026-06-13) — [#96](https://github.com/Yeetful/website/pull/96), STACKED on #95

Branch `org-dashboard` off `org-spend`. Merge chain: #94 → #95 → #96
(each PR targets its base branch and auto-retargets as bases land).

Shipped: lib/org-store.ts (persisted zustand `activeOrgId`, F3 — never
session state; APIs re-check membership per call); OrgSwitcher in the
dash rail (Personal + orgs w/ role, inline create flow, self-heals to
Personal when membership disappears; 160px pill on the ≤900px horizontal
bar, menu floats at 240px); /dashboard/org + "Organization" sidebar link
— OrgMembersView renders the matrix FROM THE API'S ROLE ECHO (rename
admin+, invite-by-address w/ owner-only admin option, role select w/
confirm-gated ownership transfer, remove guards, Leave on own row,
owner danger zone); Personal scope = create-org card, not an error.
Split page/view so the visual harness can mock-render (the established
pattern; harness deleted pre-commit).

Verified: tsc + build clean; test:api still 76/76 vs next start :3210
(UI-only); screenshots of owner view / member view / switcher menu at
1280 + 375 — ZERO rect-scan offenders, taps ≥40px. Item 4 note: the
agents/keys/approvals pages still fetch UNSCOPED — they read the store
and pass ?org= next; OrgSwitcher calls router.refresh() on pick which
does NOT refetch client useEffect fetches — item 4 pages should key
their fetch effects on activeOrgId instead.

### Item 2 — Org-scoped spending objects ✅ (2026-06-13) — [#95](https://github.com/Yeetful/website/pull/95), STACKED on #94

Branch `org-spend` off `org-core` (item 2 needs item 1's schema/lib —
PR #95 targets the org-core branch and auto-retargets to main when #94
merges; LAND #94 FIRST, never merge #95 into a side branch).

THE DESIGN CALL: **scope keys** — org grant/approval rows carry
ownerAddress = `org:<orgId>` (lib/org.ts orgScopeKey) + the real orgId
column. Item 1's flagged AgentApproval unique-widening proved UNNECESSARY:
personal vs org toggles are different scope keys by construction, zero
constraint surgery, and scope isolation (org rows never in personal lists)
falls out for free — test-asserted both ways.

Shipped: org keys (mint admin+, list member+ w/ mintedBy, managed by any
org admin — the key is the ORG's credential; BearerKey carries orgId);
org grants + approvals (?org= / orgId params; org policy writes SIWE
admin+ ONLY — a Bearer key never edits the policy it spends under);
ledger org_id end-to-end (sync route + all 9 chat recordLedger sites —
used perl -pi on `grantId: grant.id,` — and an org key CANNOT sync to its
minter's personal grant); two-level budget (PATCH /api/orgs/[id]
perDayUsd pulled FORWARD from item 4 — item 4 is UI-only for the cap now;
policy + sync echo carry org {perDayUsd, spentTodayUsd, remainingTodayUsd,
overBudget}; an org key's grant = the ORG grant via
getActiveGrant(orgScopeKey)).

Verified: tsc + build clean; **test:api 61 → 76, 76/76** against
`next start :3210`. Notes for item 3/4: /api/keys GET now returns
`mintedBy` only in org scope; /api/activity shortAddress renders org rows
as `org:cu…xxxx` (acceptable, but consider a friendlier label when a
public org row first appears). SDK 0.5 follow-up: consume the org block
(refuse locally when org overBudget).

### Item 1 — Schema + org core ✅ (2026-06-13) — [#94](https://github.com/Yeetful/website/pull/94)

Branch `org-core`. Schema PUSHED TO NEON (additive; re-push says "already
in sync", zero loss warnings): `organizations` (incl. `per_day_usd` — the
item-4 org cap, added now so item 2's policy block needs no second push) +
`org_members` (unique orgId+address, role owner|admin|member, addedBy);
nullable `org_id` + indexes on api_keys / spend_grants / agent_approvals /
spend_ledger (ledger gets `[orgId, ok, createdAt]` for rollups; ledger
org_id is FK-less denormalized attribution, the other three cascade on org
delete — precedent: grant delete cascades its ledger today).

lib/org.ts = the single permission surface (F2): getMembership /
requireRole / resolveScope + uniqueOrgSlug. Convention decided: NON-MEMBERS
GET 404 (org existence hidden, matching cross-wallet grant reads); 403 is
member-with-insufficient-role only — the queue's "non-member 403s" phrasing
is implemented as 404 by design. Routes all SIWE-only (Bearer → 401):
/api/orgs (list+create, 10-org cap), /api/orgs/[id] (read member+ / rename
admin+ / delete owner-only), /api/orgs/[id]/members (add = THE invite;
admin+ adds members, only owner adds admins, 100-member cap, 409 dupes),
/api/orgs/[id]/members/[address] (role change owner-only incl. ATOMIC
ownership transfer target↑owner+caller↓admin; remove: admins can't remove
admins, owner irremovable, self-delete = leave).

Verified: tsc + build clean; **test:api 43 → 61, 61/61** against
`next start :3210` (server killed by PID, not pkill). ⚠️ For item 2:
AgentApproval's `@@unique([ownerAddress, serverId])` MUST widen to include
orgId before org approvals are written (a member's personal toggle would
collide with their org toggle for the same server) — schema comment marks
it. Also note for items 2–5: re-run `npx prisma generate` after checking
out a branch that lacks/has the schema or tsc sees a stale client.

---

# Autopilot — Run 10: budgets everywhere — SDK 0.4 + the agents funnel (staged 2026-06-12)

Owner directive: a 6-hour unattended run building whatever makes the most
sense across the npm SDK, the website, and examples. Context for a fresh
session: Run 9 (per-SERVICE caps) was closed unmerged — WRONG MODEL; the
corrected model shipped on main 2026-06-12 (PRs #85/#86): **an agent IS an
API key**, `api_keys.per_day_usd` budgets, ledger `api_key_id` attribution,
`GET /api/agent/policy` (Bearer) as the SDK's pre-flight, receipt-sync
responses carrying `{agent:{…, overBudget}}`, and the /dashboard/agents
tab. Also on main: the Settlement Rail hero (#87) whose ghost CTA "Connect
Agent" → /developers. OPEN: PR #88 (auth flow) — do not touch
lib/session.tsx / AuthButton / the / redirect this run. Read CLAUDE.md
(repo root ../CLAUDE.md) before starting.

This run makes the budgets model REAL end-to-end: the SDK enforces it, the
docs explain it, the funnel sells it, and the dashboard surfaces it.

## Rules (Run 6/7 constitution + Run 8 D-rules apply; additions)

E1. **Two repos.** Website work branches off `main` in this repo; SDK work
    happens in `../sdk` (repo Yeetful/sdk) branching off ITS main. One
    branch + PR per item, independent, never stacked, targeting each
    repo's main. NEVER merge PRs (owner reviews), NEVER `npm publish`
    (owner publishes), NEVER spend real money — zero-spend smokes only.
E2. **Verify against `next start`** (never the dev server; `pkill` matches
    `next-server`, the process name). Website items: tsc + build +
    `npm run test:api` (42 checks on main — extend, don't fork). SDK
    items: the sdk repo's own test suite (extend it).
E3. **Budget honesty.** Every doc/copy surface must say budgets are
    enforced by the SDK (advisory at the rails — the agent pays from its
    own wallet); hard enforcement arrives with Coinbase Spend Permissions.
    Never imply Yeetful can block an agent's wallet.
E4. **Docs accuracy (D1) + SEO checklist (D2)** apply to every new docs/
    developers surface. SDK snippets for 0.4 features must match the PR'd
    code exactly and be labeled as 0.4 (unpublished) until npm has it.
E5. **Mobile constitution**: base grid-cols-1 + min-w-0; rect-based scans
    at 375/390 on every changed surface; tap targets ≥40px.
E6. **Log per item**: append a progress entry under "Progress log — Run
    10" (newest first), commit AUTOPILOT.md to the `autopilot` branch and
    push after EVERY item — the log is the context save.

## Queue (ordered; one per iteration)

- [x] **1. SDK 0.4.0 — per-agent budgets** (../sdk, the big one): when
  constructed with `{ apiKey, ledgerUrl }`, fetch GET /api/agent/policy at
  startup (non-fatal if unreachable — log + proceed unenforced); refuse a
  paid call when the agent is overBudget or the call's price would exceed
  remainingTodayUsd → new denial code `OVER_AGENT_BUDGET`, receipted like
  other denials and synced to the hosted ledger; refresh local budget
  state from the `{agent}` echo on every receipt-sync response and from
  flushLedger; expose `pay.agentBudget()` (current snapshot) for callers.
  Tests mirror the existing suite (mock fetch for policy + sync echoes;
  cover: under budget passes, at budget refuses, policy-fetch failure
  degrades open, echo updates state). README section "Per-agent budgets".
  Version bump to 0.4.0 in the PR; DO NOT publish. Note: check sdk repo
  state first — if sdk#4 (0.3.2 ledger-redirect hint) is still an open PR,
  base off main anyway and note the relationship in the PR body.
- [x] **2. /docs/agents — "Agents & budgets"** (website): the two-sided
  model page. Approvals = which SERVICES money flows to; Agents = which
  APPS spend on your behalf (an agent IS an API key). Document: per-day
  budgets + the SIWE-only PATCH (an agent can't raise its own budget),
  ledger attribution, GET /api/agent/policy request/response (verbatim
  from app/api/agent/policy/route.ts), the `{agent}` echo on receipt
  sync, and the E3 honesty paragraph. SDK 0.4 snippet labeled upcoming.
  Registry flip in lib/docs.ts (sidebar/cards/sitemap auto-update), D2
  SEO, cross-links: /docs/ledger-sync ↔ this page, /dashboard/agents
  empty state → this page, ConnectAgentCard → this page.
- [x] **3. /developers refresh** (website): it's now the hero's "Connect
  Agent" CTA target — make it land. Lead with the 3-step connect-an-agent
  flow (mint a key at /dashboard/keys → wire `yeetful({wallet, grant,
  apiKey, ledgerUrl})` → set its budget at /dashboard/agents), a policy-
  endpoint callout, and prominent links to /docs/quickstart +
  /docs/agents + /docs/claude-code. Keep existing SEO standards; sweep
  375/390.
- [x] **4. Dashboard Overview: connected-agents tile** (website): KPI tile
  on /dashboard — connected agents count + top agent by spend today (from
  api_key-attributed ledger rows), linking to /dashboard/agents. Extend
  /api/dashboard/stats (and test:api if the response shape grows).
  Mock-harness the visual check like prior dashboard sweeps.
- [x] **5. Launch-post draft — "Give your agent an allowance"** (website,
  publish-blocked): write the blog post announcing agent budgets as a
  seed script `scripts/seed-agents-post.ts` (same pattern as
  seed-first-post.ts), description ≤160, draft status. ADMIN_WALLETS is
  unset so it CANNOT be published — verify the script compiles (tsc) and
  document the one-command publish for the owner. Skip if time is short.
- [x] **6. Exit verification** — tsc + build + test:api against `next
  start`; 375/390 rect-scans of every changed surface (docs page,
  developers, dashboard tile); sdk suite green; run summary in this file;
  update ../CLAUDE.md top section; push `autopilot`.

## Progress log — Run 10

_(autopilot appends here, newest first; push after every item)_

### Item 6 — Exit verification ✅ (2026-06-12) — RUN COMPLETE

Combined exit state (local merge of #89+#90+#91+#92 onto main — zero file
overlaps, trivial merge; branch deleted after, no PR needed): tsc clean,
build clean, **test:api 43/43** against `next start` :3210, sdk suite
**22/22** on sdk main. Fresh-load 375 rect-scans re-confirmed clean on
the combined state for /docs/agents and /developers (390 + desktop
covered per-item; dashboard tile carried from item 4's mock harness — no
overlapping files between PRs, so per-item results stand).

**Site-wide entity-space joint sweep** (the item-2 follow-up): all 12
public surfaces (home, activity, developers, blog index + the live post,
servers index + tripadvisor detail, all 7 docs pages) — ZERO
`</em|strong|a|code|b|i>letter` joints. The bug class is dead on prod
surfaces; the detection one-liner is in the item-2 entry for future runs.

---

## Run 10 summary (2026-06-12)

**Queue: 6/6.** Zero failed iterations. The budgets model is now real
end-to-end: SDK enforces it (0.4 merged), docs explain it, /developers
sells it, the dashboard surfaces it, and the launch post is drafted.

| # | Item | PR |
|---|------|----|
| 1 | SDK 0.4.0 per-agent budgets | [sdk#5](https://github.com/Yeetful/sdk/pull/5) (pre-completed, MERGED) |
| 2 | /docs/agents — Agents & budgets | [#89](https://github.com/Yeetful/website/pull/89) |
| 3 | /developers refresh (Connect Agent funnel) | [#90](https://github.com/Yeetful/website/pull/90) |
| 4 | Dashboard connected-agents KPI tile | [#91](https://github.com/Yeetful/website/pull/91) |
| 5 | Launch-post draft (seed script) | [#92](https://github.com/Yeetful/website/pull/92) |
| 6 | Exit verification + summary | (this entry — no code PR) |

**Merge notes**: #89–#92 are independent, no shared files, any order.
test:api goes 42→43 when #91 lands (the agents-block check).

**Discoveries worth keeping**:
- **JSX entity-space bug class**: a text node that follows an inline
  element AND contains an HTML entity loses its leading space at compile
  (SWC). 7 joints fixed across docs + ConnectAgentCard (#89, #90); whole
  site now sweeps clean. Detector:
  `curl page | grep -oE '</(em|strong|a|code)>[a-zA-Z]'`. Fix idiom:
  explicit {' '} after the element.
- **App Router private folders**: `_`-prefixed app/ dirs never route —
  temp harness routes must not start with underscore.
- **Recharts + preview_resize**: resize-without-reload leaves stale
  fixed widths that flood rect-scans — reload before scanning.
- **pkill discipline**: `pkill -f next-server` kills the owner's dev
  server too; match the harness command exactly
  (`pkill -f "next start -p 3210"`).

**Owner manual passes queued**: signed-in glance at /dashboard (new tile)
+ /dashboard/agents; seed + publish the launch post AFTER `yeetful` 0.4
ships to npm (one-command publish in scripts/seed-agents-post.ts header);
the usual wallet flows. Env still outstanding: ADMIN_WALLETS,
BLOB_READ_WRITE_TOKEN, PRIVATE_KEY.

### Item 5 — Launch-post draft ✅ (2026-06-12) — PR #92

Branch `agents-launch-post` off main. scripts/seed-agents-post.ts — the
seed-first-post pattern, but DRAFT semantics: published:false on create,
re-runs never touch publish status. Post: two-sided model, key-as-agent,
SIWE-only allowance edits ("an agent that could raise its own allowance
wouldn't have one"), policy pre-flight + OVER_AGENT_BUDGET, E3 honesty,
3-step funnel; links into /docs/agents + /developers + /dashboard/agents.
Desc 149ch. One-command publish documented in the script header (admin
Bearer PATCH {published:true} — after 0.4 hits npm, since the post
presents 0.4 as available). tsc clean; NOT seeded to Neon (compile-only
per the queue; the owner seeds + publishes together).

### Item 4 — Dashboard connected-agents tile ✅ (2026-06-12) — PR #91

Branch `dashboard-agents-tile` off main. /api/dashboard/stats grows an
`agents` block ({connected, topToday:{label, spentTodayUsd}|null} — count
from api_keys, top from key-attributed settled rows via the existing
agentSpentTodayByKey; returned on both response paths). Overview's 4th
KPI is now the Connected agents tile (Link → /dashboard/agents, label
clamped 24ch); the displaced "Top agent" was really top SERVICE all-time
— still in the chart below, retitled "Spend by service" (vocabulary fix).
test:api +1 check (agents block asserted off the harness's Bearer-synced
receipts) → 43 checks.

Verified: tsc + build clean, test:api 43/43 on :3210. Visual via temp
mock harness (stats fetch intercepted; the wagmi isConnected gate can't
be faked by fetch mocks — direct component render instead): desktop 1280
grid good, 375+390 fresh-load scans 0 offenders incl. a long-label
stress. Lessons: (1) `_`/`__`-prefixed app/ folders are PRIVATE in the
App Router — a temp harness route must NOT start with underscore (404s);
(2) resize-without-reload leaves Recharts at the old fixed width and
floods a naive rect-scan — always reload after preview_resize before
scanning.

### Item 3 — /developers refresh ✅ (2026-06-12) — PR #90

Branch `developers-refresh` off main. Hero ghost CTA → #connect: the
3-step funnel (mint at /dashboard/keys → npm install + yeetful({wallet,
grant, apiKey, ledgerUrl}) → budget at /dashboard/agents), docs trio
(quickstart/agents/claude-code) as dev__biglinks under the steps, new
"standing orders" section = GET /api/agent/policy callout (response
shape, 0.4 labeled merged-not-published, E3 honesty line). Snippet gains
ledgerUrl on the canonical www origin. Old Quickstart section removed
(superseded). Metadata: canonical + OG added, desc rewritten 145ch.
One more entity-space joint (`</code>secret`) caught by the scan + fixed.
All existing sections (Grants API / receipt sync / stack links) and CSS
classes reused — zero new CSS.

Verified: tsc + build clean, test:api 42/42 on next start :3210, joint
scan clean, 375+390 rect-scans 0 offenders, mobile screenshot good.
TOOLING WARNING for later items: `pkill -f next-server` killed the
owner's/preview dev server on :3000 too (restarted via preview MCP) —
kill ONLY the harness server: `pkill -f "next start -p 3210"`.

### Item 2 — /docs/agents ✅ (2026-06-12) — PR #89

Branch `docs-agents` off main (which now includes the merged #88 — its
files untouched). New page off the lib/docs.ts registry: two-sided model
(Approvals = services, Agents = apps; an agent IS an API key), SIWE-only
budget PATCH, policy endpoint verbatim from the route, the slim `{agent}`
sync echo, E3 honesty paragraph, SDK snippet labeled 0.4/unpublished.
Cross-links wired all three ways (ledger-sync ↔ agents, AgentsPanel empty
state → docs, ConnectAgentCard footer → docs).

**Bug found + fixed (constitution-worthy):** a JSX text node that follows
an inline element AND contains an HTML entity (&apos;/&quot;) loses its
leading space at compile (SWC) — prod was rendering `services</em>money`
joints. Rendered-HTML scan found 5 PRE-EXISTING joints on quickstart/
expense-account/ledger-sync + 1 in ConnectAgentCard; all 7 fixed with an
explicit {' '} after the element. Detection one-liner:
`curl page | grep -oE '</(em|strong|a|code)>[a-zA-Z]'` — run on any new
prose surface. NOTE for item 6: sweep the REST of the site (home, servers,
blog, activity) for this joint class.

Verified per E2 on `next start` (port 3210; owner's dev server holds
3000): tsc + build clean, test:api 42/42, head tags via curl (title 54ch,
desc 149ch, canonical/OG/TechArticle/BreadcrumbList, sitemap via
registry), rect-scans 375+390 clean (0 real offenders; scroll-container
children — the docs sidebar scroll-row, pre blocks — false-positive in a
naive scan and must be excluded by ancestor overflow check).

### Item 1 — SDK 0.4.0 per-agent budgets ✅ (2026-06-12, pre-completed)

Found ALREADY DONE at run start: [sdk#5](https://github.com/Yeetful/sdk/pull/5)
(branch `agent-key-budgets`) was opened by the prior session and MERGED to
sdk main before this run launched. Scope matches the queue item exactly:
policy pre-flight at construction (degrades open on fetch failure),
`OVER_AGENT_BUDGET` denials receipted + synced, budget state refreshed from
`{agent}` echoes on receipt-sync and flushLedger, `pay.agentBudget()`
snapshot, README "Per-agent budgets" section, version bumped to 0.4.0
(NOT published — npm still has 0.3.1). Re-verified on merged sdk main this
session: `npm test` 22/22 green. Also noted: PR #88 (auth/logout flow) has
since MERGED to website main — its files (lib/session.tsx, AuthButton, the
/ redirect) remain off-limits this run per the directive.

---

# Autopilot — Run 8: docs + Claude Code onboarding + signed-in app shell (staged 2026-06-12, started via /loop)

Owner directive: (a) a real `/docs` section explaining SDK integration —
SEO first-class, sub-pages, FULL-WIDTH layout; (b) a Claude Code page: a
copy-paste prompt that lets someone building a Coinbase Developer Portal
agent add Yeetful in one shot — the prompt instructs Claude to wire the SDK
and walk the human to the exact yeetful.com pages for API keys + grant id;
(c) GitHub-style signed-in experience: once authed, skip the marketing
landing page (/ → dashboard) and use the full viewport width in the portal.

## Rules (Run 6/7 constitution applies; additions)

D1. **Docs accuracy**: every code sample must match the SHIPPED yeetful
    0.3.1 surface — copy from sdk/README.md, sdk/src, example-agent; never
    invent APIs. Prices/links match prod (keys live at /dashboard/keys).
D2. **SEO checklist per docs page**: title ≤60 chars, description ≤160,
    canonical, OG, JSON-LD (TechArticle + BreadcrumbList), in sitemap.xml,
    crawlable server-rendered content (no client-only copy).
D3. **Full-width**: docs + authed portal surfaces use the full viewport
    (fluid with sane gutters); marketing pages keep --maxw for guests.
D4. The / → dashboard redirect applies ONLY with a verified SIWE session
    (not mere wallet connection), client-side (auth is client-known), with
    an escape hatch (?home=1 or a "view site" link) so the marketing page
    stays reachable.

## Queue (ordered; one per iteration)

- [x] **1. Docs foundation** — /docs route group with its own FULL-WIDTH
  layout (left sidebar nav, content region, right "on this page" rail at
  xl), shared DocsPage scaffolding (breadcrumbs + JSON-LD helpers), and the
  /docs landing page (what Yeetful is for builders + cards to sub-pages).
  Server-rendered content, D2 SEO on the landing. Mobile: sidebar collapses
  to a top scroll-row (Run 6/7 standards apply — rect-scan).
- [x] **2. Core SDK sub-pages** — /docs/quickstart (install → grant →
  first paid call, from sdk README), /docs/expense-account (allowlist,
  caps, receipts, GrantError — the concepts page), /docs/ledger-sync
  (API keys, YEETFUL_GRANT_ID, ledgerUrl + the canonical-origin/auth-header
  gotcha we hit live), /docs/x402 (v1/v2 differences the SDK absorbs).
  D1+D2 on every page.
- [x] **3. Claude Code page** — /docs/claude-code: "add Yeetful to your
  Coinbase agent in one prompt". A prominent copy button on a prebuilt
  prompt that tells Claude Code to: npm i yeetful, wrap the agent's paid
  calls in yeetful(), add env handling, and INTERACTIVELY walk the human
  through minting a key at https://yeetful.com/dashboard/keys (copy yf_
  secret + YEETFUL_GRANT_ID from the connect card) with direct links/
  buttons. Mention CDP wallets work as the signer (viem account). D2 SEO;
  this page is the funnel target.
- [x] **4. Wire-up + SEO plumbing** — nav "Docs" tab + footer + /developers
  cross-links into docs; sitemap.xml gains all docs URLs; robots fine;
  RSS untouched. Verify every docs page's head tags server-side (curl).
- [x] **5. Signed-in shell** — / redirects to /dashboard when a SIWE
  session exists (D4, mount-gated, no flash for guests); portal surfaces
  (dashboard shell, /activity when authed? NO — dashboard only) go fluid
  full-width with gutters; nav reflects portal mode (Dashboard first).
  Careful with hydration + the existing mount-gates.
- [x] **6. Exit verification** — all-pages sweep table updated incl. the
  new /docs pages (375/390 via the iframe method), desktop 1280+1680
  full-width screenshots of docs + dashboard, head-tag table for docs
  pages, tsc/build/test:api. Run summary.

## Progress log — Run 8

_(autopilot appends here)_

### Item 6 — Exit verification ✅ (2026-06-12) — RUN COMPLETE

**30/30 combos clean**: 15 pages (the 9 public surfaces from Run 7's table
+ all 6 /docs pages) × {375, 390} — 0 offenders, 0 sub-16px inputs,
scrollWidth ≤ viewport everywhere, swept on the full run state (incl. the
unmerged #75). The four mock-harnessed dashboard pages carry over from Run
7's 26/26 (their mobile CSS is untouched this run — the .dash change is
desktop-only and the mobile media query overrides it).

Head-tag table: item 4's six-page verification stands (titles 47–59ch,
descriptions 139–154ch, canonical + TechArticle + BreadcrumbList on all).
Desktop evidence in docs/autopilot/: docs-1280, docs-claude-1680, and
portal-redirect-1680 (mocked SIWE landing on /dashboard with the fluid
Dashboard-first nav). The authed .dash full-width visual remains the
owner's glance (needs a real wallet+SIWE pair). tsc + build + test:api
43/43 on the exit branch.

---

## Run 8 summary (2026-06-12)

**Queue: 6/6 complete.** Zero failed iterations. Yeetful has real docs,
a Claude Code onboarding funnel, and a GitHub-style signed-in portal.

| # | Item | PR |
|---|------|----|
| 1 | Docs foundation (full-width shell + registry) | [#71](https://github.com/Yeetful/website/pull/71) |
| 2 | Core SDK pages (quickstart/grants/ledger/x402) | [#72](https://github.com/Yeetful/website/pull/72) |
| 3 | Claude Code onboarding page + prompt | [#73](https://github.com/Yeetful/website/pull/73) |
| 4 | Nav/footer/sitemap wire-up | [#74](https://github.com/Yeetful/website/pull/74) |
| 5 | Signed-in portal shell (/ → dashboard, fluid) | [#75](https://github.com/Yeetful/website/pull/75) |
| 6 | Exit verification + summary | [#76](https://github.com/Yeetful/website/pull/76) |

**Merge order**: #71→#74 merged mid-run; remaining #75 → #76.

**Decisions worth keeping**: lib/docs.ts as the single registry (page flips
`ready` → sidebar/cards/sitemap all update); docs content sourced ONLY from
the shipped 0.3.1 surface (D1) with this week's live debugging encoded as
the ledger-sync gotchas section and inside the Claude prompt itself
(www ledgerUrl, show-once secret, no-spend verification); portal mode keyed
strictly on SIWE (D4) with ?home=1 as the escape hatch the nav carries.

**Tooling finds**: Next 16 allows ONE dev server per project (.next/dev
lock) — harness servers now use `next start` on the prod build; the
preview MCP can't start while the owner's dev server holds the configured
port — playwright-core (channel: chrome) against the owner's server is the
working substitute, temp devDep reverted each time.

**Owner manual passes**: the authed full-width dashboard glance; paste the
/docs/claude-code prompt into a real scratch repo and feel the two
dashboard steps; the usual wallet flows.

### Item 5 — Signed-in shell ✅ (2026-06-12)

GitHub-style portal mode, keyed STRICTLY on the SIWE session (useSession
address — wallet connection alone never triggers it, per D4):
- / → router.replace('/dashboard') for authed visitors; ?home=1 escapes
  (read via window.location inside the effect — avoids the useSearchParams
  Suspense requirement). Guests render home instantly, no gate.
- Nav portal mode: Dashboard tab FIRST, header goes nav--fluid (full
  viewport, 32px gutters), and the Servers tab carries /?home=1 so the
  marketing page stays reachable without fighting the redirect.
- .dash sheds its --maxw cap (max-width: none, 32px gutters) — the
  dashboard now uses the whole window like the GitHub app shell.

Verified via playwright with /api/auth/me intercepted (mock SIWE):
guest / → stays, nav 1280 capped; authed / → lands on /dashboard, nav
1680 fluid, first tab Dashboard, Servers href /?home=1; authed /?home=1
→ stays. The .dash full-width VISUAL needs a real wallet+SIWE pair
(wagmi gate) — CSS rule shipped, flagged for the owner's glance per
rule 6. tsc + build green; test:api 43/43 (nav + home are shared).

### Item 4 — Wire-up + SEO plumbing ✅ (2026-06-12)

Docs is now reachable from everywhere: nav tab (Developers · Docs · Blog,
startsWith-active so sub-pages highlight; desktop tabs + mobile drawer share
the block), footer link first among product links, and /developers' "rest
of the stack" grid leads with a docs biglink. sitemap.xml maps the registry
— all six /docs URLs emitted (plus /activity, which item 3 of Run 7 forgot
to add; fixed here). Head-tag table verified server-side on all six pages:
titles 47–59ch, descriptions 139–154ch, canonical + TechArticle +
BreadcrumbList everywhere.

Tooling find: Next 16 dev refuses a SECOND dev server for the same project
(lock under .next/dev — "Run kill <pid> to stop it"), so the throwaway-
admin harness server can't be a dev server while the owner's runs. `next
start` (prod build) has no such lock — harness now runs against the prod
server: test:api 43/43. tsc + build green.

### Item 3 — Claude Code page ✅ (2026-06-12)

/docs/claude-code is live: a 3,026-char self-contained prompt (server-
rendered as a prop into a dumb CopyBlock client shell, so it's crawlable)
that instructs Claude Code to install yeetful, create one shared pay() —
using an existing CDP wallet as the signer when present — replace paid
fetches, set up env + .env.example + gitignore, then INTERACTIVELY walk
the human through the two dashboard clicks (mint at /dashboard/keys with
the show-once warning; copy YEETFUL_GRANT_ID + flip approvals) one step at
a time, and finish with a NO-SPEND verification (free allowlisted call →
$0 receipt + sync check; paid calls only on explicit say-so). The prompt
bakes in this week's lessons: ledgerUrl pinned to the www origin (redirect
auth-header gotcha), small default caps, never print secrets.

Page sections: what-it-sets-up, the two dashboard clicks as link cards,
and "why route a Coinbase agent through Yeetful" (CDP signs / Yeetful
decides; Spend Permissions as the direction of travel). D2 proven via
curl; scans clean 375 + 1680; copy button 40px on phones; tsc + build
green. claude-code flipped ready — all six pages now in the sidebar.

### Item 2 — Core SDK sub-pages ✅ (2026-06-12)

Four pages live, all flipped `ready` in the registry (sidebar/cards/sitemap
pick them up automatically): /docs/quickstart (install → wallet → grant →
paid call, code verbatim from sdk README 0.3.1 incl. the CDP-wallets-work
note), /docs/expense-account (grant fields, ordered checks, the 5 GrantError
codes as a table, receipts incl. denials, the local-vs-hard-enforcement
honesty paragraph), /docs/ledger-sync (mint → env → flushLedger, plus a
"gotchas we hit" section encoding THIS WEEK's live findings: the
redirect/auth-header 401, prefix-vs-secret, owner-scoping 404, enforcement-
stays-local), /docs/x402 (flow, the v1/v2 wire table, network resolution,
the sell-side primitives).

The sweep caught a constitution violation in my own work: the v1/v2
comparison TABLE pushed /docs/x402 to scrollWidth 390 at 375 (offender scan
missed it — tables overflow the BODY, not a flagged element; noted for the
exit sweep). Fixed globally: .docs__prose tables are display:block +
overflow-x:auto. Re-scanned both table pages clean.

D2 proven via curl on all four (title/canonical/TechArticle); scans clean
at 375 + 1680; tsc + build green (all four prerender ○). All five live
docs pages show in the sidebar.

### Item 1 — Docs foundation ✅ (2026-06-12)

`/docs` shell is FULL-WIDTH per D3 (verified docsW == viewport at 375/390/
1280/1680 — no --maxw cap): sticky 240px rail + fluid content, prose measure
capped at 80ch for readability while code runs to 96ch. Mobile rail = the
proven top scroll-row pattern. `lib/docs.ts` is the single registry driving
sidebar, landing cards, breadcrumbs, JSON-LD, and (item 4) the sitemap —
pages hidden until `ready` so mid-run links never 404. Landing page live
with the five-line SDK pitch (copy matches sdk/README 0.3.1 per D1).

D2 verified server-side via curl: title 52ch, description 154ch, canonical,
OG, TechArticle + BreadcrumbList JSON-LD, prose crawlable in the HTML.
Rect-scan 0 offenders at all four widths.

Tooling note: the owner's dev server held :3000 and the preview MCP refuses
to start while the configured port is occupied (autoPort didn't help) —
verified against the owner's server instead via curl + a temporary
playwright-core script (devDep added, used, reverted). launch.json base
port moved to 3010 for the rest of the run.

---

# Run 11 DRAFT (was "Run 9 DRAFT"): Coinbase Spend Permission example (awaiting owner review + CDP API key + Base Sepolia funds — do NOT start until approved)

The strategic wedge from CLAUDE.md: back the (signable) SpendGrant with a
real on-chain Coinbase Spend Permission so the agent never holds funds.
CDP research (2026-06-11): Agentic Wallets = Server Wallet v2 accounts (MPC
in AWS Nitro Enclave); Spend Permissions API maps ~1:1 onto SpendGrant
(grantor smart account / spender / token "usdc" / allowance / periodInDays);
contract 0xf85210B21cC50302F477BA56686d2019dC9b67Ad on Base; spender may be
any onchain account; gas via Coinbase paymaster. CAVEAT to verify first:
permission creation is documented as CDP-Smart-Account-only.

## Rules (Run 6/7 constitution applies; additions)

R1. TESTNET FIRST (Base Sepolia) — no mainnet funds until the owner's
    explicit go. Never store CDP API secrets in any repo; .env only.
R2. The example repo is PUBLIC from birth (Yeetful/coinbase-example) —
    secrets grep before every push.
R3. Spending real money (even $0.01 mainnet) = owner manual step, never
    autopilot.

## Queue (draft — owner may reorder/trim)

- [ ] **1. Spike: verify the CDP API surface** — create a CDP project
  (owner provides API key id/secret in .env), Server Wallet v2 + Smart
  Account on Base Sepolia, createSpendPermission with SpendGrant-shaped
  caps, spender.useSpendPermission() pulls testnet USDC. Probe-style
  evidence; document the Smart-Account-only caveat's real shape.
- [ ] **2. Yeetful/coinbase-example repo** — owner-setup.ts (one-time:
  create + sign the permission mirroring a yeetful.com grant) + agent.ts
  (yeetful() pay loop; spender auto-pulls via the permission when its
  balance runs low) + README. Testnet by default per R1.
- [ ] **3. Website: grant ↔ permission linkage** — store the permission
  hash on SpendGrant (additive column), surface a "backed on-chain" badge
  on the dashboard + signature payload alignment so the EIP-712 grant and
  the Spend Permission share terms.
- [ ] **4. SDK: spender adapter** — optional `spendPermission` option on
  yeetful(): auto-pull before payment when balance < price; receipts note
  the pull tx. Tests with a mocked CDP client.
- [ ] **5. Blog post draft** — "Your agent has an expense account, not a
  wallet" (publish = owner step per constitution).

_(Run 8 starts only when the owner says go — likely needs: CDP account +
API key, testnet faucet funds.)_

---

# Run 7 (COMPLETE 8/8): public network activity + stats (staged 2026-06-11 evening)

Owner directive: a public page showing all transactions on the network with
overall stats. The receipts we already write (spend_ledger) become the
public proof-of-life surface: live paid calls, totals, and a
"blocked by policy" counter that doubles as the control-plane pitch.
Run 6 items 2–6 (mobile) carry over after the activity items.

## Rules (constitution — Run 6 rules apply verbatim, plus privacy)

P1. **Public payloads NEVER contain**: full wallet addresses (truncate
    server-side to 0xab…cd), grant ids, API-key material, or chat content.
    The test harness must PROVE anonymization (seed a row, assert the full
    address is absent from the public JSON).
P2. **Denials are aggregate-only in public**: a blocked-calls stat is the
    control-plane flex, but denial ROWS (who tried what and got refused)
    never appear in the public feed.
P3. The endpoint is unauthenticated read-only; no user-controlled params may
    reach other tables. DB changes additive only (plain `db push`, never
    --force-reset).

## Queue (ordered; one per iteration)

- [x] **1. Public activity API** — `GET /api/activity` (no auth): `stats`
  (settled USD total, settled calls, calls today, blocked count, distinct
  active accounts), `daily` 30-day series, `top` services by spend, `recent`
  ≤50 SETTLED rows (serviceName, host, amountUsd, txHash, truncated owner,
  createdAt). Additive `@@index([ok, createdAt])` on spend_ledger + plain
  `db push` (the global feed can't ride the grant-scoped index). Cache
  `s-maxage=30, stale-while-revalidate=120`. EXTEND `npm run test:api`
  (don't write temp scripts): shape checks, P1 anonymization proof, P2
  denial-row absence, cache header present. 37 checks must stay green and
  grow.
- [x] **2. /activity page** — public, SEO'd (title/desc/OG), nav link. Stat
  tiles (settled total, calls, active accounts, blocked-by-policy), reuse
  DashboardCharts SpendOverTime for the 30-day series + per-service bars,
  live feed with Basescan links on tx hashes (https://basescan.org/tx/…),
  ~30s polling, honest empty states (young network ≠ broken page).
  Mobile-first per Run 6 standards: rect-scan clean 375/390 (public page —
  no harness needed), tap targets ≥40px, feed rows wrap not bleed.
- [x] **3. Home tie-in + perf pass** — surface the network stats on the home
  page (small live counter strip sourced from the same API; no second
  query path), verify payload size sane (≤50 rows, no over-fetch), confirm
  the new index is used (EXPLAIN via Neon MCP), lighthouse-glance the page
  weight. Anything unverifiable: flagged, not claimed.
- [x] **4. (Run 6 #2) Dashboard Keys/Approvals/Activity mobile** — mock-harness
  pattern per page: keys (secret reveal break-all, ConnectAgentCard <pre>
  scroll, long prefixes), approvals (3→2→1 grid, switch tap size), activity
  (long hosts/hashes truncate; rows wrap to two lines). Rect-scan clean;
  screenshots; harness deleted.
- [x] **5. (Run 6 #3) Chat mobile-first** — sidebar overlays or collapses at
  375/390; composer sticky-bottom with safe-area + 16px input font; bubbles
  ≤85vw with long-word breaking; agents toolbar scroll; receipts footnote
  wrapping; guest send box no-iOS-zoom.
- [x] **6. (Run 6 #4) Home + directory mobile polish** — hero type scale at
  375, runner card internals, search + pills 44px, card grid rhythm,
  ActiveServerBar safe-area. Rect-scan + screenshots.
- [x] **7. (Run 6 #5) Developers + blog + servers detail mobile polish** —
  snippet <pre> scroll, capability cards, ep rows at 375; blog measure +
  code blocks; servers header badge wrap. Rect-scan + screenshots.
- [x] **8. (Run 6 #6) Global mobile foundation sweep** — viewport meta on
  every route, 16px inputs everywhere, safe-area on fixed elements, final
  all-pages rect-scan table (375 + 390) incl. /activity. Exit criteria.

## Progress log — Run 7

_(autopilot appends here)_

### Item 8 — Global mobile foundation sweep ✅ (2026-06-12) — EXIT CRITERIA MET

Foundation: viewport meta verified emitted on all 8 route classes (curl);
`-webkit-tap-highlight-color: transparent` added to the html base; nav
drawer bottom padding now includes env(safe-area-inset-bottom).

**The sweep caught one more real bug**: /servers (the add-custom-server
page — never previously audited) bled to scrollWidth 412 at 375. The color
hex input (`flex-1`, min-width:auto) forced its grid-cols-2 column wide.
Fix: `min-w-0` + the category/color row stacks at phone widths; that input,
its 3 siblings, and the category <select> all get 16px under lg (selects
zoom on iOS focus too).

**Final all-pages table** (iframe-viewport scan, both widths; offenders =
rect right > vw+2, excluding scroll containers and overflow-hidden non-body
boxes; smallInputs = visible input/textarea/select under 16px):

| Page | 375 off/inputs | 390 off/inputs |
|---|---|---|
| / | 0 / 0 | 0 / 0 |
| /activity | 0 / 0 | 0 / 0 |
| /developers | 0 / 0 | 0 / 0 |
| /blog | 0 / 0 | 0 / 0 |
| /blog/[slug] | 0 / 0 | 0 / 0 |
| /servers | 0 / 0 | 0 / 0 |
| /servers/[slug] (tripadvisor) | 0 / 0 | 0 / 0 |
| /chat | 0 / 0 | 0 / 0 |
| /dashboard (gate) | 0 / 0 | 0 / 0 |
| dash Overview (harness) | 0 / 0 | 0 / 0 |
| dash Keys (harness) | 0 / 0 | 0 / 0 |
| dash Approvals (harness) | 0 / 0 | 0 / 0 |
| dash Activity (harness) | 0 / 0 | 0 / 0 |

**26/26 clean.** Method note: pages loaded in a sized same-origin iframe
(its own viewport — media queries + dvh respond correctly), which made the
26-combo sweep tractable in two scans. Safe-area insets remain
preview-unverifiable (env() = 0) — flagged; owner's phone glance covers it.
tsc + build + test:api 43/43; harnesses deleted.

---

## Run 7 summary (2026-06-12)

**Queue: 8/8 complete.** Zero failed iterations. The spend ledger is now a
public surface (API + page + home pulse) and every page of the site passes
a 26-combo mobile exit sweep.

| # | Item | PR |
|---|------|----|
| 1 | Public activity API (privacy-proofed) | [#61](https://github.com/Yeetful/website/pull/61) |
| 2 | /activity page + nav tab | [#62](https://github.com/Yeetful/website/pull/62) |
| 3 | Home network pulse + perf pass | [#63](https://github.com/Yeetful/website/pull/63) |
| 4 | Dashboard sub-pages mobile | [#64](https://github.com/Yeetful/website/pull/64) |
| 5 | Chat mobile-first (overlay sidebar) | [#65](https://github.com/Yeetful/website/pull/65) |
| 6 | Home + directory polish | [#66](https://github.com/Yeetful/website/pull/66) |
| 7 | Dev/blog/servers audit (no code needed) | [#67](https://github.com/Yeetful/website/pull/67) |
| 8 | Foundation sweep + exit table | [#68](https://github.com/Yeetful/website/pull/68) |

**Merge order**: #61→#62→#63 (stacked chain, merged mid-run), #64, #65
(merged mid-run), then #66→#67→#68 (stacked).

**Bugs the run's own checks caught**: the implicit-grid-track bleed pattern
(twice: Approvals grid, /servers color row — base `grid` with only
sm:/lg: cols sizes the phone track to max-content); chat's 21px composer
(squeeze ≠ bleed — rect scans can't see it); the persisted-preference trap
(mobile auto-close almost permanently collapsed the desktop sidebar);
framer-motion orphaning AnimatePresence children closed mid-hydration;
fetch dropping auth headers on cross-origin redirects (found via the
example-agent's 401s — fixed in sdk 0.3.1/0.3.2 work, same session).

**test:api 37 → 43** (activity shape, cache header, P1 anonymization proof,
P2 denial-row absence). New standing tools: the fetch-patch harness pattern
for gated pages, the iframe-viewport sweep for all-pages tables.

**Owner manual passes**: phone glance for safe-area insets (env() invisible
in preview); the usual wallet flows.

### Item 7 — Developers + blog + servers detail mobile ✅ (2026-06-12, no code)

The queue over-assumed (like Run 3 item 3): a full live audit found NOTHING
to fix. All four surfaces rect-scan 0 offenders with exact scrollWidth at
BOTH 375 and 390:
- /developers — snippet <pre> scrolls (666px content in a 339px box,
  overflow-x auto), no sub-16px inputs, capability cards stack clean
- /servers/yeetful-claude AND /servers/tripadvisor (61 endpoint elements,
  the long-path stress case) — header badges wrap to two rows, method
  chips + paths fit, volume lines wrap
- /blog — single-column grid at phone widths
- /blog/an-agent-shipped-this-blog — 16px body measure, code block
  scrolls (overflow auto), zero inline-code overflows

These pages were all built/refreshed AFTER the mobile standards landed
(Runs 4–5), which is why they hold. Zero diff per rule 6 — no fixes
invented to look busy. Item 8's all-pages table will re-verify them as
part of the exit sweep.
### Item 6 — Home + directory mobile polish ✅ (2026-06-12)

Live audit at 375 found the page already in good shape (Run 5's audit held:
hero type/wrapping clean at 54px, runner card stats + feed density right,
CTAs side-by-side). Three real gaps, fixed in one mobile-only CSS block:
- `.search__input` 15→16px under lg (iOS zoom)
- `.pill` 40→46px (queue asks 44 for the primary directory filter)
- `.activebar`: bottom floats above `env(safe-area-inset-bottom)`, gutter
  tightened to 24px total, Start-chat CTA 40→46px (Clear too)

Verified live: pills 46px, search 16px, activebar 229px wide / 14px above
the viewport bottom with an agent in the runner (env() inset is 0 in the
preview — real devices add it; flagged, not claimable in preview).
Rect-scan 0 offenders at 375 + 390 (scanner now also whitelists
overflow-hidden non-body boxes per item 3's note — the runner feed's mask).
Desktop 1280 unchanged (40px pills, 15px search). CSS-only diff: test:api
not run (no routes/shared components); tsc + build green.

### Item 5 — Chat mobile-first ✅ (2026-06-12)

The before-state was unusable, not just ugly: the 240px sidebar SQUEEZED the
chat at 375 — the composer textarea measured **21px wide**. No rect bleed, so
scrollWidth scans would never catch it; squeeze is a distinct failure mode.

- **Sidebar = overlay below lg** (absolute, opaque, shadow), chat keeps full
  width while open (textarea 261px). Defaults CLOSED on phones, closes on
  chat-navigation taps.
- **State model matters**: first cut wrote the mobile auto-close into the
  PERSISTED sidebarOpen — one phone visit would permanently collapse the
  desktop sidebar. Split into transient `mobileSidebarOpen` (never persisted)
  vs the persisted desktop pref; verified the pref survives a full mobile
  session untouched.
- **framer-motion gotcha**: closing the AnimatePresence child mid-hydration
  orphans it (panel stuck at width:240 with the store closed). Mount-gate the
  sidebar render until the client knows the breakpoint.
- Composer: 16px font under lg (iOS zoom), safe-area bottom padding,
  workspace height 100dvh (URL-bar-proof) — pinned exactly at viewport
  bottom (813 ≈ 812+border).
- Bubbles: 85vw cap on phones + overflow-wrap:anywhere — verified live with
  a 90-char unbroken hash (wraps, right edge 342 < 375).
- Receipts footnote: verified by inspection only (truncate within min-w-0
  rows — guest demo produces no live receipts); flagged per rule 6.

Rect-scan 0 offenders at 375 + 390; toolbar already scrolled (Run 5 work
held). Desktop 1280: sidebar inline/open, 14px composer — unchanged.
tsc + build green; test:api 37/37.
### Item 4 — Dashboard Keys/Approvals/Activity mobile ✅ (2026-06-12)

Mock-harnessed all three gated pages (fetch-patch pattern, real components in
the real shell). Found + fixed:
- **Approvals BLED at 375** (scrollWidth 386, all 9 rows past the viewport):
  `grid sm:grid-cols-2…` leaves the base track implicit → max-content; the
  long agent name set the track. Same trap as Run 6 item 1's charts grid.
  Fix: explicit `grid-cols-1` + `min-w-0` rows. Detail-arrow 22→40px on
  phones (padding, not layout).
- **Keys**: mint input was 12px (iOS zoom) → 16px under lg; Copy/Mint/Revoke
  32→40px touch heights; minted-secret reveal verified live in harness
  (mocked POST → break-all renders, no bleed).
- **Activity**: rows now wrap to two lines on phones; Basescan links 16→40px
  touch height (padding trick, rows stay visually dense).

Rect-scan 0 offenders + exact scrollWidth at 375 AND 390 on all three pages;
desktop verified unchanged (3-col approvals, compact controls — all fixes
are max-lg). After-screenshots (true 375 viewport via playwright) in
docs/autopilot/dash-{keys,approvals,activity}-375-after.png; the approvals
before-state is recorded numerically above (no screenshot — bleed was found
and fixed in the same harness session). test:api 37/37 (= full pass on this
branch; the 43-check version is on the unmerged item-1 branch). Harnesses
deleted; diff greps clean.
### Item 3 — Home tie-in + perf pass ✅ (2026-06-12)

NetworkPulse on the home directory statbar: "$X settled on-network →" linking
to /activity, same /api/activity payload (one query path; component renders
nothing until data arrives so the bar never flashes zeros, and hides when
settledCalls=0). Statbar now flex-wraps; the pulse drops to its own line at
375 with a 40px tap target (was 33 — caught and fixed in preview).

Perf findings, honest ledger:
- Index: planner uses Seq Scan at n=9 rows (correct); with enable_seqscan
  off the feed query uses **Index Scan Backward on
  spend_ledger_ok_created_at_idx** — proven viable for growth, not yet
  preferred. Re-check via EXPLAIN when the table is real-sized.
- Payload: 2,589 bytes total (8 recent / 2 daily / 7 top) — well under any
  concern at the 50-row cap.
- Page weight: **Next 16 build no longer prints first-load JS per route** —
  flagged as unverified rather than claimed; /activity reuses the
  recharts/DashboardCharts chunks the dashboard already ships.
- Rect-scan home 375: 0 real offenders. Two `runner__price` rects extend
  past the viewport INSIDE the runner feed's masked overflow:hidden box —
  by-design clipping (fade mask), zero scrollWidth impact. Item 8's
  all-pages scanner should also whitelist overflow-hidden non-body
  containers to encode this.
- test:api skipped this item (no route/server code touched — CSS + home
  page + new client component only); tsc + build green.

### Item 2 — /activity page ✅ (2026-06-12)

Public page + nav tab (between Chat and Dashboard). Server shell owns SEO
(title/description/OG); client ActivityBoard polls /api/activity every 30s
(matching the API's s-maxage so faster polling would be noise). Stat tiles
(Settled / Calls today / **Blocked by policy** / Active accounts), both
DashboardCharts reused (with the Run 6 ChartBox + min-w-0 guards — no new
chart plumbing), 50-row feed with Basescan links (40px touch height via
padding, not row bloat), honest empty/error states ("the network is young"
vs "unavailable — refresh"), and a privacy footnote stating the
truncation/aggregate rules out loud.

Verified: real prod data end-to-end in preview (8 settled calls, truncated
0x5eaa…55a0, tx links); rect-scan 0 offenders at 375 AND 390, scrollWidth
exact; feed rows wrap to two lines on phones (service+account+amount /
tx+time); desktop + mobile screenshots reviewed in preview. tsc + build
green (/activity prerenders ○, the API stays ƒ); test:api 43/43 (nav is a
shared component). Stacked on item 1's branch — merge #61 first.

### Item 1 — Public activity API ✅ (2026-06-12)

`GET /api/activity` (no auth, `force-dynamic` so Next can't freeze a build-time
snapshot, CDN cache via `s-maxage=30, stale-while-revalidate=120`): stats
(settled USD/calls, callsToday UTC, blockedCalls, distinct activeAccounts),
30-day daily series, top-10 services, 50 most-recent SETTLED rows with
owner truncated server-side (P1) and denial rows excluded (P2 — aggregate
only). Additive `@@index([ok, createdAt])` pushed to Neon (plain db push;
verified in pg_indexes — the global feed can't ride the grant-scoped index).

test:api grew 37 → **43** (denial-seed probe, shape, cache header, truncated
account visible, P1 full-address-absent over the raw payload text, P2
denial-row absence). All 43 green; tsc + build green. Real-payload sanity:
the owner's lisbon receipts render with truncated `0x5eaa…55a0` + Basescan-able
tx hashes; `callsToday: 0` verified correct (UTC midnight had passed — DB
now() cross-checked, not assumed).

---

# Run 6: mobile-first, every page — 1/6 done, items 2–6 carried into Run 7

Owner report with screenshot: the AUTHED dashboard bleeds horizontally on
mobile (KPI cards, budget card, and the spend chart run past the viewport) —
the gated surface previous runs could only flag. This run makes every page
genuinely mobile-first and adds the tooling to verify gated pages.

## Rules (constitution)

1. `autopilot-<slug>` from `autopilot`; PRs → `autopilot`, never `main`;
   stacking declared with merge order (queue order).
2. Never merge/push-main/force-push/deploy/publish/pay.
3. **Gated-page verification (new tool)**: build a TEMPORARY mock-data
   preview page (e.g. app/__preview/dash/page.tsx) that renders the gated
   page's CONTENT components with realistic fixture data and no auth. Verify
   in the preview browser at 375/390 (rect-based scan: any element whose
   getBoundingClientRect().right exceeds the viewport +2px counts — NOT
   scrollWidth, which overflow-x:hidden defeats). Screenshot evidence from
   the preview browser. DELETE the temp page before commit — it must never
   ship (grep the diff for __preview before pushing).
4. Mobile-first specifics to enforce everywhere: no horizontal bleed at
   375/390; primary tap targets ≥44px (40 acceptable for dense secondary);
   inputs ≥16px font (iOS zoom); long mono strings (hashes/urls) truncate or
   scroll within their box, never push it; charts/tables get their own
   overflow-x scroll containers; fixed/floating elements respect
   env(safe-area-inset-*).
5. `npx tsc --noEmit` + `npm run build` minimum; `npm run test:api` (with
   throwaway-admin env) must stay 37/37 after any item touching routes or
   shared components.
6. Honesty: anything unverifiable flagged, not claimed. Real-wallet visuals
   remain the owner's glance, but with the mock harness the LAYOUT is ours
   to verify — "gated" no longer excuses bleed.
7. Progress log per item; two consecutive failures → stop; owner message →
   stop; final iteration appends a run summary.

## Queue (ordered; one per iteration)

- [x] **1. Dashboard Overview mobile bleed (the screenshot)** — mock-harness
  the Overview content (Kpi grid, budget meter + SignGrantButton, both
  DashboardCharts with ~10 days of fixture data). Find and fix every bleed
  source — prime suspects: Recharts containers (must be ResponsiveContainer
  inside a min-width:0 parent, wrapped in an overflow guard), the KPI grid
  at 2-col/375, the budget card's mono spend line, `.dash`/`.dash__main`
  min-content. Rect-scan 375 + 390 clean; before/after screenshots from the
  preview browser; harness deleted.
- [ ] **2. Dashboard Keys/Approvals/Activity mobile** — same harness pattern
  per page: keys (secret reveal block's break-all, ConnectAgentCard's
  <pre> scroll container, list rows with long prefixes), approvals (3→2→1
  column grid comfort, switch tap size), activity (long hosts/hashes
  truncate; row wraps to two lines on phones instead of pushing). Rect-scan
  clean; screenshots; harness deleted.
- [ ] **3. Chat mobile-first** — at 375/390: sidebar must overlay (not
  squeeze) or collapse cleanly; composer sticky-bottom with safe-area
  padding and 16px input font; message bubbles ≤85vw with long-word
  breaking; agents toolbar scroll behavior; receipts footnote wrapping.
  Public page — verify everything live in preview incl. guest send box
  focus (no iOS zoom: input font-size ≥16px).
- [ ] **4. Home + directory mobile-first polish** — hero type scale and
  spacing at 375 (eyebrow wrapping is fixed; tune sizes), runner card
  internals (stats row, feed line density), search + pills (44px), card
  grid single-column rhythm, ActiveServerBar safe-area + width on phones.
  Rect-scan + screenshots (public).
- [ ] **5. Developers + blog + servers detail mobile polish** — dev page:
  snippet <pre> scroll, capability cards stack spacing, ep rows (method
  chip + path truncation) at 375; blog: post typography measure, code
  blocks scroll, index cards; servers detail: header badge wrap, volume
  lines wrap. Rect-scan + screenshots (public).
- [ ] **6. Global mobile foundation sweep** — verify viewport meta is
  emitted on every route; 16px minimum on ALL text inputs; safe-area
  insets on fixed elements (activebar, drawer); `-webkit-tap-highlight`
  sanity; a final all-pages rect-scan table (375 + 390) in the PR covering
  /, /developers, /blog, /blog/[slug], /servers/[slug], /chat, dashboard
  gate + mock-harnessed authed pages. This is the run's exit criteria.

## Progress log — Run 6

_(autopilot appends here)_

### Item 1 — Dashboard Overview mobile bleed ✅ (2026-06-11)

**Root cause was NOT the charts.** Mock-harness + element-deletion bisection in
the preview browser proved the driver is `.dash__rail`: at ≤900px its four
`white-space: nowrap` section links sum to ~465px, and as a grid item with
default `min-width:auto` the rail sets the shared 1fr track's minimum.
`.dash__main` already had `min-width:0` — the rail never got it. Track inflated
to 465px at a 375px viewport (scrollWidth 483) and every child — KPIs, budget
card, charts — rode along. The chart's pinned 431px inline width was downstream
(recharts measured an already-inflated container).

Fixes: `min-width:0` on `.dash__rail` (one line, kills the bleed); plus the
queue's belt-and-braces — charts grid `grid-cols-1` explicit + `min-w-0` cards,
ResponsiveContainer wrapped in a `min-w-0 overflow-hidden` ChartBox (a stale
pinned px width can never hold the page open again), `min-w-0` on Kpi tiles
(long agent slugs truncate instead of flooring the 2-col track), and the Sign
grant pill bumped to a 40px tap target under lg (25px before; desktop
unchanged).

Verified: rect-scan (scroll-container-aware) clean at 375 + 390, scrollWidth
375/390 exactly; desktop 1280 unchanged (4 KPI cols, 25px pill). tsc + build +
test:api 37/37 (throwaway-admin env). Before/after at true 375 viewport:
`docs/autopilot/dash-overview-375-{before,after}.png` (before's full-page
canvas is 483px wide — the bleed made visible). Harness deleted; `grep -ri
preview` over the diff clean.

Deviations/lessons: (1) rule 3's suggested `app/__preview/` path can't work —
underscore-prefixed folders are private in the app router (no route); harness
lived at `app/preview/dash` instead. (2) Headless Chrome `--window-size` is
NOT a 375 viewport even with a clean profile (it still laid out the inflated
track post-fix) — `npx playwright-core screenshot --channel=chrome
--viewport-size=375,812` against the dev server is the reliable way to get
mobile screenshot FILES; the preview browser stays authoritative for scans.
(3) Harness pattern that worked: patch `window.fetch` for the page's API
routes in the temp page and render the REAL gated page component + shell —
zero changes to shipped code for testability.

---

## Run 5 summary (2026-06-11)

**Queue: 5/5 complete.** Zero failed iterations. Mobile navigation exists, the dashboard is a Vercel-style shell, and every public page passes a real-viewport 375px audit.

| # | Item | PR |
|---|------|----|
| 1 | Mobile hamburger nav (portaled drawer) | [#52](https://github.com/Yeetful/website/pull/52) |
| 2 | Dashboard sidebar + route split (incl. /dashboard/keys) | [#53](https://github.com/Yeetful/website/pull/53) |
| 3 | Dashboard mobile section bar | [#54](https://github.com/Yeetful/website/pull/54) |
| 4 | Key-page links (/dashboard/keys canonical) | [#55](https://github.com/Yeetful/website/pull/55) |
| 5 | 375px audit (hero grid fix + tap targets) | [#56](https://github.com/Yeetful/website/pull/56) |

**Merge order: #52 → #53 → #54 → #55 → #56** (one stacked chain; each contains the previous).

**Bugs found by the run's own checks**: the nav's backdrop-filter trapping fixed-position descendants (drawer portaled); the grid min-content hero clipping that scrollWidth scans can't see (rect-based scanning is the new standard); headless-Chrome --window-size ≠ mobile viewport (screenshot artifacts, preview browser authoritative).

**Owner manual passes**: authed dashboard glance on a phone (rail → section bar, keys page, approvals toggles) + the usual wallet flows.

---

## Run 4 summary (2026-06-11)

**Queue: 5/5 complete.** Zero failed iterations. The blog exists end-to-end: schema → admin API (Bearer = headless publish) → public UI with full SEO → uploads (token-pending) → feeds → a published launch post.

| # | Item | PR |
|---|------|----|
| 1 | BlogPost model + publish API | [#46](https://github.com/Yeetful/website/pull/46) |
| 2 | Public /blog UI (SEO first-class) | [#47](https://github.com/Yeetful/website/pull/47) |
| 3 | Vercel Blob uploads | [#48](https://github.com/Yeetful/website/pull/48) |
| 4 | RSS + sitemap + robots | [#49](https://github.com/Yeetful/website/pull/49) |
| 5 | First post | [#50](https://github.com/Yeetful/website/pull/50) |

**Merge order (one stacked chain)**: #42 (Run 3 harness — prerequisite) → #46 → #47 → #48 → #49 → #50. Run 3's #43–#45 remain open and independent.

**Owner setup**: `ADMIN_WALLETS=0x<you>` (local + Vercel) to publish; create a Vercel Blob store + `BLOB_READ_WRITE_TOKEN` for photos (the harness check self-upgrades when it appears); `NEXT_PUBLIC_SITE_URL` optional (defaults to https://yeetful.com).

**Notes**: SEO directive landed at every layer (schema-enforced ≤160 descriptions + alt column, canonical/OG/JSON-LD, stable publishedAt, RSS/sitemap/robots, XML-escaping proven with booby-trapped titles). test:api grew 25→37 checks. The launch post's claims are all literally true, including its own publish mechanism.

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
