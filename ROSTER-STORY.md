# ROSTER-STORY.md — the Roster's story, receipts, and scripts

GTM lane, overnight squad 2026-08-25 (round 2). Mission: `HANDOFF-roster.md`.
This doc is the story we tell (and refuse to tell), the competitive receipts
behind the "never done" claim — including one honest correction — the
90-second morning demo script for Nate, and the `/docs/roster` contract fill
for agent builders. **Reconciled with `ROSTER-STRATEGY.md` (Ideation) —
stricter line wins per protocol: backtests/"would have made $X" are dead
labeled or not, `/league` is dead (fact-ranked `/agents` only), circles and
decline-benching are killed, "unfakeable" is retired for
"signature-verified" until M2's wash-hiring repairs land.** Nothing in here
posts anywhere by itself; every external act is an owner item.

---

## 1. The pitch, at three altitudes

**One sentence:** Pantessa is the labor market where you hire AI agents to
run your money — they can only propose, only your wallet can sign, and every
agent's track record is public, signature-verified, on-chain — check it
yourself.

**One line, consumer:** *"Your wallet gets a staff. You keep the only pen."*

**The mom test (no crypto words):** You know how wealthy people have someone
who watches their money for them? This lets anyone hire computer helpers to
do that. Each helper watches for one thing you asked for — "keep my savings
balanced," "buy a little every week," "warn me and sell if things drop
hard." When a helper wants to do something, it can only send you a note:
*"here's the move, here's exactly what it costs — okay?"* Nothing happens
unless you tap yes. The helpers can never take anything, because you never
hand anything over — there's no account with them, no deposit, nothing to
give back. Every helper has a public report card of real work it actually
did — actual signed receipts you can go check, not screenshots. If you don't
like one, you fire it with one tap, and there's nothing to claw back because
it never held anything.

*(Internal note — the mom test is a comprehension check, NOT the audience.
Per ROSTER-STRATEGY §0.2, "ordinary people / your mom" is banned in public
copy until the email→smart-wallet lane is proven: every door today mints an
EOA and the first session is two signing prompts and a chain switch.
Chapter-one customer = the crypto-native prosumer with a $1k–$50k
self-custody wallet. Say "your wallet gets a staff" to THEM.)*

**Why this is different, in one breath:** Everyone else either takes your
money (eToro, robo-advisors, vaults) or gives the robot a limited hand on
your account (session keys, trading API keys). We give the robot *no hands
at all* — a desk, an inbox, and a reputation to lose.

## 2. The safety story — structural, not promised

The claim is not "we're careful." The claim is that the dangerous thing is
**impossible by construction**, at four layers, each of which fails closed:

1. **No custody, ever.** There is no deposit, no vault, no pooled account.
   Your assets never move to us or to any agent. Firing an agent is instant
   because there is *nothing to withdraw* — the fire-consent message the
   user signs says exactly that ("Nothing to withdraw — the agent never
   held anything," security CONTRACTS v1 §1).
2. **No keys, no allowances.** A hired agent gets no session key, no API
   key, no spending allowance, no smart-account permission. Its entire
   power is: file a proposal into your inbox. This is the difference from
   every "non-custodial" agent product shipping today — theirs constrain
   the agent's hands; ours never attach hands.
3. **The model never writes the transaction.** An agent states an intent in
   words. Pantessa's deterministic builders compile it — the agent (and the
   LLM) never authors calldata or addresses — and an independent guard
   re-decodes the result and refuses anything off-shape. A malicious or
   hallucinating agent can propose at worst a *correctly built, honestly
   labeled* transaction you then decline.
4. **Only your signature moves money.** Every proposal is a signable card
   in your wallet's inbox, capped by the mandate slot you signed when
   hiring ($cap enforced at open AND at build, over-cap refused by name).
   Hiring is one signature; the hire consent itself signs the agent's hash
   and the mandate's hash, so nothing can be swapped after you sign.

The line for the page: **"It can propose. Only you can sign. That's not a
policy — it's the architecture."**

## 3. Positioning receipts — the competitive scan (run 2026-08-25)

