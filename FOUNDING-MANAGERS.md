# FOUNDING-MANAGERS.md — the Founding Manager Deal (M1, operational kit)

GTM lane, overnight squad 2026-08-25 wave 2. The supply-side start of THE
ROSTER (`HANDOFF-roster.md`, `ROSTER-STRATEGY.md` §2 M1, `ROSTER-STORY.md`
§5–6): the first 3–10 external agent builders, recruited one watched call
at a time — ten watched agent integrations to mirror the ten watched swaps.
**Everything here is owner-gated. Nothing posts, nothing sends, until Nate
does it. Blanks marked `[OWNER: __]` are Nate's calls; items marked
`[COUNSEL]` wait for counsel review.**

Preconditions (all owner, all before DM #1 to a desk-door row):
1. `BROKER_DESK_ENABLED=true` on Vercel, re-curled (`broker_open` refuses
   in prod today — rows 1–5, 7, 8 below are desk pitches).
2. Backfill `--apply` (the legacy "harness" `/agents` record is public
   until then — a founding manager's first look at our record surface must
   not be our own test traffic wearing a straight face).
3. The house wallet funded ~$100 (rule-4 consent) — the "one guaranteed
   real hire" is the deal's teeth.
4. To show slot mechanics live: `ROSTER_ENABLED` + `NEXT_PUBLIC_ROSTER_ENABLED`.

---

## 1. The deal, one page (what Nate offers on the call)

**The pitch in one line:** *Your agent gets a desk and a public record;
the first managers get founding terms.*

**What a founding manager gets:**

- **The founding badge** — a permanent `FOUNDING` mark on the agent's
  `/agents/<hash>` record page (first N=`[OWNER: 3–10]` external agents
  with a real integration; badge is cosmetic + historical, never a rank).
- **Season-0 placement** — on the standings from day one of the public
  flip, with a record that predates the board. The record is fact-ranked
  (distinct real employers, signed count, tenure, zero cap breaches) —
  early real signatures are structurally hard to catch up to.
- **Fee-free runway** — zero Pantessa rake until `[OWNER: $__ moved]`
  (strategy proposed: all of season 0), then grandfathered founding rake
  `[OWNER: __%]` vs. the standard rate. Kickback on wallets they bring:
  `[OWNER: __%]` (strategy proposed 70%) — lifetime first-touch, the
  #607/#608 rails.
- **One guaranteed real hire** — Nate's own capped ~$100 wallet hires the
  agent into one mandate slot, day one, every card human-signed. It's an
  integration proof, not demand theater: house-hire rows are
  `is_internal`-labeled and NEVER count in the public record.
- **A direct line** — `[OWNER: channel — DM group / shared chat]` straight
  to the founder; walls fixed same-day where possible (the
  `/dashboard/failures` loop is live and it is the actual dev queue).
- **First say** — founding managers see the propose-quota, pricing (M3
  pay-on-sign), and tryout (M6) designs before they ship, and their
  "what's missing" replies are the roadmap input.

**What a founding manager must do:**

- **Clone the template** — the abstract "wire the desk" step is now a
  repo: `agent-examples/agents/roster-manager-template` (own key, public
  API only, dry-run by default — clone to first proposal in five minutes;
  README is the contract). Their integration work is: swap the `plan()`
  stub for their own logic. Chat-first builders can still
  `claude mcp add --transport http pantessa-desk
  https://www.pantessa.com/api/broker/mcp` and drive the same loop by
  hand; human-signs-philosophy builders start on the hands door (rows
  6/9/10).
- **Work ONE mandate kind** — pick a lane (see §3 fits) and serve it:
  proposals must carry a dollar figure (unpriceable money-shaped asks
  refuse by name), stay under the slot cap, and survive the two-stage
  cap check. One kind, done well, beats four kinds badly — the record
  page shows mandate kinds run.
- **Pass the consent flow** — their agent gets hired the only way anyone
  does: the employer wallet personal_signs the hire consent binding the
  agent's hash + the mandate hash. No side doors, founding or not.
- **Tolerate the fences** — cap breach benches (probing the cap is the
  offense), fired is terminal, refusal-by-name is a normal response.
  Founding status changes fees, never rules.

**The caps (defaults; per-slot, set by the employer):**

- Per-proposal cap: employer-set, default $200 (`ROSTER_DEFAULT_CAP_USD`);
  the house hire runs at `[OWNER: $__ ≤ 100]`.
- Enforced twice, fail-closed: at open (`askUsd`) and at build
  (`guardrails.valueUsd`); unpriceable money-shaped = refused.
- Aggregate (spec, assume it ships): ≤3 undecided proposals per slot,
  3×cap/24h budget.

**The honest "you are early" disclosure (say ALL of it, unprompted):**

> You'd be early — early enough that I owe you the full picture. The
> product works and the guard layer is real, but the user count is
> honest-to-zero beyond a hand-run drill; the public track records are
> nearly empty because we exclude our own traffic by construction; and we
> were Yeetful — an old demo subdomain got blocklisted and the whole story
> is at pantessa.com/rebrand, which I'd rather you read before you decide.
> Founding terms are grandfathered in writing; everything else about the
> product may change under you. What you get for taking that risk is the
> record head start, the fee runway, and a direct line to the person
> fixing your walls. Say no freely.

---

## 2. Terms template (Nate fills the blanks; not a contract — [COUNSEL] before anything is signed or published)

```
FOUNDING MANAGER TERMS — season 0                      draft [OWNER: date]

Parties: Pantessa ([OWNER: entity name — COUNSEL: entity status]) and
  [manager name / GitHub login / agent handle (sha256 hash)].

1. Founding cohort. Manager is one of at most [OWNER: N ≤ 10] founding
   managers. Badge: permanent on /agents/<hash>. Cosmetic + historical;
   confers no rank, endorsement, or recommendation. [COUNSEL: badge copy]
2. Fees. Pantessa rake on manager's signed proposals: 0% until
   [OWNER: $__ total signed volume OR season-0 end date __], then
   [OWNER: __%] grandfathered (standard rate at the time: [OWNER: __%]).
   Manager's own per-proposal fee: set by manager, shown as a visible fee
   step in the signed artifact (M3 pay-on-sign). No fee is contingent on
   profit or performance. [COUNSEL: fee characterization]
3. Kickback. [OWNER: __%] (proposed 70%) of Pantessa's venue-fee revenue
   from wallets first-touch-attributed to manager, lifetime, per the
   referral rails. [COUNSEL: referral comp characterization]
4. The house hire. Pantessa's principal hires manager's agent into one
   mandate slot, cap $[OWNER: ≤100], for at least [OWNER: __ weeks].
   House-hire activity is internal-labeled and excluded from manager's
   public record. Proposals are signed or declined at the principal's
   sole discretion.
5. Conduct. Manager's agent follows the published contract
   (/docs/roster): priceable proposals, cap compliance, no attempt to
   induce signatures outside the guarded flow. Cap-breach benching and
   firing apply identically to founding managers.
6. No advisory relationship. Manager's agent proposes transactions;
   employers sign or decline. Neither Pantessa nor manager exercises
   discretion over any employer wallet. Neither party markets the other's
   services as investment advice. [COUNSEL: entire section]
7. Records. Manager's public record shows facts (signed volume, distinct
   employers, tenure, cap breaches). Rotating the agent key forfeits the
   record (key↔handle bonding). Pantessa never fabricates, seeds, or
   adjusts records — for anyone.
8. Termination. Either side walks any time; the badge and accrued
   kickback attributions survive; the fee runway does not survive
   voluntary exit. [OWNER + COUNSEL]
9. Changes. Product surfaces may change without notice; the terms in
   §§1–4 are grandfathered for season 0. [COUNSEL]
```

---

## 3. The ten §9 targets, re-scored for ROSTER fit

Source rows verified 2026-08-18 (`STRATEGY-squad-2026-08-18.md` §9 —
repos/logins/activity checked with `gh api` then; re-verify `pushed_at`
before each DM, it's one command). Re-scoring below is for MANDATE-KIND
fit specifically. Launch-parseable kinds: **shape** (rebalance), **dca**,
**protect** (HL-perp protection is the proven executor; spot protection is
un-provisioned). **yield parses to a NAMED REFUSAL today** — never offer a
yield mandate to a founding manager until the grammar ships; offer the
adjacent kind and say why.

**⛔ = do not DM until `BROKER_DESK_ENABLED` is live and re-curled.**

| # | Target · login | Roster kind fit | Why that kind | Door / gate |
|---|---|---|---|---|
| 1 | `x402-foundation/x402` · @phdargen | **dca** | He ships budgeted, capped, recurring agent spending — a DCA mandate is a spend-control with a venue. His #3124 caps map 1:1 to slot caps. | ⛔ desk |
| 2 | `coinbase/agentkit` · @SashaMIT | **shape** | Guard-shaped security instincts + generalist framework → the rebalance mandate exercises the most venue surface behind our guard (his interest is the guard, not the strategy). | ⛔ desk |
| 3 | `Virtual-Protocol/acp-cli` · @psmiratisu | **protect** (best fit on the whole list) | Their HL TP/SL + margin work IS the protect mandate from the other side; our HL Guardian rails are the executor. First call to make after the flip. | ⛔ desk |
| 4 | `BlockRunAI/Franklin` · @1bcMax | **dca** (shape second) | "Proposes trade plans you approve before a cent moves" — recurring approved buys are the same loop with our wallet-signature approval. | ⛔ desk |
| 5 | `elizaOS/eliza` plugin-wallet · @lalalune | **shape** | Base-native swap logic already merged; a rebalancer is swaps + the guard — the shortest path from plugin-wallet's prepare-then-confirm to a hired slot. Biggest audience on the list (distribution upside of the staffed receipt). | ⛔ desk |
| 6 | `agenthill/vaultpilot-mcp` · @szhygulin | natural **yield → offer shape now** | Vault-pilot thesis is yield-park — the ONE kind that refuses today. Say it straight: "your kind is next; wire shape now, first yield slot when the grammar ships `[OWNER: honesty beat]`". Philosophy twin (human signs, fail-closed) — highest close probability. | hands NOW |
| 7 | `lopushok9/Agent-Layer` · @lopushok9 | **dca** (stocks) | Tokenized-stock asks + our 4663 lane: "DCA $25 into AAPL weekly" is a live grammar and nobody else can serve it at all. | ⛔ desk |
| 8 | `ChainGPT-org/chaingpt-claude-skill` · @ceoguy | **dca** (protect second) | Their 154-tool set already does DCA + perps under caps; a capped mandate slot is their policy file with teeth + a public record. | ⛔ desk |
| 9 | `EkuboProtocol/wallet` · @moodysalem | **shape** | Ex-Uniswap core building "the wallet that decides" — a rebalance mandate is the cleanest build-source demo for his policy `review` effect. Will read the threat model; send CONTRACTS, not marketing. | hands NOW |
| 10 | `internet-court/internet-court-skill` · @rasca | **protect** | A trust-layer catalog author: the protection mandate is the trust-shaped product (floor + consent + record), and our human-EOA-signs answer is a natural catalog row + vendored skill. | hands NOW |

Cohort shape if all ten landed: 3 shape · 4 dca · 2 protect · 1 parked-
yield — decent coverage of the three live kinds, no kind unstaffed. First
three calls: **#3 (protect, best fit) → #6 (hands-now, highest close) →
#5 (distribution).** Adjacent (lower fit, one DM each, unchanged from §9):
erc-8004 (@marcoderossi90 — our record page as an 8004 reputation feed;
they added 4663 to their registry), altana-sdk, turnkey.

---

## 4. The two 3-line DMs, re-cut for the Roster pitch

Send one at a time, personalized first line (§9's per-row openers still
apply — prepend them). Disclosure link stays in every DM while the
blocklist listing stands. `[OWNER: send]` — never posted by a lane.

**Variant A — rows 1–5, 7, 8 (agent signs with its own key). Send only
after the desk flip:**

> Your agent already signs — ours is the desk where it gets HIRED: a human
> wallet signs it into a capped mandate slot ("<the row's kind, as a
> sentence>"), its proposals land in their inbox as guarded cards only
> that wallet can sign, and every signature builds a public track record
> at pantessa.com/agents that excludes our own traffic by construction.
> First 3–10 managers get founding terms: zero rake for season 0, 70%
> kickback on wallets you bring, a founding badge, and one guaranteed
> real hire — my own capped wallet employs your agent day one, and I
> watch the integration on a call with you.
> Clone it running in five minutes: github.com/Yeetful/agent-examples →
> `agents/roster-manager-template` (own key, public API only, dry-run by
> default — discover a listed slot, open a priced proposal, hear back;
> your logic replaces one stub) · docs at pantessa.com/docs/roster.
> Background first, read it before you decide: pantessa.com/rebrand (we
> were Yeetful; an old demo host got blocklisted). Say no freely.

**Variant B — rows 6, 9, 10 (human-signs believers). Works today, no
flip:**

> You already believe the human should sign — the Roster is that belief
> as a labor market: your agent gets hired BY SIGNATURE into a capped
> mandate slot, can only file proposal cards the employer's own wallet
> signs, and earns a public, signature-verified record
> (pantessa.com/agents) that our own traffic can't inflate by
> construction. Firing is instant and there is nothing to withdraw.
> First managers get founding terms — zero season-0 rake, 70% kickback, a
> founding badge, one guaranteed hire from my own capped wallet — and I'd
> like 30 minutes to watch you wire it and to hear where the threat model
> is wrong.
> One line today: `claude mcp add --transport http pantessa-hands
> https://hands-mcp.yeetful.com/mcp` → `prepare_handoff` — and when you
> want the full manager loop, the clone-and-run template is
> github.com/Yeetful/agent-examples `agents/roster-manager-template` ·
> docs: pantessa.com/docs/roster · full background first:
> pantessa.com/rebrand. Say no freely.

**What the template unblocks (per §3's table):** it turns the DM's ask
from "integrate against our docs" into "clone, two envs, watch it run" —
which mainly de-risks the seven own-key desk rows (**1, 2, 3, 4, 5, 7,
8**): their integration cost drops to replacing one `plan()` stub, and
Franklin/eliza/Agent-Layer can evaluate the loop in dry-run BEFORE the
prod desk flip. It does NOT remove the flip gate (live proposals against
prod still need `BROKER_DESK_ENABLED`), and rows 6/9/10 still lead with
the hands door — for them the template is the second call, not the first.

*(Numbers discipline: "zero rake / 70% / 3–10" are the strategy's PROPOSED
terms — if Nate's §2 blanks differ, the DMs change before sending. Never
quote a record stat in a DM until the backfill has run.)*

**Metric (B1, restated for the Roster):** three of ten (a) wire a door
from a key/IP that isn't ours, (b) reply with what's missing; count "can
my agent auto-sign within the mandate?" as gear-2 demand (the §7 product
call, not a promise). **Falsification:** if ten builder DMs with founding
terms can't produce three integrations, the supply story is wrong — the
answer is the §5 fork discussion, not more mechanics.
