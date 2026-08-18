# STRATEGY — squad ideation 2026-08-18: the ten-strangers playbook + agent-builder targeting

*Written by the Ideation/strategy lane of the 2026-08-18 standing squad.
Method: four independent ideators (MVP-first / risk-first /
distribution-first / agent-builder-first) → 12 plays → three judges
(correctness of premise / cost vs time-to-signal / owner-item
independence) → this synthesis. Ground truth was pulled read-only from
Neon (`yeetful` DB), prod (`www.pantessa.com`, `hands-mcp.yeetful.com`),
and the route ladder (`scripts/ask-ladder.ts` on `origin/main` 8f53651)
the same morning. Nothing here adds product surface; every play runs on
what production serves today.*

Sits under `HANDOFF-gtm-bulletproof.md` §3 (the ten-users doctrine) and
`HANDOFF-agent-economy.md` (the moonshot). Supersedes one line of
`CLAUDE.md` § THE WEEK item 7 — see §0.

---

## §0 The one recommendation

**Start tomorrow morning with the watched $20 swap: mint
`Swap $20 of USDC to ETH on Base` on `/links`, hand it one at a time to
ten people Nate can reach directly, screen the wallet first ("MetaMask or
Rabby, and at least $25 USDC already on Base?"), disclose `/rebrand` in
the DM, sit on a 15-minute call with `/dashboard/failures` open, and log
one sentence of what it felt like. Reserve the five-dollar inbox relay
as the follow-on for the same people once they've signed once.**

This CONFIRMS the shape of THE WEEK item 7 — one ask, hand-recruit ten,
watch each one, fix same-day — and REPLACES its ask. "Lead with the Spot
Guardian ask, it works on wallet balances today" does not survive
contact with the code:

1. **Spot Guardian is smart-wallet-only.** The arm is a Coinbase Spend
   Permission; the arm route simulates `approveWithSignature` and the
   code says it plainly (`lib/dca-auto-exec.ts:116`): "A wallet that
   can't back the permission (EOA, wrong signer, bad domain) reverts
   here." Every wallet path we ship produces an EOA — MetaMask, Rabby,
   `coinbaseWallet.preference = 'eoaOnly'` (`lib/wagmi.ts:48`), and the
   CDP embedded email/Google wallets (`createOnLogin: 'eoa'`,
   `lib/cdp-embedded.ts:32`). `spot_guard_policies` has exactly one
   row: the burner's dev drill (status `done`, `last_checked` null). It
   has never been armed in production by anyone.
2. **The natural phrasing routes to the perps guardian.** "protect my
   ETH with a 10% stop loss", "protect my ETH at -8%", and the
   product's own example prompt "Set a stop-loss on my ETH position at
   -8%" all hit the Hyperliquid guardian gate, which tells a spot holder
   to add Hyperliquid or refuses for having no HL position. Only the
   exact chip strings ("protect my **spot** ETH…", "…**in my wallet**…")
   reach the spot gate. (Full table in §6.3.)

The swap wins on every judge's axis: premise (Base USDC in a MetaMask is
the most common thing a crypto-native friend actually holds), cost
(~8 founder-hours, $0–$120, first real signature possible tonight), and
dependencies (zero — it deliberately avoids HL, Spot Guardian, Lido,
email OTP, and the AAPL bridge job). It exercises the first-class
product (an intent link with a real creator and first-touch attribution)
rather than the chat, so a stranger cannot type a variant that falls to
the planner. And each session is decisive per wallet: connect → built →
approve+swap signed, or a named wall in `/dashboard/failures`.

What it cannot do, said up front: **a favor is not demand.** Ten friends
signing $20 proves the funnel works for a real human on a real wallet —
which we have never observed — and nothing about willingness to return.
That is why H2 (the relay: inbox open, a non-Nate mint, the first
"returned" row) and H3 (the DCA circle: the only play that measures a
period-2 return) are queued behind it, not instead of it.

---

## §1 Scoreboard (12 plays, three judges, 1–5 each)

| Play | Q | Premise | Cost/time | Independence | Σ | Fate |
|---|---|---|---|---|---|---|
| 2.1 Twenty dollars, fifteen minutes, screen shared | A | 5 | 5 | 5 | 15 | **→ H1 (merged; its screening filter leads)** |
| 1.1 The $20 swap, twelve people Nate can text tonight | A | 4 | 5 | 5 | 14 | **→ H1 (merged; its contact list)** |
| 3.1 Ten favors, one hop (inbox-addressed swap) | A | 4 | 4 | 5 | 13 | → H1 door (b) + H2 hop |
| 2.2 The five-dollar relay | A | 4 | 4 | 5 | 13 | **→ H2** |
| 4.3 Ten builders sign via their own agent, or from their inbox | A | 4 | 4 | 5 | 13 | → H1 pool + B1 |
| 3.2 The people who already DCA into ETH on-chain | A | 5 | 2 | 5 | 12 | **→ H3 (merged; its honesty about no-push leads)** |
| 2.3 Hands first, desk later | B | 4 | 3 | 5 | 12 | **→ B1 (merged)** |
| 1.2 The DCA circle | A | 3 | 2 | 5 | 10 | → H3 (merged) |
| 1.3 Copy-paste the hands MCP into ten builders' Claude Desktop | B | 3 | 3 | 4 | 10 | → B1 (merged; track-record hook dropped — desk-only) |
| 4.1 The zero-integration door: `claude mcp add` the hands MCP | B | 3 | 3 | 4 | 10 | → B1 (merged; ask swapped to `prepare_handoff` — `mint_intent_link` is `yf_`-gated) |
| 3.3 Plugin authors who build calldata inside an LLM loop | B | 3 | 2 | 4 | 9 | **→ B2 (as watched calls, not posts)** |
| 4.2 Ship the desk as THEIR plugin (AgentKit/GOAT/Eliza PRs) | B | 3 | 1 | 3 | 7 | killed for the 14-day window; month-2 move |

Kill list from the judges: **none** — every ideator had already routed
around the owner-gated items. Judges' consensus notes that changed the
synthesis: (a) the four fastest A plays all draw from the same ~15-person
warm pool and cannot run in parallel without burning it → ONE swap play,
relay as follow-on; (b) 14 days is structurally too short for a
quantitative "a builder wired it for real users" verdict → the honest B
signal is qualitative (a DM asking "can my agent sign?"); (c) flip
`BROKER_DESK_ENABLED` before ANY builder outreach — today a curl to
`broker_open` on prod returns "not accepting new intents" (verified
09:xx UTC 2026-08-18) and a builder who hits that is gone; (d) #645
(inbox + "Send it to someone") and #647 (HL delegated sign) are both
merged AND deployed — the only code-merge dependency anyone named is
already closed; (e) the premise judge's structural catch on the B side:
the hands MCP is keyless and live ONLY through `prepare_handoff` —
`mint_intent_link` demands a `yf_` key (free-mcps `lib/mint-link.ts`)
and the `/agents/<hash>` track record belongs to the DESK, which is off
in prod — so the honest B pitch this week is "human-signs handoff, no
keys, no record page yet"; and (f) `send 5 USDC to @handle on base` does
NOT parse — the transfer grammar takes `0x`/ENS only; @handle works only
in the mint stage's "Send it to someone" field.

