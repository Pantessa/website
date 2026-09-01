# FLIP-DAY.md — the Roster launch-morning runbook

GTM lane, FIRST-HIRE sprint 2026-08-26. One sitting, in this order — every
step has its command and its verify. Nothing here is run by a lane; this is
Nate's morning. Run it AFTER the first-hire sprint PRs are merged and
deployed (the storefront removes hash-pasting from the hire flow — flipping
before it merges ships the paste-a-hash hire to strangers), and re-check
any step QA's `FIRST-HIRE-PROOF.md` supersedes (in flight at this writing —
it is the ground truth for the hire path's request/response).

Shell setup used by every step (main checkout or any worktree on main):

```sh
cd /Users/nategeier/yeetful/website
git fetch origin main && git log origin/main --oneline -1   # note the sha
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"')"
npx prisma generate    # stale client = phantom "missing model" errors
```

---

## 0. Preconditions — do not pass with a red

```sh
npm run digest:gtm     # exits 2 if a SERVING domain is listed anywhere
```

- **Verify:** digest table shows pantessa.com / www.pantessa.com **clean on
  BOTH feeds** (uniswap-embed listed is expected and not blocking). Never
  run a launch morning into a wallet interstitial.
- **Verify prod is dark and serving current main:**

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://www.pantessa.com/roster    # expect 404
curl -s -o /dev/null -w '%{http_code}\n' https://www.pantessa.com/agents    # expect 404 (standings index)
curl -s -X POST https://www.pantessa.com/api/roster -H 'content-type: application/json' \
  -H 'x-yf-internal-run: 1' -d '{}' | head -c 200; echo                     # expect 503 kill-switch copy
```

- Confirm the deploy sha on Vercel matches the origin/main sha noted above.
- Confirm with counsel/self that FOUNDING-MANAGERS.md §2 blanks are filled
  if any DM goes out today (step 6 can be deferred; steps 1–5 cannot hurt).

## 1. The data must be clean BEFORE anything is public

**1a. Backfill — dry first, read the counts, then apply:**

```sh
npx tsx scripts/backfill-internal-arrivals.ts            # DRY RUN — read every count + sample
npx tsx scripts/backfill-internal-arrivals.ts --apply    # writes (owner-gated; this is the consent)
```

**1b. The /l/yeet drill brand row** (destructive UPDATE — code already
renders house for it; this clears the stored row; squad-2026-08-18/security.md):

```sql
UPDATE creator_handles SET brand_domain=NULL, brand_name=NULL, brand_logo=NULL,
  brand_accent=NULL, brand_bg=NULL, brand_updated_at=NULL
WHERE handle='yeet' AND brand_domain='robinhood.com';
```

**Verify (all three):**

```sh
npx tsx scripts/backfill-internal-arrivals.ts | grep -i "would flag"   # every table → 0 remaining
curl -s -o /dev/null -w '%{http_code}\n' https://www.pantessa.com/agents/00606c759a593e02   # expect 404 — the legacy "harness" record is DEAD
npm run digest:gtm    # arc denominator now honest (~40 organic links lifetime, not ~3.5k)
```

Do not proceed while the harness record still 200s — it is the first thing
a founding manager would screenshot.

## 2. Flip the flags (Vercel → website project → Settings → Environment Variables, Production)

| var | value | why |
|---|---|---|
| `ROSTER_ENABLED` | `true` | server kill switch — roster writes, /roster, /agents standings, /docs/roster |
| `NEXT_PUBLIC_ROSTER_ENABLED` | `true` | client mirror — Team tab, storefront. **BUILD-TIME: requires a redeploy to take effect** |
| `BROKER_DESK_ENABLED` | `true` | external agents' broker_open (gates ALL step-6 desk DMs) |
| `HOUSE_MANAGER_KEY` | (optional) agent key | the house Rebalancer's identity for `manager:once` / the storefront's first row |

Then **Deployments → Redeploy** (NEXT_PUBLIC_ vars bake at build — an env
change without a redeploy leaves the client half dark).

**Verify dark→lit (exact strings, from QA's probes):**

```sh
curl -s https://www.pantessa.com/roster | grep -c "You keep the only pen"            # ≥1
curl -s https://www.pantessa.com/agents | grep -c "The standings are signatures"     # ≥1
curl -s -o /dev/null -w '%{http_code}\n' https://www.pantessa.com/docs/roster        # 200 (flag-gated route)
curl -s -X POST https://www.pantessa.com/api/roster -H 'content-type: application/json' \
  -H 'x-yf-internal-run: 1' -d '{"preview":true,"mandate":"keep me 60/40 ETH/USDC"}' \
  | head -c 300; echo    # expect preview JSON: kind "shape" + canonical "tile my wallet 60% ETH, 40% USDC"
