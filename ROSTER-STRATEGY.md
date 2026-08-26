# ROSTER-STRATEGY.md — tournament verdict on THE ROSTER (2026-08-25 overnight)

*Written by the Ideation lane of the 2026-08-25 overnight squad. Method:
four independent ideators (skeptical-VC "why is this not a feature" /
consumer-products "would my mom use this" / crypto-native "why does this
need a chain" / agent-builder "would I list my agent here") → 16 mechanics,
4 loops, 4 kills → three judges (premise-honesty / regulatory-and-safety /
does-it-compose-with-what-exists, the last one verifying claims against the
repo at f954ac5) → this synthesis. Sits under `HANDOFF-roster.md`; changes
its mechanic set and R-queue emphasis, not its protocol. H1 (the watched
$20 swap) is untouched by everything below.*

---

## §0 Verdict: SHARPEN — the Roster is the right story, wearing two wrong claims

**Keep the company. Fix the spine. Do not pivot the homepage.**

The honest argument, assembled from where all four ideators and all three
judges independently landed:

1. **The venture-scale asset is the MARKET + the RECORD, not the safety
   sentence.** GTM's competitive scan (ROSTER-STORY.md §3, receipts dated
   2026-08-25) lands a correction that sharpens the VC verdict: the
   propose-only safety axis is being commoditized THIS MONTH — MetaMask's
   agent wallet went public 08-06 (self-custodial, Guard Mode approvals),
   Ledger Agent Stack's July tagline is literally "agents propose, humans
   sign", and Human.tech/Cobo/Coinbase all ship human-in-the-loop policy
   wallets. Meanwhile HL vaults already match us on unfakeable on-chain
   records, and Olas/Virtuals on open agent markets. What NOBODY ships is
   the conjunction: **open third-party agents + mandate slots +
   vendor-traffic-excluded records + propose-only with no autonomy
   threshold at all.** So the moat is the league/labor market with the
   only records that structurally exclude the vendor's own volume
   (`is_internal`, #650); propose-only is the floor that makes an open
   market safe, not the headline. Wallet vendors are one "leaderboard"
   feature away from the adjacent claim — speed on the record/market side
   matters more than polish on the safety side. (VC ideator + GTM scan;
   premise judge scored the sharpen-toward-rail verdict 5/5, and the scan
   moves WHICH part of the rail leads: the reputation half, not the guard
   half.)
2. **"Ordinary people" is not true yet and saying it is a liability.**
   Every door we ship mints an EOA; email OTP has never been received on
   this domain; the first session is two signing prompts, a spending-cap
   screen, and a chain switch. Chapter one's customer is the crypto-native
   prosumer with a $1k–$50k self-custody wallet — the "lazy-slow money"
   that would never enter an HL vault. Say "your wallet gets a staff" to
   THEM. "Your mom" enters when the email→smart-wallet lane is proven
   (owner: THE WEEK 5). (Consumer + crypto ideators, both judges concur.)
3. **Two claims in the brief do not survive contact and must be repaired,
   not defended:**
   - *"Track-record-verified / unfakeable"* — false as written. A foreign
     agent can wash-sign its own record through burner employer wallets;
     `is_internal` only excludes OUR traffic. The repair is structural
     (§2 M2, M3): rank by distinct FEE-PAYING employer wallets and bond
     the agent key to its handle. Until then the word is "signature-
     verified", never "unfakeable".
   - *"Pay-per-result"* — as specified (x402 per-proposal) it's
     pay-per-NAG, and as a phrase it walks toward performance-fee /
     adviser surface. The repair: pay-on-sign (§2 M3), and the phrase is
     "pays only when you sign".
4. **Human-signs-every-move is the onboarding gear, not the religion.**
   Against HL vaults and Morpho curators (hired managers, bounded custody,
   zero latency) a proposal signed 14 hours stale loses on price and
   trains blind-signing. The durable moat is the SENTENCE — a mandate
   whose every execution must round-trip its own parser under an
   independent guard — and we already shipped two working instances of
   bounded autonomy on exactly that shape (HL Guardian delegated key, DCA
   autopilot). The ladder (§2 M5) is the honest answer; "we never touch
   your money" becomes "it can only ever do the sentence you signed."
5. **The sequencing discipline holds.** Nobody is coming (CLAUDE.md, the
   08-17 denominator finding); ten watched strangers is still the whole
   near-term game. The Roster changes what those ten people are the first
   chapter OF, not what we do this week. The homepage flips to the Roster
   only after one stranger has signed twice (returned > 0 — a row that has
   never existed).

---

## §1 What the judges killed, affirmed, and caught

**Kills AFFIRMED (all three judges, independently):**

| Kill | Grounds |
|---|---|
| **R4 tryouts as backtests / "would have made $X" anywhere** | Triple-fatal: (premise) it contradicts the "real signed volume only" thesis in the same breath; (regulatory) hypothetical-performance marketing is the most restricted advertising class that exists and we are not even a registered adviser — a dollar-gain projection mailed to a consumer is the single most radioactive artifact we could ship; (composability, **verified in-repo**) *no historical price archive exists* — the candles proxy is a 5s-TTL live feed for a few majors; a "90-day backtest" and a "last-30-days you'd have made $23" both assume a rail nobody has built. Forward-paper survives (§2 M6). |
| **R5 Circles** | Highest build cost of the seven, weakest claim ("group money without group custody" produces an aggregate number that is false by construction — members sign different legs at different times/prices), and a ghost-town social surface on a domain still fighting a blocklist. Month-2 at earliest. |
| **The League as a consumer surface (/league, seasons, standings)** | Consumers don't hire from leaderboards; returns-ranked standings select for variance (premise) AND put us in ranked-money-manager-plus-rake territory (regulatory). `/agents` stays — as the builder-facing credit bureau with mandate-kind categories and FACT ranks (§2 M2). R3 shrinks accordingly. |
| **Decline-streak auto-benching (brief mechanic 2)** | It measures the human, not the agent — a vacation and a bad agent read identically; it teaches agents to under-propose. Expiry never touches a record; only the human benches (one tap), and cap-breach benching survives because that's the agent's fault. |

**Overruled:** nothing survives on the merits. The composability judge
noted three kills are NOT build-cost kills (Circles' schema rails exist;
the League is queries; decline-benching is a counter) — they die on
premise, product, and regulatory grounds, not cost. Worth recording so
nobody later "rescues" them as cheap wins: cheap ≠ right.

**What the judges caught in the brief itself (all four ideators missed):**
- *"Our grammars already parse most of these" is false for two of the four
  flagship mandates.* "DCA… double on red weeks" has no conditional in the
  DCA grammar; "hunt stable yield, boring only" has no parser at all. R1's
  own round-trip rule would refuse half the launch mandates on day one —
  either the launch set shrinks to the two parseable kinds
  (rebalance/shape, plain DCA) or R1's scope grows two grammars
  (premise judge; routed to R1 lane).
- *Tryout "daily marks via existing quote fns" cannot price most mandates.*
  `chartPairFor` is fail-closed over ~10 Coinbase majors + 3 HL perps;
  stables and ALL stocks return null. M6 forward-tryouts are honest only
  for majors-only mandates until a marks feed exists (premise +
  composability judges, independently — routed to R4).
- The brief's §"why this is new" claims our records "exclude the vendor's
  own traffic by construction" and slides to "unfakeable" — vendor-clean ≠
  sybil-proof (premise judge; repaired in §2 M2/M3).
- "Fantasy-football energy" presumes a league of agents that exists; supply
  is zero. Every mechanic that assumes a stranger's agent shows up before
  users do is theater without §2 M1 (premise judge).
- The Allowance (brief mechanic 6) quietly depends on Spend-Permission-
  style claim rails that are smart-wallet-only — the same trap that killed
  Spot Guardian as a lead ask on 08-18. Parked, not killed (§3).
- The founder hiring and paying agents he platforms (M1) is a
  records-washing conflict UNLESS house hires are `is_internal`-labeled in
  every record read — which our own #650 discipline already makes cheap
  (regulatory judge; routed to Security).

---

## §2 The refined mechanic set, ranked

Ranked by the three judges' combined scores (premise / regulatory /
composability). Each entry names the rail it reuses.

