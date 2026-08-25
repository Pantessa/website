# ROSTER-STORY.md — the Roster's story, receipts, and scripts

GTM lane, overnight squad 2026-08-25. Mission: `HANDOFF-roster.md`. This doc
is the story we tell (and refuse to tell), the competitive receipts behind
the "never done" claim — including one honest correction — the 90-second
morning demo script for Nate, and the `/docs/roster` outline for agent
builders. Nothing in here posts anywhere by itself; every external act is an
owner item.

---

## 1. The pitch, at three altitudes

**One sentence:** Pantessa is the labor market where you hire AI agents to
run your money — they can only propose, only your wallet can sign, and every
agent's track record is public and unfakeable.

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
did, which can't be faked or padded. If you don't like one, you fire it with
one tap, and there's nothing to claw back because it never held anything.

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
   unfakeable per-agent track records + propose-only *with no autonomy
   threshold at all*. Our story must lead with the league and the labor
   market, with propose-only as the floor that makes an open market safe —
   not as the headline novelty. And speed matters: the wallet vendors are
   one "leaderboard" feature away from the adjacent claim.
2. **Two rows already match one bar each.** Hyperliquid vaults match us on
   unfakeable records (and beat us on liveness — years of on-chain perp
   history); Olas/Virtuals match us on open agent markets. Our moat is the
   conjunction, plus one thing literally nobody has: **records that
   exclude the vendor's own traffic by construction** — every incumbent's
   numbers (and until #650, ours) mix in house/harness volume.
3. **The nuance to keep exact in copy:** several products are honestly
   "non-custodial" (Giza, Copin, MetaMask agent wallet). Never claim
   "everyone else custodies your money" — that's false and checkable. The
   true claim is: *everyone else gives the agent hands — limited hands,
   scoped hands, thresholded hands, but hands. We give it none.*

## 4. Regulatory language guardrails

*(Written solo — Ideation's file had no strategy out yet at drafting time;
reconcile when ROSTER-STRATEGY.md lands and keep the STRICTER line
wherever we differ. Nothing here is legal advice; flag "counsel" items to
Nate.)*

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

**Tryouts are the hot zone.** "Would have made/kept $X" is hypothetical
performance — the most regulated sentence in finance marketing. Every
tryout report, inbox card, and OG image carries a fixed label:
**"Paper tryout — simulated on your real balances. Hypothetical. Not a
prediction, not advice."** Never blend paper numbers with signed history
anywhere (security contract §5 already forbids it in data; this forbids it
in copy). No extrapolation ("that's $520/year"). Counsel item before any
public tryout marketing.

**League copy:** realized, signed history only; drawdown always rendered
beside gains (never a gains-only card); "past performance is not
indicative of future results" on /league and /agents pages; rank by
verifiable facts (signed volume, drawdown, tenure), never by a "score"
that implies a recommendation of one agent over another.

**Business-model copy:** we charge per-proposal software fees and
transaction fees — flat and value-independent in how we DESCRIBE them.
Never describe any fee as "a share of your profits" / "we win when you
win" — performance-linked compensation language walks toward adviser
territory. (x402 rake + take-rate on movement are fine; profit-share
framing is not.) Counsel item before any fee tied to PnL is even hinted.

**Circles:** never "fund," "pool," "treasury," "invest together," "club
account." Say: "a shared shape — everyone signs their own legs from their
own wallet." The no-treasury fact is the regulatory story (no pooled
vehicle); the words must not undo it.

**The Allowance:** never "custodial account for your kid," never "UGMA-
like." Say: "a recurring claimable intent you shape; they can only claim
the thing you shaped, never the wallet." Minor-targeted marketing is a
counsel item; v0 copy targets teams/communities.

**Rebrand disclosure discipline (unchanged):** any outbound that names the
product links pantessa.com/rebrand. The Roster story never ships to a
stranger without it while uniswap-embed.yeetful.com is still listed.

## 5. Pricing narrative

The story in one line: **agents work for per-proposal fees and win work by
track record; Pantessa is the arena and takes the gate.**

- **Per-proposal (x402, M6 rails):** an agent prices its own proposals;
  the employer's wallet pays per accepted proposal (or per proposal-
  delivered, agent's choice); Pantessa takes a rake. Free agents exist —
  the house agents at launch are free, priced agents are the market
  maturing. This is the "aha" for agent builders: a track record converts
  directly into fee-earning mandates.
- **Take-rate on movement (already live):** the 20bps-family venue fees on
  signed transactions are unchanged — the Roster mints MORE signed
  transactions; the north-star metric (money moved) is untouched.
- **Later, not now:** listing/season fees, priority slots. Not in v0 copy.
- **Consumer framing:** "Hiring is free. You pay per proposal you accept,
  a fee shown on the card before you sign — and the network fee of the
  transaction itself. No subscription, no percent-of-assets." (Percent-of-
  assets is the robo-advisor smell; its absence is a differentiator AND a
  regulatory comfort.)

## 6. H1 becomes chapter one

The ten-strangers drill (WEDGE-KIT.md) does not change — and the Roster is
what it was secretly rehearsing. The mapping, exact:

- H1's minted `/i` link IS a proposal card: a shaped, guarded, capped
  transaction landing in front of a specific human who signs or declines.
  A mandate slot is just a standing subscription to cards like that one.
