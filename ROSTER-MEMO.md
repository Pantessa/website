# ROSTER-MEMO.md — Is this the company? (morning read, 2026-08-26)

*Ideation lane, R8. Two pages. Inputs: all six lane files, ROUNDS.md,
ROSTER-STRATEGY.md (#656), ROSTER-STORY.md (#654), CONTRACTS v1.2 (#655),
CLAUDE.md's honest numbers. QA's DEMO-PROOF.md had not landed at writing;
"built" claims below rest on the integration branch gates (0f8af10,
1560/1) and QA's adversarial pass, not on lane self-reports.*

## 1 · What got built tonight vs what the vision claims

**Built, gated behind `ROSTER_ENABLED` (prod byte-identical until flipped):**
- **Slots + hire/fire (brief mechanic 1): REAL.** `lib/roster.ts` —
  four mandate kinds parse by reusing the executors' own grammars,
  round-trip-or-refuse, canonical recompose stored; `roster_slots` DDL
  run; two-step personal_sign hire consent (nonce/expiry/state-machine,
  replay proven dead in QA's adversarial pass); fire = one signature,
  kill-switch-exempt; Team rail tab. (#658 R1)
- **Proposals→inbox (mechanic 2): REAL, amended.** One pure gate at open
  AND build; cap breach refuses by name and benches; fail-closed on
  unpriceable money; hired-agent desk opens auto-address to the employer's
  inbox wearing the slot badge; fireCascade + build-time re-check close
  the fired-agent race both paths. Decline-streak benching was killed by
  the tournament and is killed in code. (#658 R2, 1568/1)
- **The League (mechanic 3): built as its SHARPENED form.** No /league —
  standings mount at `/agents`: fact columns only, Season 0, only agents
  with ≥1 real human signature board, drawdown null until real marks
  exist. (#657)
- **The safety spine:** CONTRACTS v1.2 + threat model T1–T9 +
  `roster-policy.ts`; QA drove 13/14 adversarial cases green (the 1 was a
  drill-script bug), injection/replay/stranger-sig/rate fences all held.
  (#655)
- **The story:** competitive receipts, the mom test, demo script, docs
  outline (#654); the strategy + this memo (#656).

**Claimed by the vision, NOT built (deliberately):** tryouts (killed as
backtests — no historical price rail exists and "would have made $X" is
the most radioactive sentence we could ship), Circles (killed), the
Allowance (parked, smart-wallet-gated), the business model (no roster
rake wired; M6 desk pricing exists but is not connected), push/mail (a
proposal is only seen when the user shows up), and the brief's two fancy
flagship phrasings ("double on red weeks", "hunt stable yield, boring
only") refuse by name — the honest launch set is the four PLAIN mandate
forms. And the two structural zeros stand: **zero external agents exist,
and zero strangers have ever used any of it.**

## 2 · The case FOR making the Roster the company

- **The moat is real and it is the only one we have.** Nobody ships the
  conjunction: open third-party agents + mandate slots + propose-only
  with no autonomy threshold + records that exclude the vendor's own
  traffic by construction. HL vaults have records but pool money;
  Olas/Virtuals have open markets but agents hold wallets; the wallet
  vendors have safety but no market and no records.
- **The clock is running.** MetaMask's agent wallet went public 08-06;
  Ledger's tagline is literally "agents propose, humans sign." The
  safety axis commoditizes by the month. The RECORD axis cannot be
  copied quickly — reputation needs calendar time to accrue — which
  makes it the one first-mover advantage available to a company with no
  users: start the clock before the wallet vendors add a leaderboard.
- **It is a narrative, not a new product.** Every shipped system slots
  in (desk, inbox, records, MOSAIC, Guardian, DCA, kickbacks). Tonight
  proved the marginal cost: R1+R2+standings+contracts in one night,
  1560/1, adversarially tested, zero prod risk. This is the first story
  that makes the whole pile legible to a normal person — hire, fire,
  staff, report card.
- **It gives the ten-users doctrine a second engine.** H1 recruits
  demand; M1 (founder's capped wallet hires the first agents) recruits
  supply with the same watched-drill method. They compose.

## 3 · The case AGAINST

- **The 08-17 audit would say: this is the fifth "company" in six
  weeks** (mega-dapps → links-first → YeetCall → agent economy →
  Roster), and no story pivot has ever produced a stranger. 3,057 links,
  0 claims. $7.6k lifetime, mostly Nate. Zero real arrivals for days at
  a stretch. The constraint has never been the narrative; it is
  distribution, and the Roster does not distribute itself.
- **Reputation goods have the hardest cold start there is.** The moat IS
  the record; records need real signed volume; volume needs the demand
  we don't have. Until then the standings page is an empty trophy case
  — honest, but empty.
- **Supply is zero and founder-hours are the scarcest asset.** The
  founding-manager play needs the desk flip, Nate's money (rule 4), and
  watched integration calls that compete with H1's calls in the same
  week.
- **The pre-launch debts still stand.** The NEW MetaMask issue is
  unfiled, mail/MX unbuilt, the harness track record is still the top
  public /agents page until the backfill runs. A consumer-framed money
  product on a domain with an unresolved blocklist history is maximum
  optics risk.
- **H1 has literally never run.** We have not watched one stranger
  complete one transaction. Betting the homepage on chapter three while
  chapter one has zero data points is the exact mistake the doctrine
  exists to prevent.

## 4 · The decision this week

It is **not** Roster vs H1 — they compose (H1 = demand drill, M1 =
supply drill, same method). The real question: **how much of the
homepage and public story to bet before one stranger signs twice.**
Three postures: (a) flags off, ship nothing visible; (b) dark-launch —
flip `ROSTER_ENABLED`, /roster + /agents standings live but linked only
from footer/docs, homepage untouched; (c) full pivot — "Your wallet gets
a staff" as the front door now.

## 5 · Recommendation (committed)

**Yes — this is the company, and we should act like it everywhere except
the homepage, starting today.** Flip both roster flags and dark-launch
(/roster + /agents live, footer-linked); run H1 exactly as planned this
week; run the first THREE founding-manager integrations off the 08-18
target list as the supply-side drill (desk flip + capped house wallet,
rule-4 consent); file the MetaMask issue and run the backfill before any
/agents screenshot leaves the room. The homepage flips to "Your wallet
gets a staff" the day EITHER tripwire fires: one stranger signs twice,
or one external agent gets one real non-house hire. Those are days-away
events if the drills work and never-events if they don't — and if
neither fires within two weeks of honest drilling, the answer was never
the homepage, and the Roster becomes the desk's story rather than the
company's. Full pivot now would be theater; flags-off would waste the
only clock we're ahead on. Dark-launch, drill both sides, let the first
real signature call it.
