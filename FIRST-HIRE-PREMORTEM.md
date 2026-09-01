# FIRST-HIRE-PREMORTEM.md — the stranger who hired the house Rebalancer, and why it failed

*Ideation lane, FIRST HIRE sprint 2026-08-26. The H1-premortem discipline
(STRATEGY-squad-2026-08-18 §8 — 6 of its 10 modes got closed before a
stranger ever hit them) applied to the first hire. Scenario: a stranger —
MetaMask EOA, some USDC + ETH on Base — arrives via a DM link to `/roster`
with both flags on, tries to hire the house Rebalancer ("keep me 60/40
ETH/USDC") and get ONE proposal signed. Assume it failed. Ten reasons,
ranked by likelihood × silence, grounded in the merged code (cites are
file:line on main). "Seen?" = which table/row shows it — the H1 lesson is
that the deadliest failures are the ones that write nothing.*

**The top three, up front:**
1. **They hired, and then nothing ever happened.** There is NO roster cron
   — the manager runs only when a human types `manager:once`.
2. **The DM lands on `/roster`, and `/roster` has no door to hiring** —
   the Team tab lives in the chat rail; the page links only /agents and
   /docs.
3. **An ignored first proposal silences the manager FOREVER** — no
   decline verb exists, and the manager refuses to stack on an undecided
   card.

**A cross-cutting finding before the table:** almost every roster failure
is invisible. `ask_failures` logging is wired into the CHAT route only;
the Team tab surfaces errors as client-side `setError` (TeamRailTab.tsx:
119, 150, 184) and writes no row. Modes 2, 5, 6, 7, 10 below produce ZERO
database evidence. Smallest structural fix (one PR, QA lane): a
`roster-failure` beacon — POST refusals + preview problems + consent-sign
rejections into ask_failures with their own kind, is_internal-aware. The
premortem's visibility column assumes today's code, not that fix.

| # | Failure | Grounding (file:line) | Seen? | Smallest fix | Lane |
|---|---|---|---|---|---|
| 1 | **Silence after the hire.** The mandate's promise is "proposals arrive"; nothing schedules the manager. `house-manager.ts` header says it plainly: "No cron tonight — runnable by hand" (scripts/house-manager.ts:20–22); vercel.json's cron list has hl-guardian/jobs/dca/spot-guard and NO roster entry (vercel.json:4–18); `HOUSE_MANAGER_KEY` isn't even in this checkout's .env.local. A stranger who hires gets a hired row and eternal quiet. | scripts/house-manager.ts:20; vercel.json:4 | **Half-seen:** a `roster_slots` row status `hired` with zero bound `broker_intents` — visible only to someone who runs the SQL. Nothing alerts. | Today: FLIP-DAY runbook step — operator runs `manager:once --live --wallet <w>` after EVERY hire, on a timer, until a cron exists (GTM owns the step). Next wave: `/api/cron/roster` walking hired slots (the dca cron pattern). | GTM (runbook now) + UI/UX (cron next wave) |
| 2 | **No door from the landing page to the hiring surface.** The DM link is `/roster`; that page links `/agents` (app/roster/page.tsx:87) and `/docs/roster` (:91) — the Team tab, the ONLY place a slot can be posted/hired, is inside the chat rail (ChatRail.tsx:245). A stranger reads the hero and has nowhere to act. | app/roster/page.tsx:87,91 | **Not at all** — no funnel event, no row; they bounce invisibly. | This sprint's storefront IS the fix — verify the /roster "Meet your first manager" strip's tap lands IN the hire flow (not on /agents). | UI/UX (in flight) + Visuals |
| 3 | **One ignored card = the manager never speaks again.** No decline verb exists anywhere on the proposal surfaces (grep decline/dismiss across JobsRailTab, /i, lib/inbox: nothing) — the stranger's only options are sign or ignore. The manager is one-card-at-a-time and refuses to stack on an undecided proposal (house-manager.ts:12–13, `stackingRefusal`). Ignore once — the normal stranger response to an unsure moment — and every future run refuses. Mode 1's silence, self-inflicted after one card. | house-manager.ts:12; lib/roster-manager (stackingRefusal) | **Half-seen:** the undecided `broker_intents` row ages; the stacking refusal prints only in the operator's terminal. | A decline verb on the inbox card/rail chip (marks the intent declined, frees the manager's next look; cap-breach-only benching is untouched — declines are quota fuel per M3, never bench fuel). | UI/UX |
| 4 | **The proposal exists but is stamped internal.** `manager:once` stamps EVERY run internal unless `--live` (house-manager.ts:23–24; lib/inbox.ts:80 carries it). Drill habit says run it bare; flip-day habit will too — making the stranger's first real proposal a records-ghost (never notifies — stamped intents never notify — and excluded from every record read). The operator can't tell from the output that they just quarantined a real user's card. | house-manager.ts:23; lib/inbox.ts:80 | **Seen wrong:** the row EXISTS but `is_internal=true` — worse than absent, because eyeballing the table looks fine. | FLIP-DAY runbook red-letters `--live` on every post-hire run; `manager:once` prints a loud `INTERNAL RUN — records-quarantined` banner when bare. | GTM (runbook) + QA (banner nit) |
| 5 | **The composer speaks UN, not payroll.** The stranger meets "Post a mandate slot · $200 cap" (TeamRailTab.tsx:223), "mandate is one sentence" (:209), "unhired" (:248). ROSTER-STRATEGY.md §7 already ruled: job not mandate, seat not slot — the merged UI never got the memo. "Cap" is never explained (it's per-proposal — `ROSTER_DEFAULT_CAP_USD` = 200, roster-client.ts:26). | TeamRailTab.tsx:209,223,248 | **Not at all** — stalls before any POST. | Copy pass: "Give your manager a job — e.g. 'keep me 60/40 ETH/USDC'"; cap rendered as "it can never propose a move over $200". | UI/UX + Visuals |
| 6 | **Their phrasing refuses and the refusal logs nowhere.** "keep me 60/40" parses (lib/roster.ts:78,118) — but "watch my wallet", "rebalance me monthly", any protect/yield phrasing gets the amber problem line (TeamRailTab.tsx:212–215) and the preview refusal is never recorded (ask_failures is chat-only). The grammar-gap queue — the #540 workflow that drove a month of parser fixes — is blind here. | TeamRailTab.tsx:212; lib/roster.ts:118 | **Not at all.** | Log preview/POST mandate refusals as ask_failures kind `roster-mandate` (is_internal-aware); example chips under the composer that round-trip parseMandate (the chip-IS-the-contract rule). | QA (beacon) + UI/UX (chips) |
| 7 | **The hire signature reads as the scary moment.** Step 2 is a personal_sign over server-minted bytes (TeamRailTab.tsx:140) — MetaMask shows a text wall: slot id, `Agent: <16 hex>`, nonce, expiry. The consent's own last sentence is excellent ("It moves nothing by itself…" — CONTRACTS §1) but it's BELOW the hex. H1's premortem #2 taught that strangers die in the wallet sheet; a rejection here writes nothing (`reportWalletRefusal` is wired to tx/order buttons only — the 08-18 fix never covered signMessage flows). | TeamRailTab.tsx:140; CONTRACTS v1 §1 | **Not at all** — a consumed-nonce pending slot is indistinguishable from "never tried". | Pre-sign explainer line in the UI ("your wallet will show a hire note — nothing moves"); wire reportWalletRefusal into the hire/fire signMessage catch. | UI/UX |
| 8 | **Nobody returns to a proposal that arrives later.** Even with mode 1 solved, the card lands in the rail's For-you section + inbox (JobsRailTab.tsx:111) — and there is no push, no mail, nothing. The stranger closed the tab after hiring; period-2 of the DCA play taught this exact lesson (08-18 H3: "there is NO push — the DM is the reminder"). | JobsRailTab.tsx:111 | **Half-seen:** undecided intent rows aging. | The watched drill IS the mitigation (operator DMs "your first proposal is in — open /inbox/<addr>"); FLIP-DAY includes the DM template. Mail stays THE WEEK item 5. | GTM |
| 9 | **The $200 default cap can't fix real drift.** A $5k wallet drifted to 68/32 needs a >$400 leg; `decideProposalGate` fail-closes over-cap at open AND build. Best case the manager proposes a partial; worst case the flagship mandate's first proposal refuses by name and the stranger reads "broken". Cap was designed as protection; at the default size it's a straitjacket nobody chose. | roster-client.ts:26; lib/roster-propose.ts:16–17 | **Seen:** the gate refusal surfaces in the manager run + broker status (operator-visible, stranger-invisible). | Slot creation suggests the cap FROM the wallet ("wallet ≈ $X — a rebalance move can reach ~$Y; cap $Z?") instead of a flat 200; partial-move proposals stay within cap by design (spec note for the manager). | UI/UX (composer) + Ideation (spec'd the rule here) |
| 10 | **Mobile.** The DM opens on a phone; `NEXT_PUBLIC_WC_PROJECT_ID` was verified unset on prod (08-18 §10 #9 — owner item, still unclaimed), so the only phone path is MetaMask's in-app browser; and the Team tab inside the 375px rail has never had a stranger drill (this sprint's QA item). | 08-18 §10.1 item 9 | **Not at all.** | QA's 375 drill (in flight); until WC lands, the DM says "desktop, or open inside the MetaMask app". | QA + GTM (DM copy) |

**What this premortem does NOT flag:** the consent crypto (nonce/replay/
recompose held under QA's adversarial fire), the proposal guard chain
(cap at open+build proven), fire semantics (one tap, kill-switch-exempt).
The spine is sound. Every mode above is a DOOR problem — reach, ritual,
copy, silence — which is exactly what the H1 premortem found about /i,
and five of those ten got fixed in 48 hours. Same play here.

**Suggested drill order (mirrors go/no-go):** fix 2+3+7 (this sprint's
lanes already own 2), runbook 1+4+8 (GTM, today), then run the first
watched hire EXACTLY like H1 — one stranger, screen shared,
`roster_slots` + `broker_intents` open in a second tab, operator running
`manager:once --live` as the human cron.