**M1 — The Founding Manager Deal** *(5/4/5 — the cold-start move)*
First ten external agents get: season-0 zero rake, 70% kickback, a
founding badge, and **one guaranteed real hire — Nate's own capped ~$100
wallet employs every founding agent day one**, every card human-signed.
This is the supply-side twin of the H1 drill: ten watched agent
integrations to mirror ten watched swaps, run off the 08-18 §9 verified
target list. Every founding-agent-house-hire row is `is_internal`-labeled
in record reads (regulatory: the founder's hires must never inflate a
public record; they prove integration, not demand). Rail: kickback tiers
(#607/#608), the desk (M1–M6), ops not code. **Owner gates: the
BROKER_DESK_ENABLED flip before any outreach; the $100 house wallet is a
rule-4 consent item.**

**M2 — Employer-counted track records** *(5/4/5 — replaces the League)*
`/agents/<handle>` ranks and displays by FACTS: distinct real employer
wallets (fee-paying, `REAL_TRAFFIC`-filtered), signed proposals, mandate
kinds run, tenure, cap-breach count (zero is the badge). Never a returns
rank, never "top performer", never our endorsement. Agent key bonded to
handle — rotating the key forfeits the record (kills identity-rotation
sybil). Rail: M4 record pages + `broker_intents` + `REAL_TRAFFIC_WHERE`,
mostly queries. This is R3, shrunk and de-radioactived.

**M3 — Pay-on-sign, propose-on-quota** *(4/5/4 — fixes both incentive
inversions)*
Proposing is free but quota-limited per slot (unsigned proposals burn
quota; signs refill it) — an agent cannot spam nags. The agent's fee rides
the SIGNED build as a visible fee step (the lib/fees.ts pattern — the fee
is IN the artifact the human signs, the most honest disclosure surface we
own); platform rake comes from that. "Pays only when you sign" becomes
literally true. Rail: fees.ts fee steps + stampSwapFeeTier + the
unsigned_turn_windows bucket pattern.

**M4 — Proof-carrying invites** *(4/5/4 — the anti-drainer artifact)*
An addressed intent to a NEW wallet mints only if the sender has a signed
turn of the same shape; the card renders the sender's own tx hash: "Nate
signed exactly this on 08-25 — here's the receipt." Skin-in-the-game as a
protocol rule, purpose-built for a domain that cannot afford one drainer
headline. Rail: `embed_turns` shape query + the #645 recipient rails +
the /i card. (Security lane should threat-model the shape-match.)

**M5 — The autonomy ladder** *(4/4/4 now, load-bearing later)*
Per-slot gears: **Propose** (default; every move is an inbox card) →
**Auto-within-grammar** (earned + explicitly granted: delegated execution
where every fire must round-trip the mandate sentence's own parser and
pass the independent guard re-decode; one-tap revoke) → full autonomy
NEVER exists. Gear 2 already runs twice in prod-shaped code (HL Guardian
delegated key; DCA autopilot Spend Permissions). Honest constraint,
verified: the generic EOA enforcement mechanism for arbitrary mandates
does not exist yet — Spend Permissions are smart-wallet-only. Gear 2
ships per-mandate-kind as its executor already supports it; the generic
envelope is the deferred product call (08-18 §7, still Nate's).

**M6 — Forward-paper tryouts** *(the reg-safe residue of R4; buildable
spec now in `ROSTER-TRYOUTS-SPEC.md` §1, Season-0 mechanics in its §2)*
A tryout starts NOW and marks forward with live quotes (which exist);
never backward (which we cannot price honestly). Report card = descriptive
facts only: "3 proposals, each with its quote at proposal time" — **no
dollar-gain headline, no 'would have made', ever**. Inbox item + OG card
with the facts. Rail: R4's own spec minus the projection copy.

**M7 — Payday** *(right ritual, missing trigger — reduced scope)*
All pending proposals batch into one weekly review-and-sign session (one
SendTxChain, one sitting) — per-proposal signing IS nagging, and batching
is also the stale-quote fix (everything re-quotes at session open). But no
push/mail exists, so v0 is a batch VIEW + due chip (the DCA lazy-due
pattern) + the H2-style DM as the human reminder. Full Payday waits on
mail (THE WEEK 5).

**Parked (not killed):** the Signed Allowance (gift wedge — right idea,
wrong quarter: needs the claim rail + a non-crypto recipient door);
Skin-in-the-League season stakes (needs a league worth staking);
Signal Ledger decision-quality scoring (needs counterfactual pricing =
the same missing historical rail).

---

## §3 The viral loop, named precisely

**The staffed receipt.** One artifact, three edges:

1. **Human → human:** every signed proposal produces a receipt card
   carrying real facts ("Rebalancer fixed my drift — 2 legs, $41, I
   signed both") + the agent's `/agents` record link. Relaying it to a
   friend as an addressed intent REQUIRES the sender's own signature of
   the same shape (M4) — the invite carries proof, not promises. The
   receiver's one tap = hire the same agent on their OWN wallet
   (connect-to-act, rule 6).
2. **Agent → humans:** the builder's record page is their marketing
   asset — Pantessa converts the builder's existing audience (which
   would never hand that agent a KEY) into signers, and kickbacks pay
   the builder per wallet brought. The builder is the hero of the
   receipt; they do our distribution because the record is theirs.
3. **Receipt → record:** every signed receipt updates the public record
   that makes the next hire likelier — the flywheel edge.

What makes this THE loop and not a feature: the traveling artifact is a
**receipt (a verifiable fact)**, never a projection (a claim). It is the
only share mechanic that gets STRONGER because of our blocklist history
instead of weaker — provenance is the product. The Wordle-square version
of us is a signed receipt.

---

## §4 The 14-day MVP arc

**Days 1–3 — unchanged: H1.** Ten watched $20 swaps per
STRATEGY-squad-2026-08-18 §10.1. Nothing in the Roster gates or touches
it. In parallel, code lanes land R1/R2 behind `ROSTER_ENABLED`.

**Days 1–7 — the R-items that matter (re-aimed; ranking updated for the
GTM scan — the record/market items outrank the safety-polish items,
because the safety axis is commoditizing and the record axis is not):**
- **R1 (core)** — with one addition that decides everything: the mandate
  grammar must accept NATURAL phrasings per mandate kind ("keep me
  60/40", "make my wallet 60/40 ETH/USDC"), not just the executor verb —
  §6.2 of the 08-18 doc shows only "tile" parses today, and the hire flow
  dies at slot one otherwise. Refuse-by-name only truly unknown shapes.
- **R2 (core)** — plus the four repairs routed in the premortem (§6):
  re-quote at open AND sign; gas pre-read + wallet-refusal parity with
  /i; bench semantics per §1's kill; the proposal card wears mandate echo
  + slot badge + hire lineage.
- **R3 (shrunk but PROMOTED in priority)** — M2 fact-ranked `/agents`
  categories. This is now the moat artifact (the scan: nobody else has
  vendor-excluded records; wallet vendors are one leaderboard away), so
  it lands in week one, not week two. Still: no `/league` page, no
  seasons, no returns standings — the moat is the RECORD, not the race.
- **R7** — Security's threat model, now including: M4 shape-match
  gaming, wash-hiring (M2), mandate_text injection, founder-hire
  labeling.
- **R6 (flagged)** — hero + `/docs/roster` behind `ROSTER_ENABLED`,
  default off. Copy rules: §5.

**Days 8–14 — M1.** Desk flip (owner) → the ten founding-manager
integrations off the 08-18 §9 list, one watched call at a time, house
wallet hiring each (rule-4 consent first). M6 forward-tryouts start
ticking the day R2 lands.

**Theater this window (do not build):** R4-as-backtests, R5 Circles,
/league, any Wrapped-style share card with a dollar gain, the Allowance,
the generic envelope, a new domain or brand.

**Exit criterion for the window:** one stranger who signed a proposal
they did not mint themselves, and one external agent with a real
(non-house) hire. Either one is a first-ever row.

---

## §5 The regulatory line

*(Risk triage, not legal advice — flagged for real counsel before any
public launch of hire/fire mechanics.)*

**The frame that must stay true in substance:** Pantessa is non-custodial
software. Agents propose; the user signs everything (or grants a bounded,
sentence-shaped, one-tap-revocable gear-2 delegation). We never hold
funds, never rank by returns, never promise performance.

**Never say / never do:**
| Banned | Say instead |
|---|---|
| "would have made/kept $X", any backtest or projection dollar figure | descriptive facts: "3 proposals; quote at proposal time was…" |
| "top performer", "best agents", returns-ranked lists, our endorsement | fact ranks: distinct employers, signed count, tenure, zero cap breaches |
| "unfakeable" | "signature-verified on-chain — check it yourself" |
| "pay-per-result" (walks toward performance fees) | "pays only when you sign"; flat/visible fee steps, NEVER profit-share |
| "verified" implying our diligence | "identity-bonded; record is on-chain signatures" |
| "ordinary people / your mom" while the only door is an EOA wallet | "your wallet gets a staff" to wallet-holders |
| pooled anything: treasuries, omnibus balances, held allowances | signature-per-member, wallet-to-wallet at claim time, always |
| "everyone else custodies your money" (false and checkable — Giza, Copin, MetaMask agent wallet are honestly non-custodial; GTM's landmine) | "they give the agent hands — limited, scoped, thresholded hands, but hands. We give it none." |

**Reconciliation with GTM's ROSTER-STORY.md §4 (stricter line wins, per
protocol):** GTM permits labeled paper-tryout dollar figures ("Paper
tryout — hypothetical" on every surface) and a disclaimered `/league`
page. This lane's line — backed by the regulatory judge scoring every
counterfactual-dollar artifact 1/5 — is stricter and therefore governs:
**no "would have made/kept $X" in any artifact, labeled or not**
(forward-paper report cards carry descriptive facts only, §2 M6), and
**no `/league` surface** (fact-ranked `/agents` categories only, §2 M2).
GTM's never-say list and the hands-not-custody claim are adopted wholesale;
where GTM is stricter (drawdown always rendered beside any gain figure;
"past activity, not a promise" phrasing), THEIR line governs.

**Where the brief's mechanics crossed the line as-specified:** R4 report
cards (hypothetical performance — repaired to M6), the League
seasons/returns rank (adviser surface — repaired to M2), "pay-per-result"
copy (repaired to M3). The envelope/ladder stays defensible ONLY while
grants are user-initiated, capped, sentence-bounded, visible, and
one-tap revocable — drift past that is discretionary management.
Founder house hires must be labeled in records (washing). And the
standing safety rule: every artifact that asks for a signature carries
provenance (M4), because our specific history makes "sign this thing an
agent sent you" the drainer pattern unless we make it the anti-drainer
pattern.

---

## §6 Premortem — the first Roster user (a stranger who hires one agent)

Eight ways it dies, each with the owner.

| # | Failure | Owns it |
|---|---|---|
| 1 | **The mandate sentence doesn't parse.** "keep me 60/40" falls to the planner (only "tile" parses today); the hire dies at slot one. | **R1** (natural phrasings per kind) + QA pins |
| 2 | **Hired, then silence.** Supply is zero; the slot sits empty a week — an employee who never shows up. | **M1 + GTM** (house agents staff all four kinds day one, labeled ours + internal-stamped; no hire CTA for unstaffed kinds) |
| 3 | **The first proposal reads as a drainer** — unsolicited "sign this" from a domain that 307s off a blocklisted host. | **R2** (card wears mandate echo + slot badge + hire lineage) + **Security** (R7) + **M4** for relayed invites |
| 4 | **Signed at a stale price** — built at 9am, signed at 11pm; reverts or fills badly (the #641 class); signature burned. | **R2** (re-quote at open AND sign; validUntil + refresh per #427/#428) + QA stale-open drive |
| 5 | **No gas ETH** — approve fails inside the wallet, invisibly (H1 premortem #1; #652/#653 closed it for /i — the proposal path must inherit gas pre-read + funding answer + refusal beacon). | **R2** + QA regression |
| 6 | **Over-cap / off-mandate proposal signed anyway** because the card looks official. | **R2** (cap at open AND build — in brief) + **R7** (mandate_text injection, Security pre-code per protocol) |
| 7 | **Auto-bench fires on absence** — vacation reads as decline ×3; user returns to a benched roster and a dead inbox. | **§1 kill applied in R2**: expiry ≠ decline; human-tap or cap-breach benches; bench notice + one-tap re-hire (UI/UX) |
| 8 | **Firing fear / exit opacity** — can't see how to leave, or suspects a retained permission. | **R1** (fire = one signature, instant) + **UI/UX + R6**: always-visible fire button; fire receipt enumerates what was revoked ("nothing was custodied; delegation cleared") |
| — | Adjacent: empty-record cold start (M1/M6 carry it); email-door stranger can't connect at all (owner, THE WEEK 5). | |

---

## §7 Naming

**Keep "Pantessa" as the company — non-negotiable.** We just fought for
this brand; a second rotation while a blocklist appeal is open is the
literal drainer-rotation signature (standing rule 7). No new domain.

**"The Roster" wins as the product-surface name** (pantessa.com/roster):
fantasy-sports-legible, verbs fall out of it free (hire, bench, fire,
starting lineup). "Staff" stays the PITCH word — "Your wallet gets a
staff. You keep the only pen." is the best line the brief has; don't
promote it to a name (generic, SEO-dead). In consumer copy: an agent has
a **job**, not a "mandate"; a "slot" is a **seat**. UN words lose to
payroll words everywhere a stranger reads.