Where plays merged, the merged play inherits the best-scored version's
design (2.1's screening filter, 1.1's contact list, 3.1's addressed-inbox
door, 3.2's no-push honesty).

---

## §2 The top three plays for humans (question A)

Each is a checklist Nate could start tomorrow morning. Messages are in
his plain build-in-public voice; no hype. All money is the tester's own
unless marked; anything Nate spends is a rule-4 consent item, listed as
such.

### H1 — The watched $20 swap (start here)

**Who:** Nate's own first ring — ex-coworkers, hackathon teammates,
Farcaster mutuals who visibly transact on Base, people from the
personal.computer forum and the job-hunt network who are in crypto. DM,
never post. If the ring runs dry after ~15 DMs, ONE narrow public pool
where a paid usability test is normal: Base Discord `#builders` or the
Farcaster `/base` channel — still by reply/DM, still one at a time.

**The screen (ask before booking):** "MetaMask or Rabby, and at least $25
USDC already sitting on Base?" If they'd have to bridge or would sign in
by email, they are not this week's user — that is a different play with
a different wall (funding cascade / unproven OTP). Write down who
failed the screen and why; that list IS the next round's target.

**Checklist**
1. On `/links`, mint `Swap $20 of USDC to ETH on Base` under Nate's
   claimed @handle (so the link is a real creator link with first-touch
   attribution, not a house link). Copy the `/i/<slug>` URL. Optionally
   mint a second, addressed copy per tester with "Send it to someone"
   (their 0x or @handle) — it lands in `/inbox/<their address>`; that is
   H1 door (b) and it seeds H2. For testers who hold ETH but no USDC on
   Base, mint the mirror link `Swap $20 of ETH to USDC on Base` — do NOT
   hand them the USDC→ETH link (the funding cascade would offer a silly
   ETH→USDC→ETH detour).
2. Open two tabs: `/dashboard/failures?funded=1` and
   `/dashboard/admin` (the strangers arc). Note today's numbers by hand
   before the first call — the arrival tables are not `is_internal`
   stamped yet, so the aggregate is untrustworthy; track the ten
   addresses individually.
3. Send the DM (template A below). Wait for a yes AND a wallet answer.
4. 15-minute call, screen shared. They open the link on their own
   machine. Say nothing until they're stuck. Watch: does MetaMask throw
   an interstitial on `www.pantessa.com`; does the connect modal make
   sense; do they read the built swap card; approve → swap (two
   signatures — note whether "why twice" comes out of their mouth); the
   receipt; the "Sign in & save" bar (do NOT push it — connect-to-act
   is the model, SIWE is theirs to want).
5. Ask the one question, verbatim, and write the answer down: "What did
   that feel like, and where did it feel wrong?"
6. Same day: every wall → `/dashboard/failures` row → fix PR (the
   #595/#621 pattern). Every "felt wrong" → the UI/UX lane.
7. If they signed and weren't annoyed: hand them H2 (the relay) on the
   spot — "want to send $5 to someone from here?" — one hop, no pressure.

**Template A (DM, ~80 words):**
> Building a thing that turns one sentence into a guarded transaction
> your own wallet signs — nothing custodied, I never see keys. Nobody
> outside me has used it yet and I want to watch ten people try. 15
> min on a call, you swap $20 USDC→ETH on Base with your own MetaMask,
> tell me what felt off. Full disclosure first: pantessa.com/rebrand —
> we were Yeetful and an old demo subdomain got blocklisted. Read it,
> then decide. Say no freely.

**Optional (rule 4, Nate's call):** "I'll cover gas plus $10 for your
time" — pay it as `send 10 USDC to <their addr> on base` from Nate's
wallet through the product (a dogfood, and a second real signature in
the log). ~$120 across ten.

**Metric:** ten distinct non-Nate wallets with `outcome='signed'` on the
swap slug, `is_internal` false, real origin; time connect→first
signature per wallet; zero `wallet-refused` rows; the ten one-sentence
answers. **Falsification:** if fifteen DMs can't book five calls whose
wallets pass the screen, the pool is empty — that is a 48-hour clean
result and it says "recruit from where Base USDC lives", not "build".

**What kills it:** the pool holds ETH on mainnet or on a CEX, not Base
USDC in an EOA (→ the screen catches it early); a Blockaid/Coinbase
"new domain" interstitial; someone screenshots a `*-mcp.yeetful.com`
hostname; friends being polite instead of honest (→ the disclosure and
"say no freely" are there to buy honesty).

**Owner-gated dependencies:** none.

### H2 — The five-dollar relay (the follow-on that buys three signals nobody has ever seen)

**Who:** the H1 testers who signed, plus ONE existing private group
chat Nate is already in (8–12 former colleagues / a hackathon crew).
Not a public channel. Money comes back around, so nobody risks more
than a coffee.

**The ask:** `send 5 USDC to <next person's 0x or ENS> on base` — the
sentence must carry a `0x`/ENS recipient (the transfer grammar does not
take @handles); the @handle goes in the "Send it to someone" field.
Nate mints it on `/links` addressed to person A; it lands in `/inbox/<A>`; A opens, connects, signs; A then mints the
next hop to B from the link page (that mint = a return visit + a
non-Nate creator + a SIWE); the last hop comes back to Nate. Fallback if
anyone can't find the inbox: the plain `/i` link in the DM.

**Checklist**
1. Verify once on prod that `/inbox/<Nate's address>` renders an
   addressed intent (send one to yourself; revoke after).
2. Order the chain in the group; each person needs the next person's
   address or claimed @handle.
3. Send template B to the group; then DM person A the inbox URL.
4. Watch per hop: inbox open → connect → built → signed; did they find
   the inbox unaided or need the URL; did the mint step happen (a
   non-Nate creator, for the first time in 3,057 links); did the
   "returned" column move.
5. Any hop that stalls >24h: DM, ask why in one line, log it, unstick
   with the plain link. The stall reason is the finding.

**Template B (group chat, ~70 words):**
> Small experiment, $5 each, the money comes back around. I'll drop a
> signable "send 5 USDC to <name>" in your wallet inbox on pantessa.com
> — you connect, check the numbers, sign with your own wallet, then
> mint the next hop to the next person from the link page. I'm watching
> every step and want to hear where it felt weird or sketchy.
> Background first, please read: pantessa.com/rebrand.

**Metric:** hops completed / hops attempted; inbox-open rate without
the URL; count of intent_links minted by non-Nate wallets (today: ~0);
first non-zero "returned" in the strangers arc. Cost: ~3 founder-hours,
$5 float + ~$2 gas.

**Honest limits:** a transfer isn't fee-bearing, so this proves nothing
about kickbacks; it buys inbox + return + non-Nate-mint proof. One
stalled hop kills the chain ambiguously — unstick with the plain link
and keep going.

**Owner-gated dependencies:** none (#645 merged and in production,
verified 2026-08-18).

### H3 — The DCA circle (the only play that measures a return)

**Who:** the self-custody ETH-accumulator crowd, recruited by reply/DM
not broadcast: r/ethereum's Daily General Discussion regulars (honest
"I built this, need testers" is tolerated; ask a mod first), EthStaker
Discord `#offtopic` (mod-first), Bankless Discord `#defi`, Farcaster
`/base` and `/ethereum` casters who post their weekly buys. Run it with
a DIFFERENT pool than H1 so the warm ring isn't burned twice.

**The ask:** the house link `/i/dca-eth` → `DCA $25 into ETH weekly`
(confirm-mode: each UTC period compiles one signable Uniswap buy on
Base; no key custody, no standing approval; period 2 = the return).

**Checklist**
1. Confirm `/i/dca-eth` on prod builds period 1 for a wallet with Base
   USDC (do it once with the burner; it is a house link, harness-safe).
2. Three mod-cleared posts / ~10 DMs with template C. Reply to every
   comment. Never argue.
3. Watch: `dca_schedules` from non-internal wallets; period-1 signed;
   period-2 signed (≥7 days later — the metric); anyone typing their own
   cadence ("$50 every Friday") and whether it parsed (§6.2 shows
   "set up a weekly $10 ETH buy" falls to the planner today).
4. Day 6: DM each period-1 signer a one-line heads-up that period 2 is
   due — there is NO push in the product (no mail, no notification;
   the due chip only shows when they reopen /chat). Say this in the
   post; it is the honest limitation and the thing that would kill it
   silently otherwise.

**Template C (post/DM, ~90 words):**
> Built a non-custodial DCA: "DCA $25 into ETH weekly" becomes a
> schedule where each week's buy is compiled for your wallet and you
> sign it — no bot key, no unlimited approval, calldata independently
> re-decoded before you see it. Real money moved so far: about $7.6k,
> mostly mine. Looking for ten people to run two weeks of it and tell me
> where it breaks. There's no reminder yet — I'll DM you when week two
> is due. Link: pantessa.com/i/dca-eth. I'll fix same day.

**Metric:** period-2 signed / period-1 signed. Anything >0 is the first
"returned" row from someone we didn't hand-hold. Cost: ~4–5
founder-hours, $0.

**What kills it:** the crowd DCAs from fiat on Coinbase/Kraken and holds
no on-chain USDC (→ funding chips fire; log it, don't chase it); a mod
deletes the post; 20bps on Base reads as a step down from free CEX
recurring buys (→ the answer is custody, say it once, don't sell).

**Owner-gated dependencies:** none. Mail would let period-2 reminders
exist; it doesn't this week — the DM is the reminder.

---

## §3 The top two plays for agent builders (question B)

**Precondition for BOTH (owner, one minute):** set
`BROKER_DESK_ENABLED=true` on the website Vercel project. Verified this
morning: `broker_capabilities` answers on prod, `broker_open` returns
"The Pantessa agent desk is not accepting new intents right now." A
builder who curls that is gone. Second, cheaper-still: set
`PANTESSA_API_KEY` on the hands-mcp Vercel project so `mint_intent_link`
works keylessly (today it demands a `yf_` key; `prepare_handoff` is
keyless and is the door we lead with regardless).

**Honest framing (from the cost judge):** 14 days is too short for a
quantitative "three builders wired it for their users" verdict. The
decisive tell inside 14 days is qualitative — a builder who tries the
hands door and then asks "can my agent sign?" is desk demand. Count
those DMs.

### B1 — The zero-integration door: `claude mcp add` + `prepare_handoff`

**Who (named pools, DM by name, don't post first):** contributors with
merged action providers in `coinbase/agentkit` and the CDP Discord
`#agentkit`; ElizaOS Discord `#plugin-dev` (plugin-evm / plugin-hyperliquid
/ plugin-lifi maintainers); GOAT SDK plugin authors; OpenClaw `#skills` /
ClawHub authors publishing wallet or DeFi skills; Claude Code plugin
authors (anthropics/claude-code Discussions, `awesome-claude-code` /
`awesome-mcp-servers` maintainers); the MCP Discord `#showcase`;
PulseMCP's weekly new-servers list; anyone who posted a "my agent
trades" demo on Farcaster `/ai-agents` in the last 30 days.

**The ask they're handed:**
```
claude mcp add --transport http pantessa-hands https://hands-mcp.yeetful.com/mcp
```
then, in their agent: *"call what_pantessa_can_do, then prepare_handoff
for 'Swap $20 of USDC to ETH on Base' and give me the link"* → their
agent returns `https://www.pantessa.com/sign?ask=…` → they open it,
their wallet signs. Second ask: `scan_wallet` on their own address, then
`prepare_handoff` for `send 5 USDC to <addr> on base`. Then point them at
`/docs/desk` for the stateful sibling (`broker_open` → quote → handoff →
`broker_status` / signed webhook → `/agents/<hash>` record).

**Checklist**
1. Owner flips `BROKER_DESK_ENABLED` (and ideally `PANTESSA_API_KEY` on
   hands). Re-curl `broker_open` on prod until it accepts.
2. Record ONE 90-second screen capture: `claude mcp add` → the two tool
   calls → the sign page → the receipt. No voiceover needed. Host it on
   the `/docs/desk` page or the DM.
3. Pick 10 named people from the pools above (commit history + Discord
   roles, not follower counts). Template D, one at a time.
4. Self-serve listings, same sitting (no owner gate): Glama, Smithery,
   mcp.so, PulseMCP submission, `awesome-mcp-servers` PR. The official
   registry + Anthropic connector directory stay OWNER (namespace
   verification) — listed in §5.
5. Watch: hands-mcp Vercel invocation logs (tool mix — `what_pantessa_can_do`
   only = looked, didn't act); `/sign?ask=` opens whose ask came from an
   agent and their sign rate; `intent_links` created by a non-house
   creator; `broker_intents` rows whose `agent_key_hash` isn't ours;
   `/agents/<hash>` pages with non-zero handoffs (desk-only — a hands
   builder gets no record page, so never promise one in the DM); and the
   DMs that ask "can my agent sign?".

**Template D (DM, ~85 words):**
> If your agent has ever needed to move money and you didn't trust it
> with a key: I built an MCP where the agent only ever produces a
> sentence and a sign link. It compiles the trade for the human's
> wallet, an independent guard re-decodes it, the human signs. One line
> to add — `claude mcp add --transport http pantessa-hands
> https://hands-mcp.yeetful.com/mcp` — then ask it to prepare "Swap $20
> of USDC to ETH on Base". Docs: pantessa.com/docs/desk. Tell me where
> it broke. Background: pantessa.com/rebrand.

**Metric:** three builders who (a) called `prepare_handoff` or
`broker_open` from a key/IP that isn't ours AND (b) replied with what
was missing. Secondary: one `/agents/<hash>` page with a real handoff.
Cost: ~6 founder-hours, $0.

**What kills it:** the host is `hands-mcp.yeetful.com` — a builder who
googles "yeetful" finds the MetaMask listing of the sibling subdomain
(→ the DM carries `/rebrand` up front for exactly this); they want the
AGENT to sign (→ that's the desk's `broker_execute`, and the ask
converts to B2); the desk still refuses (→ the flip is the precondition,
not a hope).

**Owner-gated dependencies:** `BROKER_DESK_ENABLED` (hard for the desk
half; the hands half runs today); `PANTESSA_API_KEY` on hands (soft);
official registry + connector directory (soft, §5).

### B2 — Desk on a call: three named builders wire `broker_open → handoff → webhook` in front of Nate

**Who:** three humans picked BY NAME from recent commits: one
`coinbase/agentkit` action-provider contributor, one ElizaOS
`plugin-evm` maintainer, one GOAT SDK plugin author (or an ERC-8004
"trustless agents" working-group builder — the track-record page is the
reputation feed they lack). Not maintainers of the frameworks (their PR
queues are weeks long — that is why 4.2 was killed for this window),
but the people who ship plugins on top of them.

**The ask:** on a 30-minute call, they add
`https://www.pantessa.com/api/broker/mcp`, call `broker_capabilities`,
`broker_open` with `Swap $20 of USDC to ETH on Base` (real quote back),
`broker_handoff` (sign link + `/agents/<hash>` record URL +
`callback_url` for the signed webhook), and their own wallet signs the
link. Nate watches `broker_status` flip to SIGNED and the webhook land.
Then the real conversation: what would their users need — human handoff
or agent-signed legs (`broker_execute` with a bound `agent_key`)?

**Checklist**
1. Precondition: `BROKER_DESK_ENABLED=true` live. Run
   `scripts/desk-demo.ts` against prod ONCE with `x-yf-internal-run: 1`
   to prove the loop is green the morning of the first call.
2. Three DMs (template E). Book 30 minutes each.
3. On the call: they drive, Nate narrates only the contract
   (sentences-and-links; no calldata ever crosses the wire; the guard
   re-decodes; the human signs). Let them try to make the desk return
   tx material — the hex-scan pin is the demo.
4. Log verbatim: what they'd need to ship it; whether "agent signs its
   own legs" is the ask; what pricing they'd tolerate (x402 pennies is
   the config; the number is Nate's dial).
5. After: one follow-up DM with the exact thing they asked for, if it
   exists (most of it does — see `/docs/desk`).

**Template E (DM, ~80 words):**
> Your plugin already lets an agent trade. Ours never lets the model
> write calldata: the agent states the intent over MCP, we compile and
> independently re-guard it, the human gets a sign link, you get a
> signed webhook back, and the agent gets a public track record nobody
> can fake. Free right now. Would you spend 30 minutes wiring it on a
> call with me this week and telling me what your users would actually
> need? Docs: pantessa.com/docs/desk. Background: pantessa.com/rebrand.

**Metric:** three calls held; three `broker_intents` rows with a foreign
`agent_key_hash` and `signed` status; three verbatim "what we'd need"
answers. Cost: ~6 founder-hours (DMs + three calls), $0.

**What kills it:** desk unflipped; they want autonomy and won't accept
human handoff even as v1 (→ `broker_execute` exists — show it, note the
policy conversation); MetaMask on the human side if their ask is a perp
(→ keep the ask to the swap).

**Owner-gated dependencies:** `BROKER_DESK_ENABLED` (hard, one minute).

---

## §4 What we killed and why (appendix)

| Candidate | Why it's out this window |
|---|---|
| **Spot Guardian as the lead ask** (THE WEEK item 7) | Smart-wallet-only (Spend Permission `approveWithSignature` reverts for EOAs — every wallet path we ship is an EOA); never armed in prod by anyone; natural phrasing routes to the HL perps guardian (§6.3). Runnable only for a Coinbase Smart Wallet holder typing the exact chip string — not a population we can hand-recruit ten of in 14 days. Keep the ask; fix the wallet story first (either support EOAs via a different mechanism, or lead the sign-in modal to a smart account for this flow). |
| **HL "2X long + 5% stop" flagship** | The most signatures of anything we ship (deposit + leverage + order + guardian delegation); #647 merged today so MetaMask CAN sign via delegation, but the fee wall self-heals only because the treasury is $0 (fee-less builds) and the treasury/env is owner-gated. Four funded walls in ask_failures on this ask family. Not a first-impression ask. |
| **`/i/stake-eth` "Stake 0.05 ETH with Lido"** | Seven ask_failures rows, three funded — the Lido layer claims it and refuses honestly: 0.05 ETH + mainnet gas ≈ $200 on L1 and every stranger held less. Sized wrong for a stranger; Lido is mainnet-only. Also mislabelled `planner-answer` (build_path null on the refusal path) — QA. |
| **`Buy $10 of AAPL` as the lead** | Works, but two signatures (bridge + buy) and the #641-class fill risk (a real stranger's buy step reverted on 08-12). Fine as a SECOND ask for someone who signed the swap; not the door. |
| **The credibility blog post now** ("our interface got blocklisted; the guard is the product") | Publishing invites verification, and today verification shows `uniswap-embed.yeetful.com` still on both lists, no NEW MetaMask issue filed, `@pantessa/guard` unpublished, and a blocklisted-host → 307 → new-domain chain that a security reader parses as rotation. A researcher escalating instead of admiring is the terminal outcome. The safe surrogate is the private, up-front `/rebrand` disclosure in every DM (which every template above carries). Revisit after the new MetaMask issue is filed and the guard is published (§5-B in gtm-bulletproof). |
| **4.2 Framework PRs (AgentKit / GOAT / Eliza providers)** | Right move, wrong window: maintainer queues run weeks; a merged provider ≠ a user; hard desk-flip dependency. Month-2 move once B1/B2 produce a builder who wants it. |
| **Unsolicited inbox sends to strangers' public wallets** | "Sign this thing I sent you" from a domain that 307s off a blocklisted host IS the drainer pattern. The inbox is a hop mechanic for people who asked, never an outreach mechanic. |
| **Reddit/Discord broadcast posts, KOL DMs, launch thread** | The doctrine (gtm-bulletproof §3). H3's mod-cleared "need testers" posts are the only public writing allowed, and only because the crowd is defined by already doing the trade. |
| **Email/Google sign-in as a door** | Unproven end to end (no MX/DKIM on pantessa.com; OTP never received on the new domain). The screen in H1 excludes it on purpose. |
| **Any new venue, MCP, or surface** | gtm-bulletproof §7. Nothing above needs code except the QA findings in §6. |

---

## §5 Owner items surfaced by this round (Nate only — never executed by a lane)

1. `BROKER_DESK_ENABLED=true` on the website Vercel project — one
   minute; precondition for both B plays. (Verified today: prod
   `broker_open` refuses.)
2. `PANTESSA_API_KEY` (a `yf_` key) on the hands-mcp Vercel project so
   `mint_intent_link` works keylessly; otherwise lead with
   `prepare_handoff` only.
3. Official MCP registry + Anthropic connector directory submissions
   (`registry/*.server.json`, namespace verification) — soft for B1.
4. THE WEEK items 1–2, 5–6 (NEW MetaMask issue, HL fee env, mail, Neon
   rebrand) — unchanged, still owner; none of H1–H3/B1–B2 waits on
   them.
5. Rule-4 consent, if wanted: $10 per H1 tester + gas (~$120), the $5
   relay float.

---

## §6 Ask inventory for the top play (read off the route ladder today)

Method: `scripts/ask-ladder.ts` is the pure replica of `app/api/chat/route.ts`
gate order (vote → aave → dca → jobs → mosaic → rebalance → spot-guard →
guardian → lido → hyperliquid → rh-bridge → nft → transfer →
swap/cross-chain → planner). Every ask below was run through
`simulateLadder()` on `origin/main` 8f53651 (2026-08-18). "planner" = no
native gate claimed it = the LLM answers prose = a dead end for a money
ask = **FINDING FOR QA**. Caveat: the sim has no chain picker and no
working-set filter; the real route may resolve a chain from the picker
where the sim says "clarify".

### 6.1 The five a stranger is most likely to type at the $20 swap door

| # | What they type | Gate hit today | Outcome | Verdict |
|---|---|---|---|---|
| 1 | `swap $20 of usdc for eth` / `Swap $20 of USDC to ETH on Base` | swap | action — $20 USDC→ETH (Uniswap v3, guarded, approve+swap chain) | works |
| 2 | `buy $20 of ETH` / `get me $20 of ETH` / `i want $20 of ETH` | swap | action — $20 (chain stable)→ETH | works |
| 3 | `buy $20 eth on base` (no "of") / `buy some eth` | **planner** | prose | **QA FINDING** — the dollar-buy grammar needs "of"; a one-word omission drops a funded ask to the LLM |
| 4 | `swap usdc to eth` (no amount) | swap | clarify — "Say the amount and pair…" | acceptable (a clarify with chips is a door, not a wall) |
| 5 | `sell $20 of ETH` / `sell 0.01 ETH` | swap | action — ETH→stable (CoW order, one signature) | works |

### 6.2 The next ring — what the same stranger types after the first sign

| What they type | Gate | Outcome | Verdict |
|---|---|---|---|
| `send 5 USDC to nate.eth on base` | transfer | action | works |
| `send $5 to nate.eth` (dollar-denominated, no token) | **planner** | prose | **QA FINDING** — dollar sends fall through |
| `pay nate.eth 5 usdc` | **planner** | prose | QA finding (minor — "pay" verb not in the transfer grammar) |
| `send 5 usdc to 0x…` (no chain) | transfer | clarify "which chain" (sim has no picker; the route uses the picker chain) | acceptable |
| `DCA $25 into ETH weekly` / `buy $10 of ETH every week` | dca | action — schedule | works (return visit = period 2) |
| `set up a weekly $10 ETH buy` / `dca into eth` | **planner** | prose | **QA FINDING** — cadence phrasings without "every/weekly" + amount fall through |
| `Buy $10 of AAPL` / `buy $10 of tesla` | swap→robinhood | action (2 signs: bridge + buy) | works; not the lead ask |
| `buy 1 share of AAPL` | swap | clarify (dollar sizing) | acceptable |
| `move 5 usdc from base to arbitrum` | cross-chain | action | works |
| `bridge 5 usdc to arbitrum` | cross-chain | clarify "from which chain" | acceptable |
| `bridge $5 to base` | **planner** | prose | QA finding (minor) |
| `tile my wallet 50% ETH 50% USDC` | mosaic | action | works |
| `make my wallet 60% ETH 40% USDC` / `split my wallet 50/50 ETH USDC` | **planner** | prose | **QA FINDING** — MOSAIC only answers to the verb "tile"; nobody says "tile" |
| `sell my eth when it hits $4000` / `limit order sell 0.1 eth at 4000` | swap | clarify (limit-order shape not parsed as a CoW limit order) | **QA FINDING** — the CoW limit-order grammar exists but this shape isn't recognized |
| `what can you do` / `help` / `show my portfolio` / `what do I own` | planner | prose (portfolio card via the wallet MCP tool) | expected — planner is right here |

### 6.3 The protection family — why "lead with Spot Guardian" cannot be the play this week

| What they type | Gate | Outcome |
|---|---|---|
| `Protect my spot ETH with a 10% stop loss` / `Protect my ETH in my wallet with a 10% stop loss` | spot-guard | action — the arm card (Spend Permission on Base; EOA arm reverts) |
| `protect my ETH at -8%` / `protect my ETH with a 10% stop loss` / `stop loss on my ETH at $3000` | **guardian (Hyperliquid perps)** | add-Hyperliquid door, or "no HL position" refusal |
| `Set a stop-loss on my ETH position at -8%` — **the product's own example prompt** (`lib/examples.ts:43`) | guardian (HL) | same |
| `sell my ETH if it drops 10%` / `watch my ETH and sell if it falls 10%` | swap | clarify — "Say the amount and pair…" |
| `put a stop loss on my ETH` / `protect my USDC` | **planner** | prose |

The two facts on top of the routing are in §0. Net for QA/UI: the
example prompt in `lib/examples.ts:43` sends a spot holder to a perps
door; and if the spot chip is ever surfaced to a stranger, the arm card
must say "needs a smart wallet" BEFORE the signature, not revert after.

### 6.4 The house links, as strangers actually met them (ask_failures, real rows)

- `/i/stake-eth` — "Stake 0.05 ETH with Lido": **7 rows** (07-27 →
  08-12), 3 with `had_funds` TRUE. Not a routing miss — the Lido layer
  claims it and refuses honestly ("really needs ~0.052 ETH on
  Ethereum… wallet holds 0.0063"). Sized wrong for a stranger. Rows are
  stamped `planner-answer` with `build_path` null — the refusal path
  never stamps its build path, so `/dashboard/failures` mislabels a
  native wall as a planner miss (QA).
- `/i/protected-long` family — 4 funded rows 07-23 (pre-#549 era) + "I
  want to buy some HYPE and 2x long" → planner on 08-12 ($21 idle) — the
  bare shape without "on Hyperliquid" isn't parsed. QA: the HL parser
  should claim "buy some HYPE and 2x long" or the missing-MCP door
  should.
- "tile my wallet 42% ETH, 39% DAI, 19% CETH on ethereum" ×2 (08-12,
  $2,140 idle) — MOSAIC walled on the unknown ticker CETH. A named
  refusal is right; the reply should offer the tile with the two known
  slices as a chip.

---

## §7 What this round did NOT decide (for Nate)

- **§5 of gtm-bulletproof (Path A consumer / Path B guard-as-infra) is
  still Nate's fork.** Every play above is compatible with either; B1/B2
  lean B, H1–H3 lean A. The doc's earlier recommendation ("B as the
  wedge, A as the showcase") is unchanged by this round.
- **Whether to make Spot Guardian EOA-capable** (a different mechanism
  than Spend Permissions — e.g. a one-shot allowance + our spender, with
  the guard's own floor) or to route the sign-in modal to a smart account
  for that flow. It's the best-differentiated consumer ask we have and
  it is currently unreachable by every wallet we onboard. Product call,
  not this lane's.
- **The desk's public name and x402 price** — owner items from
  HANDOFF-agent-economy §3; B1/B2 run free.

---

## §8 Round 2 — H1 premortem: assume 6 of 10 strangers failed. Why?

*Method: read the /i runtime (`components/IntentRuntime.tsx`), the swap
gate + `prepareSwapTurn` (`app/api/chat/route.ts` ~L1701–1810, ~L3985),
the Uniswap builder (`lib/uniswap-venue.ts`), `SendTxChain`/`SendTxButton`,
`lib/wallet-refusal.ts`, `lib/wagmi.ts`, `lib/cdp-embedded.ts`; live CoW
quotes on Base; prod page probes. Ranked by likelihood on a STRANGER's
machine. "Seen?" = does `/dashboard/failures` (or the /i funnel) show it.*

**First, one fact that reshapes the whole list:** the H1 link does NOT
touch CoW. The venue rule (`route.ts` ~L1798) is `uniswap` when the
message says uniswap OR when Uniswap is in the working set and CoW isn't;
`composeMcps("Swap $20 of USDC to ETH on Base")` yields `uniswap-free`
only. So H1 = Uniswap v3 on Base, exact-amount `approve` to SwapRouter02
+ `swap` (with `unwrapWETH9`), two `eth_sendTransaction`s in one
self-advancing card. And "on Base" in the sentence means the picker is
irrelevant: a chain named in the message wins (`namedNative`,
`route.ts` ~L1718).

| # | Failure on the stranger's machine | Seen in /dashboard/failures? | Smallest pre-drill fix |
|---|---|---|---|
| 1 | **USDC on Base but ZERO ETH on Base for gas.** `prepareSwapTurn` pre-reads only the SELL token balance for ERC-20 sells (`route.ts` ~L3985: `needTotal` adds a gas floor only when `isEthSell`). The approve tx is built and offered; MetaMask shows "insufficient funds" / the send fails. | **NOT seen.** `SendTxButton` catches the error and paints it red locally; only `SignHlActionButton` calls `reportWalletRefusal` (`grep -rl wallet-refusal components` → one file). The /i funnel shows built-not-signed and nothing else. | GTM: the screen adds "…and a little ETH on Base for gas". QA (small): pre-read native balance for ERC-20 sells and answer with the #549 stranded-funds copy ("your USDC's there — send a little ETH to Base"). QA (small, high value): wire `reportWalletRefusal` into `SendTxButton` for artifacts `tx`/`tx-chain` (and `SignOrderButton` for `cow-order`) so wallet-side failures land as `wallet-refused` rows BEFORE the drill. |
| 2 | **Two prompts, one is "Spending cap request".** Step 1 is an exact-amount `approve(SwapRouter02, 20 USDC)` (`lib/uniswap-venue.ts:311` — good: not unlimited). MetaMask renders it as a spending-cap screen with an editable cap; a stranger reads it as "the payment" or edits it. Then step 2 **auto-fires** the moment step 1 confirms (`SendTxChain` `autoFire={i > 0}`), i.e. ~2s later on Base, while they're still reading the first receipt → "why is it asking again / is this a drainer?" | Partially: a rejected step 2 = built-not-signed in the funnel; the words aren't captured. | GTM: say it on the call before they click — "two prompts: approve exactly $20, then the swap; the second appears by itself." UI/UX: the chain card already lists both steps up front; add one line under step 1: "Next: the swap will pop up automatically once this confirms." |
| 3 | **Chain switch prompt before anything else.** Wallet is on Ethereum/Arbitrum; `SendTxButton` calls `switchChainAsync` → MetaMask "Allow this site to switch the network?" — a stranger who declines gets "Switch the wallet to Base and retry" (`SendTxButton` ~L83). Some MetaMask versions bundle switch+send; the /i page has no chain picker in simple mode. | Not seen (client-side error, no beacon). | GTM: screen already implies Base; tell them "it'll ask to switch to Base — say yes." Covered by fix #1's refusal wiring. |
| 4 | **The door offers email/Google, and email is unproven.** The /i CTA "Connect & build my path" opens the unified modal (`CreateAccountButton walletConnectOnly`) — wallet lead + Google + email. A tester who picks email hits the OTP lane that has never been received on pantessa.com (no MX/DKIM). | Not seen at all (no wallet, no ask, no row). | GTM: the DM says "your own MetaMask"; on the call, point at the wallet lane. UI/UX (policy call): on /i, until MX lands, either hide the email lane or label it "beta". Owner: prove OTP once (THE WEEK item 5). |
| 5 | **"Did it work?" — no visible ETH arrival.** After both steps the card says "Done — every step confirmed on-chain" + explorer links; the /i runtime shows the signed/settled banner and the "Sign in & save" bar. Nothing on the page says "you now hold 0.0105 ETH (was 0)". Testers open MetaMask to check, or ask. | Not a failure row; shows as signed. | UI/UX (small): after `settled`, one line from the wallet tool: "ETH on Base: 0.0105 (+0.0105) · USDC: 5.00 (−20.00)" — the chat already re-reads balances post-swap via the Pantessa Wallet tool; the /i simple mode doesn't surface it. GTM: on the call, have them open MetaMask's activity — and note that as a friction. |
| 6 | **"Sign in & save" reads as a THIRD signature.** Post-receipt bar → SIWE `personal_sign`. A stranger who just signed two txs sees a message-signature request and thinks something went wrong. | Not seen. | GTM: don't push it; if they click, explain it's optional and keeps the thread. UI/UX: copy already says "Want to keep it?"; consider "optional" in the label. |
| 7 | **The disclosure scares them off** — `/rebrand` in the DM ("we were blocklisted") loses some yeses before the link is opened. Note: the /i page itself carries NO "Formerly Yeetful"/`/rebrand` link (simple mode has no footer; verified on prod HTML), so a tester who Googles finds the aggregator listing without our framing. | Not seen (never arrived). | GTM: keep the disclosure (honesty > yes-rate; it also filters for the honest testers we want) and COUNT the "no because of rebrand" separately — that number is the cost of the blocklist, and it belongs in the MetaMask issue. UI/UX (tiny): a one-line "Formerly Yeetful — read why" link in the /i footer so the page carries its own framing. |
| 8 | **Rabby / two injected wallets.** `injectedWallet` + `metaMaskWallet` are both listed; with MetaMask AND Rabby installed, Rabby's "default wallet" takeover means the "MetaMask" entry opens Rabby (or vice-versa) and the tester signs from the wrong account (the 07-23 "Yeeterson" class — the popup wallet ≠ the connected wallet). | Not seen; the swap is built for the connected address, the other wallet just fails/has no funds. | GTM: screen asks WHICH wallet, and "only one wallet extension on"; on the call, read the connected address aloud against MetaMask. |
| 9 | **Mobile.** No WalletConnect project id in the local env (`NEXT_PUBLIC_WC_PROJECT_ID` unset locally; prod unknown) → on a phone the only working path may be "open the link inside MetaMask mobile's browser". A tester who opens the DM link in Safari sees a modal with no wallet that can connect. | Not seen. | GTM: "desktop, please" in the DM — or "open it in the MetaMask app's browser". Owner/QA: verify WC on prod (`NEXT_PUBLIC_WC_PROJECT_ID`) — if unset, that's a one-line env. |
| 10 | **MetaMask "likely to fail" sim race.** Mitigated: `SendTxButton` waits 750 ms after a chain switch before opening the sheet, and `SendTxChain` waits for allowance visibility before re-quoting step 2 (`SendTxChain` ~L57). Residual: the swap step is refreshed (`POST /api/tx/refresh`) right before it fires — if the re-quote fails it falls back to the prebuilt calldata whose slippage bound may revert on a moved price. | A REVERT is visible (status `reverted` on the card, tx hash on-chain) but still not a failures row. | GTM: coach "if it says likely to fail, wait two seconds and confirm anyway; if it reverts, tell me." Covered by fix #1's refusal wiring for the error text. |

Also considered and ruled OUT for H1: a $20 CoW order not filling — H1
doesn't route to CoW (above). For the record, live CoW quotes on Base
today (USDC→WETH, `priceQuality: optimal`): **$20 → feeAmount 0.0023
USDC (0.01%)**, $50 → 0.0023, $100 → 0.0023; no
`SellAmountDoesNotCoverFee` at $20 (that error fires when the network fee
exceeds the sell amount — on Base the network fee is ~$0.002); market
orders are fill-or-kill per batch, our order `validFor` is 1200s
(`lib/cow.ts:256`), so a $20 order that isn't matched in 20 minutes
EXPIRES rather than fills badly. Fee math does not push the size up.

**Size: $20 stays.** Numbers: Uniswap v3 USDC/WETH 0.05% pool on Base
has depth to fill $20 with negligible impact; gas for approve+swap on
Base ≈ $0.01–0.05; our link-tier fee at 50 bps = $0.10 (0.20% organic =
$0.04); CoW's network fee at $20 is $0.002. Nothing in the fill math
favors $50. What $50 WOULD do is shrink the pool of yeses ("$50 USDC
already on Base" is a harder screen than $25) without buying a better
signal — H1's output is a signature + a wall log, not volume. Raise to
$50 only for a tester who volunteers it.

**Routed findings (mirrored into `squad-2026-08-18/ideation.md`):**
- QA-1: ERC-20 sell turns don't pre-read gas ETH → offered approve fails
  in the wallet with nothing logged. QA-2: `SendTxButton`/`SendTxChain`/
  `SignOrderButton` don't call `reportWalletRefusal` — only
  `SignHlActionButton` does; the H1 path is blind to wallet-side failure.
- UI/UX-1: post-settle balance line on /i. UI/UX-2: "next step fires
  automatically" hint under step 1. UI/UX-3: `/rebrand` link in the /i
  footer. UI/UX-4: email lane on /i while OTP is unproven.
- GTM-1: the screen = "MetaMask or Rabby (one extension on), ≥$25 USDC
  AND some ETH on Base, desktop." GTM-2: pre-brief the two prompts + the
  Base switch. GTM-3: count "no because of rebrand" as its own number.

---

## §9 Round 2 — B1 named targets (verified live 2026-08-18)

*Every row verified with `gh api` this morning: repo exists, `pushed_at`
after 2026-06-19, active human contributors in the window, and a real
wallet/tx surface or a stated need. Names are GitHub logins as they
appear in the commit/PR history. Nothing here is from memory.*

**⛔ PRECONDITION (owner, one minute): `BROKER_DESK_ENABLED=true` on the
website Vercel project.** Prod `broker_open` refuses today. Seven of the
ten targets below have agents that SIGN WITH THEIR OWN KEY — for them the
honest pitch is the DESK (`broker_execute` agent-signed legs behind the
independent guard, `broker_status`/webhooks, `/agents/<hash>` record),
not the hands human-handoff. Do not send a single DM in rows 1–5, 7, 8
until the flip is live and re-curled. Rows 6, 9, 10 (already human-signs
believers) can be reached with the hands door today.

**Ecosystem facts that changed the list (verified):** `goat-sdk/goat` is
ARCHIVED (read-only, last push 07-02) — dropped. `elizaos-plugins` org is
EMPTY (0 repos; plugin-evm/hyperliquid/lifi/coinbase all 404) — the wallet
code lives in `elizaOS/eliza` `plugins/plugin-wallet`. `coinbase/x402` is
now a dev fork; the canonical repo is `x402-foundation/x402`.
`daydreamsai/daydreams` last push 03-01 — dropped. `modelcontextprotocol/servers`
no longer takes community listings — the paths are
registry.modelcontextprotocol.io (our `registry/*.server.json`) and
`punkpeye/awesome-mcp-servers` (348 PRs merged in 30d; CONTRIBUTING
fast-tracks agent-authored PRs). OpenClaw is real and large
(`openclaw/openclaw` 386k★, `openclaw/clawhub` registry, both pushed
08-18); its wallet skills are third-party.

| # | Target (repo · pushed_at) | Who (login · what they did in-window) | Signs today? | Why they'd care — specifically |
|---|---|---|---|---|
| 1 | `x402-foundation/x402` · 08-18 | **@phdargen** — PR #3124 "spend controls" merged 08-13 (per-asset caps + allowlist enforced BEFORE payment signing), #3133 SIWX origin bind; also maintains coinbase/agentkit. **@CarsonRoscoe** — settlement-pending state #3083, Go SVM #3141 (08-17) | Own key (EIP-712 x402 payments) | He just shipped client-side spend caps for agents — the same problem one layer up. The desk is where an x402 agent hands the VALUE leg (swap/stake/perp) to a human wallet or signs it behind an independent re-decode instead of under a cap. |
| 2 | `coinbase/agentkit` · 08-13 (⚠ default-branch commits stopped 03-23; activity is PR branches) | **@SashaMIT** — ~15 security PRs 08-16 (exact Permit2 amountIn/allowance, EIP-712 bind checks on 0x, slippage caps on enso/jupiter, wait-for-receipt on baseAccount), mostly unmerged. **@ADWilkinson** — #1442 OfframpActionProvider, #1438 Peer Cash (open 08-14/16). Skip the TaskMarket PR swarm (#1419–1453) — farmed. | Own key (CDP server wallet / Privy / eth-account) | SashaMIT is hand-fixing "independent guard re-decodes every build" bugs one provider at a time — our guard is the generalization. ADWilkinson builds money-OUT flows a human should sign. Contributor outreach, not maintainer (no community PR merged in 60d). |
| 3 | `Virtual-Protocol/acp-cli` · 08-18 | **@psmiratisu** — HL TP/SL management + margin (#86, 08-12). **@andrew-virtuals** — optional builder code for the trade command (#84, 08-11), README. **@Zuhwa** — Privy config, releases 08-12/08-18 | Own key (Privy-backed agent wallet, P256 signer under a restricted/unrestricted policy) | Direct overlap with our HL Guardian + builder-fee work; their "restricted policy" signer is where a re-decoding guard slots; the desk's `/agents/<hash>` record maps to their agent cards. They will want agent-signed legs — pitch guard-as-check + human handoff for above-policy asks. |
| 4 | `BlockRunAI/Franklin` · 08-17 (★546) | **@1bcMax** — releases 3.37–3.39, Polymarket e2e preflight (07-25→08-13). **@KillerQueen-Z** — #122 portfolio routing (08-07) | Own key (local `~/.blockrun/` wallet signs x402 + trades) | README: "proposes trade plans you approve before a cent moves" — the approve-then-agent-signs loop is exactly where the human's OWN wallet should sign the value leg; free MCP = a zero-cost venue set for their trading arena. |
| 5 | `elizaOS/eliza` `plugins/plugin-wallet` · 08-18 | **@lalalune** (Shaw) — merging + tests on the wallet plugin daily (08-17/18). (`byt61` — dozens of `fix(wallet)` commits, possibly an agent account) | Own key (`EVM_PRIVATE_KEY` local, or the "Steward" server signer); writes default to `mode=prepare` then confirm — still the agent's key | Their prepare-then-confirm is the right instinct with the wrong signer; a Pantessa sign link gives eliza agents a HUMAN-signed leg for the venues Steward doesn't cover (Li.Fi/Uniswap V3/Aerodrome builds with no independent re-decode today). Base/Clanker swap logic already merged — a Base-native door fits. |
| 6 | `agenthill/vaultpilot-mcp` · 08-16 | **@szhygulin** (owner; 08-06 second-LLM check optional; fail-closed submit gate 07-26). **@graciangabriel8** — swap/security refactors 07-26 | **No** — human signs on Ledger via WalletConnect/HID; agent proposes; prepare↔send fingerprint + 4byte check | Closest philosophical twin (human signs, independent decode, fail-closed). Their README lists a hosted MCP endpoint as unshipped roadmap; ours exists. Ask = cross-listing + mutual threat-model review, not "switch". Reachable with hands today. |
| 7 | `lopushok9/Agent-Layer` · 08-16 | **@lopushok9** — sole author; 0.1.95 on 08-16; 08-15 "Add Uniswap LP pool and position discovery"; ships as a Claude Code plugin marketplace AND a ClawHub plugin | Local wallet runtime signs on the user's machine under policy (agent gets capabilities, not keys) | Same thesis, same hosts (Claude Code + OpenClaw), overlapping asks (swaps, yield, tokenized stocks → our Robinhood 4663 lane). "We're the guarded tx layer under your wallet runtime." |
| 8 | `ChainGPT-org/chaingpt-claude-skill` · 08-17 | **@ceoguy** — 08-10 `feat(mcp): chaingpt_signals_feed`; 06-29 plugin fixes | Own key (agent EOA with per-tx/daily caps + ERC-4337 caps; policy file "outside the model's reach") | 154 tools incl. CoW/1inch swaps, Aave/Lido/Morpho, Hyperliquid + Drift perps, x402, DCA — the same verb set, guarded by CAPS not by decode. They will have hit the MetaMask/HL-1337 class for human users; the delegated door is a story they'll recognize. |
| 9 | `EkuboProtocol/wallet` · 08-18 | **@moodysalem** (Moody Salem, ex-Uniswap core; sole committer, daily) — 08-18 "Add a Base endpoint that answers the whole signing path", policy `review` effect, release 1.3.1 | Wallet app signs locally under policy; agents reach it over an MCP bridge (agent never holds the key) | He builds "the wallet that decides"; we build "what the agent asks the wallet to sign" (guarded per-venue builds). Pitch: Pantessa sign links / desk as a build source his policy can `review`. High-signal, low-volume; will read a threat model. Hands door works today. |
| 10 | `internet-court/internet-court-skill` · 08-11 (★3.7k) | **@rasca** — sole author; v0.2.0 08-11 (Solana + refreshed vendored MetaMask smart-accounts-kit / x402-erc7710 / agentic-wallet / Privy connectors) | Delegated (ERC-7710 permissions granted by the human's smart account; agent signs within them) | A Claude Code trust-layer plugin that catalogs "how agents get money hands"; our model (agent proposes a sentence, human EOA signs, guard verifies) is the OTHER answer to his question — a natural catalog row and a drop-in vendored skill. |

**Adjacent (worth one DM each, lower fit):** `erc-8004/erc-8004-contracts`
(★231, 08-15 — **@marcoderossi90 added Robinhood Chain 4663 to the
registry three days ago**; our `/agents/<hash>` record is a natural 8004
reputation feed and we are one of the few with real signed flows on
4663); `altananetwork/altana-sdk` (08-17, session-key delegation MCP on
BNB/EVM — @dhernz/@gabonaut; on-thesis, tiny); `tkhq/turnkey-agent-skills`
(borderline: main last commit 05-19, one open PR 08-17).

**Listing paths (no owner gate except the official registry):**
`punkpeye/awesome-mcp-servers` PR (fast-tracked if agent-authored);
`BankrBot/skills` PR — their `uniswap-driver` skill already sells the
"plan → deep link → human signs on the Uniswap UI" pattern, so a `pantessa`
skill (sentence → `/i` sign link, guarded, multi-venue) sits beside it
(maintainers **@saltoriousSIG**, **@0xsnackbaker** merging catalog PRs
08-11/14); ClawHub (OpenClaw registry) once a skill wrapper exists;
registry.modelcontextprotocol.io via `registry/*.server.json` (owner —
namespace verification).

### The 3-line ask, in Nate's voice (two variants — pick by the "signs today?" column)

**For rows 1–5, 7, 8 (agent signs with its own key today) — send AFTER the desk flip:**
> Your agent already signs. Ours never lets the model write calldata: it states the intent over MCP, we compile + independently re-decode it fail-closed, and either the human's own wallet signs the link or your agent signs its own legs behind that guard, with a signed webhook back and a public track record page nobody can fake.
> Free right now: `claude mcp add --transport http pantessa-desk https://www.pantessa.com/api/broker/mcp` — call `broker_capabilities`, then `broker_open` with "Swap $20 of USDC to ETH on Base".
> I'd like 30 minutes on a call this week to watch you wire it and hear what your users would need. Background first: pantessa.com/rebrand (we were Yeetful; an old demo host got blocklisted; the guard is our answer).

**For rows 6, 9, 10 (already human-signs) — hands works today, no flip needed:**
> You already believe the human should sign. Ours is the other half: a plain sentence compiles to a guarded build for the human's wallet, an independent guard re-decodes it, they sign from any wallet via a link — no Ledger-only, no calldata ever crosses the MCP wire.
> One line: `claude mcp add --transport http pantessa-hands https://hands-mcp.yeetful.com/mcp`, then `prepare_handoff` for "Swap $20 of USDC to ETH on Base".
> Would you look at the threat model and tell me where it's wrong? Docs: pantessa.com/docs/desk · background: pantessa.com/rebrand.

Per-row one-liner to prepend (the specific reason, so it isn't a blast):
1 phdargen — "saw #3124 spend controls land; this is the same problem one layer up." · 2 SashaMIT — "you're fixing exact-allowance/EIP-712-bind bugs provider by provider; we generalized that into one guard." · 3 psmiratisu/andrew-virtuals — "your HL TP/SL + builder-code work is our Guardian + builder fee, from the other side." · 4 1bcMax — "'you approve before a cent moves' — we make the approval a wallet signature." · 5 lalalune — "plugin-wallet's prepare-then-confirm, with the human's key doing the confirm." · 6 szhygulin — "your roadmap says hosted MCP endpoint; ours is live — want to cross-list?" · 7 lopushok9 — "same hosts (Claude Code + ClawHub), same asks incl. tokenized stocks — we're the guarded tx layer under a wallet runtime." · 8 ceoguy — "154 tools guarded by caps; ours re-decodes every build — and we hit the MetaMask/HL-1337 wall you'll have hit." · 9 moodysalem — "your Base signing-path endpoint just shipped; we're a build source your policy could `review`." · 10 rasca — "your catalog lists how agents get money hands; here's the human-EOA-signs answer as a vendored skill."

**Metric for B1 (unchanged):** three of the ten (a) call `prepare_handoff`
or `broker_open` from a key/IP that isn't ours and (b) reply with what's
missing. Count "can my agent sign?" replies as desk demand. Cost: ~6
founder-hours; the ten DMs are personal, not a template blast.