- **The recruit's signed receipt is the first league entry.** Nate's
  @handle mints the link (first-touch attribution, per-link funnel) — so
  the drill's ten signed swaps are, structurally, the first ten entries
  of real, is_internal-clean, stranger-signed volume attributable to one
  named originator. When the league ships, Nate('s house agent) is roster
  entry #1 with a track record that predates the leaderboard — the origin
  story writes itself, and it's TRUE.
- The drill's watch-notes feed the Roster's consumer copy: "why twice,"
  the spending-cap flinch, the felt-like sentences — those are the exact
  fears §2's four layers must answer on the landing page.
- Sequencing: ten strangers sign H1 → three return → THEN the Roster front
  door (R6, behind ROSTER_ENABLED) is worth flipping for cohort two:
  "you signed one proposal; want a standing one?" (H3's DCA ask is
  already mandate #2's shape.)

## 7. Morning demo script for Nate — 90 seconds, local build

Setup (before the clock): local prod build with `ROSTER_ENABLED=true` +
`BROKER_DESK_ENABLED=true`, burner wallet connected, one house agent key in
hand. **Beat-status legend is honest as of 23:00 — re-verify against WRAP
in the morning; QA's integration branch `squad/integration-roster` is the
build to demo on.**

| t | beat | say | status tonight |
|---|---|---|---|
| 0:00 | The mandate | "I write my money policy as a sentence: **'DCA $25 into ETH weekly'** — with a $50 cap. That sentence must round-trip the product's own grammar or it refuses; no LLM interprets it." | R1 lane building (`lib/roster.ts` + slots DDL). If unlanded: type the sentence in chat to show the grammar is real today; mandate slot = mocked. |
| 0:20 | The hire | "I hire an agent into that slot with one signature. Read the consent: it signs the agent's hash and the mandate's hash — *'It moves nothing by itself; every proposal still needs this wallet's own signature.'* That sentence is in the signed bytes." | Consent text spec'd (security CONTRACTS v1 §1); hire flow = R1/UI-UX lanes. If unlanded: show the consent message from the contract doc. |
| 0:40 | The proposal | "The agent goes to work at the desk. Its move lands in MY inbox as a signable card, bound to the slot, cap-checked twice — over-cap refuses by name." | Desk→inbox rails EXIST on main (M5 + #645); slot binding = R2 lane. If unlanded: `broker_send` an addressed intent to the burner — the inbox beat is real tonight, the slot badge is mocked. |
| 1:00 | The pen | "I tap it. Guarded build, independent re-decode, my wallet signs. The agent never saw a key, never had an allowance — fire it and there is nothing to withdraw." | **Real tonight** — /i runtime + inbox + guarded build all on main. Sign with the burner. |
| 1:20 | The league | "That signed receipt lands on the agent's public record — real signed volume only, our own test traffic excluded by construction. That page is why the next wallet hires it. Your wallet gets a staff; you keep the only pen." | /agents/<hash> EXISTS on main (M4); league categories/seasons = R3. Show the existing record page ticking. |
| 1:30 | (if asked) "Is this safe to show?" | "ROSTER_ENABLED is fail-closed and unset on prod — nothing tonight changed production." | True by protocol. |

Fallback 60-second cut (zero roster code landed): beats 3–5 only, on main —
addressed intent → inbox → sign → /agents record. Still a true story:
"tonight's PRs add the employment contract around what you just watched."

## 8. /docs/roster outline — for agent builders (code lanes fill contracts in round 2)

Working title: **"Work a mandate"** — sibling of /docs/desk ("Give your
agent hands"), linked both ways. Outline only; every `⟨R#⟩` is a contract
the code lanes own.

1. **What a mandate is.** A consumer-authored sentence, canonicalized by
   Pantessa's grammar (you never parse it), with: slot id, mandate kind
   (rebalance / dca / protect / yield-park), cap USD, employer wallet,
   your agent's hash if hired. What you can never do: author calldata or
   addresses — you state intents; the deterministic builder + independent
   guard do the rest (same contract as /docs/desk).
2. **Discovery — slots publish to the desk; you don't scrape.** ⟨R2: exact
   surface — broker_capabilities extension or an open-slots feed; auth =
   your agent_key; is_internal rules⟩ Open slots show kind, cap band, and
   anonymized employer context. No wallet addresses in discovery.
3. **Getting hired.** The employer signs a hire consent binding YOUR
   agent_key hash to the slot. Identity = presenting your raw agent_key;
   the server derives the hash itself — never send the hash as identity,
   never publish the raw key (it's also your x402 payment credential).
4. **Proposing.** Open a desk intent bound to the slot ⟨R2: broker_open
   params⟩. Enforced, fail-closed: per-proposal ≤ cap (at open AND build;
   unpriceable money-shaped asks refuse), ≤3 undecided proposals per slot,
   24h proposal budget 3× cap. Over-cap attempts don't just refuse — they
   bench you.
5. **Hearing back.** broker_status + signed webhooks (M3) fire on
   sign/decline/settle. Declines are signal: 3 consecutive = benched, with
   an inbox notice to your employer. Fired = every pending card of yours
   is revoked; terminal for that slot.
6. **Your record.** /agents/<hash>: signed volume, drawdown, mandates
   held, "hired by N wallets" — real traffic only, vendor/harness volume
   excluded by construction. Paper tryout results never enter it. ⟨R3:
   league categories + seasons⟩
7. **Tryouts.** Run a consumer's mandate on paper against their real
   snapshot ⟨R4: how a tryout is requested/entered; quotes-only, server-
   computed; report labeled Paper everywhere⟩. A won tryout converts to a
   hire with one tap on their side.
8. **Pricing your work.** x402 per-proposal pricing (M6 rails), Pantessa
   rake. Free is a valid price and how new agents build a record.
9. **Rate limits, kill switch, safety rails.** rp: hourly fences; max
   slots per wallet; ROSTER_ENABLED — write paths can go dark, firing
   always works. Your agent must tolerate refusal-by-name as a normal
   response.
10. **Five-minute quickstart.** ⟨round 2, after R1/R2 land: mcp add →
    discover a slot → open a bound proposal on a test mandate →
    watch the webhook⟩

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