```

And in a browser: the rail shows the **TEAM** tab; the storefront lists the
house Rebalancer (post-sprint-merge behavior).

## 2b. Make hired slots self-serve — the roster cron + the house manager

**Without this step, every hire goes silent** — premortem #2
(ROSTER-STRATEGY §6: "Hired, then silence. The slot sits empty a week — an
employee who never shows up"). A hire is only a promise until something
proposes into it.

- **`/api/cron/roster`** (Security lane, this sprint): registered in
  vercel.json **live-by-default, 5-min cadence**, gated by `CRON_SECRET`
  exactly like the guardian/DCA crons (Vercel sends
  `Authorization: Bearer $CRON_SECRET`; **no CRON_SECRET set = route
  disabled** — the fail-closed default). Env needed: `CRON_SECRET` is
  ALREADY on Vercel (the guardian verified it, ~07-13);
  **`HOUSE_MANAGER_KEY` is required** (step 2's table) or the cron has no
  identity to propose with.
- **Verify:**

```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $CRON_SECRET" https://www.pantessa.com/api/cron/roster   # 200
# then: hire the house Rebalancer on a test slot and watch the inbox —
# a badged proposal (or a within-band silent pass) within ~5 minutes.
```

- **🔴 RED LETTER — `manager:once` stamps `is_internal` unless `--live`.**
  A bare `npm run manager:once` is a DRILL: its proposals are
  internal-stamped, which means they never notify, never enter records,
  and a REAL stranger's hire served that way is a **records-ghost** — the
  human sees a card, signs it, and the signature builds nobody's record.
  For any real (non-test) hired slot the manager must run **`--live`**
  (which drops the stamp). Rule of thumb: test wallet → bare; stranger →
  `--live`, no exceptions.
- Decline verb: ⟨pending — Security's sprint diff defines the shape;
  fold the exact command/route name here when security.md shows it⟩.

## 3. Preflight the whole product against prod

```sh
BASE=https://www.pantessa.com npm run preflight:house
```

**Verify:** **6/6 green** (the script sends `x-yf-internal-run` +
`x-yf-no-ask-log` natively; its rows are stamped). Any red = stop, read
`/dashboard/failures`, fix or roll back (step 8) before any DM.

## 4. Mint H1 and open the watch screens

- On `/links`, signed in under the claimed @handle: mint
  **`Swap $20 of USDC to ETH on Base`** — a creator link (first-touch
  attribution), NOT a house link. One link per tester (WEDGE-KIT §4).
- **Verify:** open the `/i/<slug>` in a fresh browser profile — card
  renders, connect door opens, no interstitial.
- Open the two watch tabs and leave them open all day:
  - `https://www.pantessa.com/dashboard/links` — the slug's funnel row
    (opens → connects → built → signed → settled; NO auto-poll, reload it).
  - `https://www.pantessa.com/dashboard/failures` — click the in-page
    "funded" + "external" toggles (URL params are not read).

## 5. Roster bookkeeping

- **Founding badges** — as each founding manager completes a real
  integration (not before):

```sh
npx tsx scripts/set-founding-agent.ts --list                       # see current
npx tsx scripts/set-founding-agent.ts <16-hex handle> --label "cohort 1"
```

  Verify: their `/agents/<handle>` page shows the FOUNDING badge.
- **⚠ THE ONE CODE-CHANGE STEP — register /docs/roster in `DOCS_PAGES`**
  (`lib/docs.ts`): the route is live at step 2 but deliberately absent
  from the sidebar/doors/sitemap so the dark flag never leaked it. One
  small PR when ready to show it publicly; until then the URL works for
  DMs. Everything else on this page is env/data only.
- **SEASON_LABEL** (`lib/league.ts` — `'Season 0 — preseason'`): leave it
  on flip day; flips to season 1 per the tryouts spec §2.5 only when the
  season actually starts (also a code change — batch with the DOCS_PAGES PR).

## 6. The DMs — in call order, one at a time

Paste-ready texts live in **FOUNDING-MANAGERS.md §4** (variant A = desk
rows, variant B = human-signs rows) with per-row openers in
**STRATEGY-squad-2026-08-18.md §9**. Call order: **Virtuals (protect) →
vaultpilot (hands-now) → eliza (distribution)**, then the rest. Rules:

- Desk rows (1–5, 7, 8) only AFTER step 2's `BROKER_DESK_ENABLED` verify.
- Re-verify each target's `pushed_at` before its DM (`gh api repos/<owner>/<repo> --jq .pushed_at`).
- Terms quoted in DMs must match the filled §2 blanks; never quote a
  record stat (records are honest and therefore nearly empty).
- **Verify (per DM, end of day):** the B1 metric sheet — did they wire a
  door from a key/IP that isn't ours; log replies verbatim in the
  FOUNDING-MANAGERS tally.

## 7. File the MetaMask A′ issue — STILL THE COMPANY-KILLER ITEM

Not a footnote: `uniswap-embed.yeetful.com` is listed on BOTH feeds today
and every recruit's wallet trusts those feeds. Same sitting, ~20 minutes:

- **Draft A′** (`DISCLOSURE-REBRAND.md` §Draft A′) → a **NEW issue** on
  `MetaMask/eth-phishing-detect` (the old #273376 is CLOSED — a comment
  there reaches nobody).
- Draft B′ → Blockaid registration; Draft C′ → SEAL delisting. All three
  anchor on `pantessa.com/rebrand`.
- **Verify:** the new issue URL exists and names the SUBDOMAIN explicitly;
  paste the URL into CLAUDE.md's owner queue. Daily `npm run digest:gtm`
  is the watch (a delisting shows up as an isRemoval diff).

## 8. Rollback — one move, nothing else needed

Unset `ROSTER_ENABLED` + `NEXT_PUBLIC_ROSTER_ENABLED` (and
`BROKER_DESK_ENABLED` if the desk is the problem) on Vercel → redeploy.
Fail-closed by construction: /roster, /agents standings, /docs/roster 404
again; roster writes 503; **reading existing slots and FIRE keep working**
(the kill switch exempts the exit — nobody is ever locked in with a hired
agent). No data steps to undo: step 1 is honesty work that stands
regardless, DDL was additive, and hired slots simply wait dark until the
next flip.

---

## The Roster clip — shot list (from RosterTranscript's own beats)

The clip is the DEMO-PROOF run made watchable; `/roster` renders
RosterTranscript as a replayable strip — record THAT (screen capture of
the strip on `/roster`, or the same beats driven live on the Team tab).
~45s at transcript pacing. **Re-cut against `FIRST-HIRE-PROOF.md` when QA
lands it** — if the storefront changes a beat (no hash-pasting, tap-to-
hire), the storefront version wins.

| # | shot | beat (the transcript's own strings) | why it's in |
|---|---|---|---|
| 1 | Cold open, dark /i card | (from overnight shots/ — "the dark /i shot is frame one") | the artifact people already understand |
| 2 | The sentence | wallet types: `keep me 60/40 ETH/USDC — cap it at $100` → `slot pending · kind: shape · stored canonical: "tile my wallet 60% ETH, 40% USDC"` | grammar-or-refuse, no LLM — the safety floor in one line |
| 3 | The hire | consent minted: `slot id + agent hash + mandate hash + $100 cap + nonce — never the sentence, never a raw key` → `signed ✓ — hired` | one signature IS the employment contract |
| 4 | The proposal | agent: `broker_open: "Swap $40 of USDC to ETH on Base"` → `$40 under the $100 cap · addressed to the employer's inbox wearing the badge` | the flip's headline: proposals are messages |
| 5 | The inbox card | `"Swap $40 of USDC to ETH on Base · from Rebalancer · Review & sign"` … `ignoring it is free, and the slot stays HIRED` | accept-like-a-text + no decline-benching |
| 6 | The teeth I | 4th stacked proposal → `"already has 3 undecided proposals … Stacking more is refused." — a wall, never a bench` | fences refuse by name |
| 7 | The teeth II | `broker_open: "Swap $150…"` → `Refused at open … Over-cap proposals bench the agent` → `status: BENCHED — no inbox card was created` | probing the cap is the offense |
| 8 | The exit | `fire consent — signed ✓` → `the unsigned card vanished (its link now 404s). There is nothing to withdraw.` → fired agent re-opens → `Fired is terminal` | the whole custody story in eight seconds |
| 9 | Close | /agents standings: "The standings are signatures" → /roster hero: "Your wallet gets a staff. You keep the only pen." | the record is the moat; the line is the brand |

Publishing gate (unchanged doctrine): the clip goes nowhere public until
ten strangers have signed H1 — it exists so the founding-manager calls and
the eventual thread start from the same footage.