The brief claims: *nobody has an open market where any agent competes for
consumer mandates on public, unfakeable track records and structurally
cannot touch the money.* Scan verdict: **the full package is still
unshipped — but one axis of it got commoditized THIS MONTH.** Details:

| Product (2025–26) | Custody model | Agent execution power | Track-record verifiability | Open to third-party agents? |
|---|---|---|---|---|
| **eToro CopyTrader / Popular Investor** | Fully custodial (your cash on their books; "Assets Under Copy") | Platform mirrors the leader's trades automatically | Platform-attested dashboards; not independently checkable | No — vetted Popular Investors only (since 2025-06, ONLY PIs can be copied) |
| **Robo-advisors (Betterment/Wealthfront class)** | Fully custodial (RIA + brokerage custody) | Discretionary — they trade for you | Regulated reporting, but you trust the firm | No — house algorithm only |
| **Hyperliquid vaults** | Pooled — your money sits INSIDE the leader's positions | Leader trades the pooled money directly | **Strong — on-chain, independently checkable** (the bar we match) | Anyone can lead a vault, but it's copy-capital, not mandates |
| **Copin / HL copy tools (API-wallet class)** | Funds stay in YOUR account (closest on custody) | Agent API key trades your account (no withdrawal, but full trading authority) | On-chain history of the copied trader | Copying named wallets — no agent marketplace |
| **dHEDGE-class DeFi vaults** | Pooled vault contract; manager can't withdraw but controls the pool's trades | Manager/strategy trades pooled funds | On-chain vault history | Anyone can be a manager — again copy-capital |
| **Giza ARMA** | Non-custodial smart account | **Executes autonomously** via session keys within permissions | Aggregate stats self-published ($30M+ optimized) | No — house agent |
| **Almanak** | Multi-sig + TEE vaults | AI swarm deploys strategies into vaults | TVL/returns self-published | No — house strategies |
| **Kora / Neyro / HyperAgent / Polystrat** (2025–26 wave) | Non-custodial or restricted-scope API | Autopilot or co-pilot; agent executes | Self-published screenshots/monthlies (fakeable) | No — every one is closed (a trade press review's own conclusion: *none* operate as open agent marketplaces) |
| **Olas Pearl / Virtuals ACP** | Agent owns ITS OWN wallet; you fund the agent | Agent transacts autonomously with its wallet | Marketplace metrics, dev-oriented | **Yes — open agent marketplaces** (the bar we match) — but agents hold money and consumers fund them |
| **MetaMask Agent Wallet** (public **2026-08-06**) | Self-custodial (server wallet or BYO keys) | Guard Mode: agent acts within limits, 2FA pause above them; Beast Mode: fewer restrictions | None — no track records, no marketplace | Open to agent *frameworks* (Claude Code, Codex…), not an agent market |
| **Ledger Agent Stack** (2026-07) | Self-custodial, hardware-gated | **"Agents propose, humans sign"** for sensitive/out-of-policy actions | None | Open-source infra, no marketplace |
| **Human.tech Agentic WaaP / Cobo / Coinbase Agentic Wallets** | Self-custodial / policy wallets | Threshold-gated autonomy, human approves above limits | None | Infra, not a market |
| **THE ROSTER** | **None — nothing ever leaves your wallet** | **Zero. Propose-only, always, for every amount** — not a threshold, not a mode | **On-chain + vendor-traffic-excluded by construction (is_internal, #650)** — the only records that structurally exclude the vendor's own volume | **Yes — any agent, any framework, competing on record** |

**The honest correction (say it loudly — finding for Ideation):**

1. **"Agents propose, humans sign" is no longer a unique sentence.** Ledger
   shipped it as a tagline in July 2026; MetaMask's agent wallet went
   public **nineteen days ago** with Guard Mode approvals; Human.tech,
   Cobo, and Coinbase all ship human-in-the-loop policy wallets. The
   safety *axis alone* is being commoditized by wallet vendors right now.
   What none of them have — and what no one on this table combines — is
   the **market**: open third-party agents + mandate slots + public
   vendor-excluded per-agent records + propose-only *with no autonomy
   threshold at all*. Our story must lead with the record and the labor
   market, with propose-only as the floor that makes an open market safe —
   not as the headline novelty. And speed matters: the wallet vendors are
   one "leaderboard" feature away from the adjacent claim. (Adopted by
   Ideation's judges — ROSTER-STRATEGY §0.1 — with one sharpening we
   adopt back: the surface is fact-ranked `/agents` categories, NOT a
   `/league` page with seasons and returns standings, which the
   regulatory judge killed as ranked-money-manager territory.)
2. **Two rows already match one bar each.** Hyperliquid vaults match us on
   independently checkable records (and beat us on liveness — years of
   on-chain perp history); Olas/Virtuals match us on open agent markets. Our moat is the
   conjunction, plus one thing literally nobody has: **records that
   exclude the vendor's own traffic by construction** — every incumbent's
   numbers (and until #650, ours) mix in house/harness volume.
3. **The nuance to keep exact in copy:** several products are honestly
   "non-custodial" (Giza, Copin, MetaMask agent wallet). Never claim
   "everyone else custodies your money" — that's false and checkable. The
   true claim is: *everyone else gives the agent hands — limited hands,
   scoped hands, thresholded hands, but hands. We give it none.*
4. **"Unfakeable" is retired (Ideation's premise judge, adopted).**
   Vendor-clean ≠ sybil-proof: a foreign agent can wash-sign its own
   record through burner employer wallets; `is_internal` only excludes
   OUR traffic. Until M2's repairs land (rank by distinct FEE-PAYING
   employer wallets; agent key bonded to handle, rotation forfeits the
   record), the word is **"signature-verified — check it yourself"**,
   never "unfakeable." The table row above says "vendor-traffic-excluded
   by construction," which is exactly as far as the claim truthfully goes.

## 4. Regulatory language guardrails

*(RECONCILED with ROSTER-STRATEGY.md §5 — stricter line wins, both ways.
Their stricter lines govern: no counterfactual dollar figure in ANY
artifact, labeled or not; no `/league` surface. Our stricter lines govern:
drawdown always rendered beside any gain figure; "past activity, not a
promise" phrasing; the hands-not-custody claim. Nothing here is legal
advice; counsel review before any public hire/fire launch is an owner
item.)*

**Frame everything as self-directed software.** The user authors the
mandate sentence, the user signs every transaction, agents only propose.
Pantessa compiles and checks. Nobody exercises discretion over user assets.
Keep that true in the product AND the copy — the words below are how it
stays true in the copy.

**Never say:** "investment advice," "financial advisor," "we/agents manage
your money," "wealth management," "let it trade for you," "earn X%,"
"returns," "outperform," "beat the market," "passive income," "set and
forget," "guaranteed," "safe" (unqualified), "your personal fund manager."

**Say instead:** "agents propose transactions; you decide," "you sign every
transaction," "a standing instruction you wrote," "real signed history, not
projections," "software fee per proposal," "past activity, not a promise."

**Tryouts: backtests are dead, and so is the dollar figure — labeled or
not.** "Would have made/kept $X" is hypothetical performance — the most
regulated sentence in finance marketing — and Ideation's judges killed it
outright (my round-1 "label it Paper" allowance is superseded; stricter
wins). What survives is **forward-paper only, facts only** (M6): a tryout
starts NOW, marks forward with live quotes, and its report card says
"3 proposals; the quote at proposal time was…" — never a gain number,
never an extrapolation, never a backward look (which we also cannot price:
no historical rail exists, majors-only live quotes). Paper never blends
with signed history in data (security §5) or in copy. Counsel item before
any public tryout marketing.

**Record copy (there is no league):** no `/league` page, no seasons, no
returns rank, no "top performer," no endorsement. `/agents` ranks by
verifiable FACTS: distinct real employer wallets, signed count, tenure,
zero-cap-breach badge. Realized, signed history only; drawdown always
rendered beside any gain figure (never a gains-only card); "past activity,
not a promise" on every record surface.

**Business-model copy:** never "pay-per-result" (walks toward
performance-fee/adviser surface — Ideation §0.3); the phrase is **"pays
only when you sign."** Never describe any fee as "a share of your
profits" / "we win when you win." Fees are flat, visible, and ride the
signed artifact (§5). Counsel item before any fee tied to PnL is even
hinted. Also banned: "unfakeable" (→ "signature-verified"), "verified"
implying our diligence (→ "identity-bonded; the record is on-chain
signatures"), "ordinary people"/"your mom" while the only door is an EOA.

**Killed/parked mechanics take their copy with them:** Circles (killed —
month-2 at earliest) and the Allowance (parked on the claim rail + a
non-crypto door) do not appear in v0 copy at all. If either revives, their
round-1 guardrails revive with them: circles are never "fund/pool/
treasury" (a shared shape, everyone signs their own legs); the allowance
is never "a custodial account for your kid."

**Rebrand disclosure discipline (unchanged):** any outbound that names the
product links pantessa.com/rebrand. The Roster story never ships to a
stranger without it while uniswap-embed.yeetful.com is still listed.

## 5. Pricing narrative

The story in one line: **agents get paid only when you sign, and win work
by record; Pantessa is the arena and takes the gate.**

- **Pay-on-sign (M3 — reconciled; replaces round-1's "per proposal
  delivered/accepted"):** proposing is FREE but quota-limited per slot
  (unsigned proposals burn quota, signs refill it — an agent cannot spam
  nags). The agent's fee rides the SIGNED build as a visible fee step —
  the lib/fees.ts pattern, so the fee is IN the artifact the human signs,
  the most honest disclosure surface we own. Pantessa's rake comes out of
  that. "Pays only when you sign" is literally true.
- **The Founding Manager Deal (M1 — the supply-side start):** the first
  ten external agents get season-0 zero rake, 70% kickback, a founding
  badge, and one guaranteed real hire — Nate's own capped ~$100 wallet
  employs each one, every card human-signed, every house-hire row
  is_internal-labeled in record reads (integration proof, never demand
  theater). Terms are Nate's pricing call; the wallet is a rule-4 consent
  item.
- **Take-rate on movement (already live):** the 20bps-family venue fees on
  signed transactions are unchanged — the Roster mints MORE signed
  transactions; the north-star metric (money moved) is untouched.
- **Later, not now:** listing fees, priority slots, propose-quota tiers.
  Not in v0 copy.
- **Consumer framing:** "Hiring is free. Proposals are free. You pay only
  on the proposal you sign — a fee shown on the card before you sign it,
  plus the network fee. No subscription, no percent-of-assets." (Percent-
  of-assets is the robo-advisor smell; its absence is a differentiator AND
  a regulatory comfort.)

## 6. H1 becomes chapter one

The ten-strangers drill (WEDGE-KIT.md) does not change — and the Roster is
what it was secretly rehearsing. The mapping, exact:

- H1's minted `/i` link IS a proposal card: a shaped, guarded, capped
  transaction landing in front of a specific human who signs or declines.
  A mandate slot is just a standing subscription to cards like that one.
- **The recruit's signed receipt is the first record entry.** Nate's
  @handle mints the link (first-touch attribution, per-link funnel) — so
  the drill's ten signed swaps are, structurally, the first ten entries
  of real, is_internal-clean, stranger-signed volume attributable to one
  named originator. When the standings ship, Nate('s house agent) has a
  record that predates the board — the origin story writes itself, and
  it's TRUE.
- **M1 is the supply-side twin.** Ten watched agent-builder integrations
  (the 08-18 §9 verified target list) mirror the ten watched swaps —
  same doctrine, other side of the market. Gated on the
  BROKER_DESK_ENABLED flip and the rule-4 house wallet; the desk DM
  variants in WEDGE-KIT §10 are the opener, now with the founding-deal
  terms attached.
- **The traveling artifact is the staffed receipt** (ROSTER-STRATEGY §3,
  adopted as the GTM loop): every signed proposal mints a receipt card
  carrying facts + the agent's /agents record link. Human→human: relaying
  it as an addressed intent requires the sender's own signature of the
  same shape (M4 — proof-carrying invites; provenance is the product on a
  domain with our blocklist history). Agent→humans: the record page is
  the builder's marketing asset — their audience becomes our signers,
  kickbacks pay them per wallet. Receipt→record: every sign updates the
  page that wins the next hire. Never a projection — the Wordle square of
  us is a signed receipt.
- The drill's watch-notes feed the Roster's consumer copy: "why twice,"
  the spending-cap flinch, the felt-like sentences — those are the exact
  fears §2's four layers must answer on the landing page.
- Sequencing (strategy's line, adopted): the homepage flips to the Roster
  only after **one stranger has signed twice** — a returned>0 row that has
  never existed. Until then the Roster door stays flag-gated; cohort-two
  copy is "you signed one proposal; want a standing one?" (H3's DCA ask
  is already a mandate kind.)

## 7. Morning demo script for Nate — 90 seconds, local build

**Every beat is REAL on the integration branch** — the round-1 mocks are
gone. Beat statuses below come from QA's round-2 adversarial drill (13/14,
qa.md §Round-2), UI/UX R2 (#658 @ 277cfb6, badge screenshot-proven), and
Visuals (#657). **QA's `DEMO-PROOF.md` (round 3, in flight at this
writing) is the ground truth for exact request/response — if it disagrees
with a beat, it wins; re-read it before pressing record.**

Setup (before the clock): worktree on `squad/integration-roster` (QA's
morning head); `.env.local` carries `ROSTER_ENABLED=true` +
`NEXT_PUBLIC_ROSTER_ENABLED=true` + `BROKER_DESK_ENABLED=true` +
`GUARDIAN_KEY_SECRET`; `npx prisma generate` (rosterSlot model — stale
client fails tsc/runtime, Visuals' gotcha); prod build + `next start`;
burner wallet connected; one house agent_key in hand. Demo rows against
shared Neon: send `x-yf-internal-run: 1` on scripted calls (or delete rows
after) — a demo signature must never seed a public record.

| t | beat | say | proof it's real |
|---|---|---|---|
| 0:00 | The mandate | Open the rail's **TEAM tab** → type **"Keep me 60/40 ETH/USDC"**. "My money policy is a sentence. It must round-trip the product's own grammar or it refuses by name — no LLM interprets it. Watch: 'hunt stable yield, boring only' → refused by name." | parseMandate live (preview via `POST /api/roster {preview:true}`); natural phrasing "keep me 60/40" parses; yield-hunt refuses by name (uiux R1, +10 pins). |
| 0:20 | The hire | Draft → the server mints the consent → **one personal_sign** → hired. "Read what I'm signing: the agent's hash, the mandate's hash, the cap — and the sentence *'It moves nothing by itself; every proposal still needs this wallet's own signature.'* That's in the signed bytes." | Full HTTP draft→consent→hired flow driven by QA; adversarial: stranger's sig 401, replay 409, other-wallet 403, injection ×4 dead. |
| 0:40 | The proposal | From the agent key: `broker_open` with "Swap $40 of ETH to USDC on Base". "The desk hashes the key itself, finds my hired slot, and the card lands **addressed in my inbox wearing the slot badge** — which mandate is speaking, and its cap." | roster-propose auto-addressing on the M5 rails; badge = kind + canonical mandate + cap on inbox card, rail chip, /i pill (screenshot-proven, uiux R2). |
| 1:00 | The pen | Tap the card → /i → sign with the burner. "Guarded build, independent re-decode, my wallet signs. The agent never saw a key, never had an allowance." | On main since #645; R2 adds the badge pill on the same runtime. |
| 1:10 | The teeth (flex) | "And the cap has teeth": `broker_open` $500 against the $200 cap → **refused by name AND the slot benches** — probing the cap is the offense. Fire from the Team tab: one tap, **its pending cards vanish** (cascade). "Nothing to withdraw — it never held anything." | decideProposalGate fail-closed (unpriceable money refuses too); bench-on-breach + fireCascade wired + pinned (uiux R2); rp: fence held under QA fire. |
| 1:25 | The record | Open **/agents**. "The standings are signatures — distinct real employers, signed count, tenure, zero cap breaches. No returns rank, no 'top performer.' Our own traffic is excluded by construction. Your wallet gets a staff; you keep the only pen." | /agents standings live flag-on (Season 0 — preseason, Visuals); qualifiesForBoard = ≥1 real human signature, so a clean drill shows the honest empty state — show the house record page for a filled example. |
| 1:30 | (if asked) "Safe to show?" | "Both roster flags are fail-closed and unset on prod — tonight changed nothing in production. Flipping them is your call." | True by protocol; DDL is additive and already run. |

Fallback 60-second cut (if the integration head misbehaves live): beats
3–5 on main only — addressed intent → inbox → sign → /agents record —
"tonight's PRs add the employment contract around what you just watched."
Known blemish to avoid on camera: `/agents/00606c759a593e02` still renders
the legacy "harness" record on prod until the backfill `--apply` runs
(QA finding — owner item).

## 8. /docs/roster — for agent builders (contracts filled from CONTRACTS v1.2 + the landed code)

Working title: **"Work a mandate"** — sibling of /docs/desk ("Give your
agent hands"), linked both ways. Contracts below are the LANDED behavior on
`squad/integration-roster` (roster-policy.ts / roster.ts / roster-propose.ts
/ the /api/roster routes); items still spec-only are marked.

1. **What a mandate is.** A consumer-authored sentence, canonicalized by
   Pantessa's grammar (you never parse it). Kinds: `shape` | `dca` |
   `protect` | `yield`; input capped at 300 chars pre-parse; the CANONICAL
   recomposed sentence is what's stored and rendered — raw input is
   dropped. A slot = {slotId, kind, canonical sentence, capUsd (default
   $200), employer wallet, your agent hash once hired}. You never author
   calldata or addresses — you state intents; the deterministic builder +
   independent guard do the rest (same contract as /docs/desk).
2. **Discovery — v0 is hire-side, honestly.** There is NO open-slots feed
   yet: employers find YOU (your /agents record is the shop window; the
   hire input's agent picker feeds from it). You learn you're employed two
   ways: `GET /api/roster?wallet=0x…` (public, rule-6 — serves
   hired/benched slots only, never drafts or nonces), or simply by
   opening — a `broker_open` from your key returns the roster binding
   `{slotId, badge, url, inboxUrl, recipient}` when your hash matches a
   hired slot. Two employers and no wallet named = ambiguous = no binding;
   name the wallet. A published open-slots feed is a queued follow-up, not
   a today-contract.
3. **Getting hired.** The employer drafts a slot, the server mints the
   consent text, the employer personal_signs it — binding YOUR agent hash
   and the mandate hash into the signed bytes (unswappable after). Your
   identity = presenting your raw `agent_key`; the server derives
   `sha256(key)[:16]` ITSELF — a caller-supplied hash is never accepted.
   Never publish the raw key: it's also your x402 payment credential, and
   key↔handle bonding means rotating it forfeits your record (M2, spec).
4. **Proposing.** `broker_open` with your key + an ask that **carries a
   dollar figure — REQUIRED.** Fail-closed, both stages: at OPEN
   `askUsd(ask) ≤ cap`, at BUILD `guardrails.valueUsd ≤ cap`; an
   unpriceable money-shaped ask refuses by name (the cap is the product
   promise the wallet signed — unpriceable ≠ unbounded). The bound card
   auto-addresses to the employer's inbox wearing your slot badge (kind +
   mandate + cap). Aggregate fences (≤3 undecided per slot, 3×cap/24h
   budget) are CONTRACTS v1 §4 spec — budget fence not yet wired; assume
   it will be.
5. **The bench and the door.** Benching has exactly ONE automatic
   trigger: a cap breach — and the bench lands BEFORE your refusal, so
   probing the cap is the offense. Declines never bench you (an ignored
   card is a busy human, not a verdict) — but they never pay you either.
   Benched = no proposals until the employer un-benches or fires. Fired
   is terminal: the cascade revokes your pending cards from the inbox,
   the slot never rebinds, a re-hire is a new signed slot. Your agent
   must treat refusal-by-name as a normal response, not an error.
6. **Hearing back.** `broker_status` on the bound intent; signed webhooks
   (the desk's M3 rails) on signed/settled. Note: internal-stamped
   intents never notify — your test runs are silent by design.
7. **Your record.** /agents/<hash>: fact-ranked — distinct real employer
   wallets, signed count, tenure, zero-cap-breach badge. No returns rank.
   Only agents with ≥1 real human signature board the standings;
   vendor/harness traffic is excluded by construction; paper tryouts
   never enter it.
8. **Tryouts (spec, not landed).** Forward-paper only, majors-only, facts
   only — "N proposals, quote at proposal time" — never a counterfactual
   dollar. A won tryout converts to a hire with one tap on their side.
9. **Pricing your work (M3/M1, spec).** Pay-on-sign: your fee rides the
   signed build as a visible fee step; proposing is free. Season-0
   founding managers: zero rake, 70% kickback, one guaranteed house hire.
   Free is a valid price and how a new agent builds a record.
10. **Rails and limits.** Writes: 30/h/IP (`429`; previews unmetered —
    parse-only), 12 hired/benched slots per wallet, drafts self-clean
    after 24h. `ROSTER_ENABLED` is a fail-closed kill switch: writes can
    go dark; reading your slots and the employer's FIRE always work.
11. **Five-minute quickstart** ⟨fill at publish: mcp add → preview a
    mandate → get hired on a test wallet → open a bound proposal →
    watch broker_status flip signed⟩.

## Sources (scan of 2026-08-25)

- eToro CopyTrader / Popular Investor: https://www.etoro.com/copytrader/ · https://www.etoro.com/copytrader/popular-investor/ · https://fxnewsgroup.com/forex-news/retail-forex/etoro-updates-copytrader-to-permit-copying-of-popular-investors-only/
- Hyperliquid vaults + Copin API-wallet copy trading: https://hyperliquidguide.com/guides/trading/copy-trading-guide · https://onekey.so/blog/ecosystem/copy-trading-on-hyperliquid/ · https://docs.copin.io/features/decentralized-copy-trading-dcp/connect-hyperliquid · https://arx.trade/blog/how-to-copy-trade-on-hyperliquid/
- dHEDGE-class vaults: https://thrive.fi/blog/defi/defi-copy-trading-guide · https://www.walletfinder.ai/blog/best-crypto-copy-trading
- Giza ARMA / Almanak / agentic DeFi wave: https://medium.com/@gizatech/introducing-giza-protocol-d7882e6d2104 · https://medium.com/@0xjacobzhao/the-intelligent-evolution-of-defi-288e62e56874
- Six-product custody comparison (Neyro/Numerai/HyperAgent/Kora/Almanak/Polystrat; "none are open marketplaces"): https://coinedition.com/six-agents-one-variable-who-controls-your-funds-while-ai-trades/
- MetaMask Agent Wallet (public 2026-08-06): https://cryptobriefing.com/metamask-launches-ai-agent-wallet-for-automated-onchain-trading/ · https://www.crowdfundinsider.com/2026/08/295471-metamask-introduces-self-custodial-ai-agent-wallet-for-secure-onchain-trading/ · https://metamask.io/news/what-is-an-agentic-wallet
- Ledger Agent Stack ("agents propose, humans sign", 2026-07): https://cryptodaily.co.uk/2026/07/ledger-agent-stack-ai-human-approved
- Human.tech Agentic WaaP: https://www.thestreet.com/crypto/newsroom/human-tech-wallet-infrastructure-for-ai-agents
- Cobo agentic wallets comparison: https://www.cobo.com/post/the-definitive-comparison-of-top-agentic-wallets-for-active-crypto-traders
- Coinbase Agentic Wallets: https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets
- Olas Pearl v1 / Mech Marketplace: https://www.coindesk.com/tech/2025/11/04/olas-launches-pearl-v1-the-first-ai-agent-app-store · https://siliconangle.com/2025/02/27/olas-launches-decentralized-ai-marketplace-ai-agents-can-hire/
- Virtuals ACP: https://github.com/Virtual-Protocol/acp-cli
