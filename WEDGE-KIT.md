# WEDGE KIT — ten strangers, by hand (L2-Q4; written 2026-08-18, realigned to STRATEGY-squad-2026-08-18.md H1 the same day)

The §3 doctrine of `HANDOFF-gtm-bulletproof.md`, made runnable: **no KOL DM,
no launch thread, no campaign until ten strangers have each completed one
real transaction and told us what it felt like.** This kit is everything Nate
needs to recruit one person, watch them, and record it — ten times.

The lead play is the Ideation lane's tournament winner
(`STRATEGY-squad-2026-08-18.md` §0/§2 H1): **the watched $20 USDC→ETH swap
on Base**, handed one at a time as a Nate-minted `/i` link. The DCA weekly
ask (their H3) is the follow-on that measures a return; the five-dollar
inbox relay (their H2) is the second-touch play. Spot Guardian is NOT the
lead — see §0.

Companion instruments: `npm run digest:gtm` (daily arc + money + failures +
blocklist watch), `/dashboard/failures?funded=1` (what walled them),
`/dashboard/admin` "The arc · strangers only", the per-link funnel on
`/dashboard/links` (open → connect → built → signed → settled).

---

## 0. Why not Spot Guardian (THE WEEK item 7's ask) — verified on prod

THE WEEK item 7 (CLAUDE.md, 2026-08-17) says: *"Lead with the Spot Guardian
protection ask — it works on wallet balances today."* It does not, for two
independent reasons (GTM probe + Ideation §6.3 agree):

1. **Not provisioned in prod.** `POST https://www.pantessa.com/api/chat`,
   `Protect my spot ETH with a 10% stop loss`, wallet attached, read-only,
   internal-stamped, re-probed 2026-08-18 (0.3s), verbatim:
   `🛡️ Spot protection runs on the autopilot rails, which aren’t provisioned in this environment yet.`
   (`buildPath: native-spot-guard`, no artifact). The CDP spender env
   (`CDP_API_KEY_ID/SECRET`, `CDP_WALLET_SECRET`, `CDP_SPEND_NETWORK=base`)
   is not on Vercel.
2. **Every front door yields an EOA and the arm needs a smart wallet.**
   MetaMask/Rabby are EOAs, the CDP email/Google wallet is created `eoa`
   (`lib/cdp-embedded.ts:32`), the Coinbase connector is pinned `eoaOnly`
   (`lib/wagmi.ts:48`). Unlike DCA autopilot (`lib/dca-auto-exec.ts:248-259`,
   a `getCode` check that refuses EOAs by name), `runSpotGuardTurn`
   (`lib/spot-guard-exec.ts`) has no such check — provisioned, an EOA would
   get the arm offer, `simulateApprove` (ECDSA-valid) would pass, the policy
   would store `active`, and the sweep would revert at fire time. Also
   (Ideation §6.3): the natural phrasings ("protect my ETH with a 10% stop
   loss", the product's own example prompt) route to the HL perps guardian.

## 1. Verified on prod — 2026-08-18 (read-only, internal-stamped, nothing signed)

All via `POST https://www.pantessa.com/api/chat` with headers
`x-yf-internal-run: 1` + `x-yf-no-ask-log: 1`, `walletAddress` = a real
funded read-only address (Nate's; holds Base ETH/USDC and USDG on 4663).
`activeServers` as noted — the `/i` runtime composes `uniswap-free` for
swap asks (`composeMcps`), and the default chat fleet contains
`uniswap-free`, so **the stranger's real path is the "uniswap in set" row**.

| ask | set | buildPath → artifact | latency | reply (first line) |
|---|---|---|---|---|
| **`Swap $20 of USDC to ETH on Base`** (H1) | uniswap in set (= `/i` + default `/chat`) | `native-swap-uniswap` → **`txChain` (2 steps: approve USDC → swap)** | 1.4s | `🔏 Swap 20 USDC → ~0.010553 ETH via Uniswap v3 on Base (1bps pool), min received 0.010479 (50bps slippage, incl. 0.2% Pantessa fee on the output)` + "Two steps in the card below — sign the USDC approval, and the swap appears automatically" |
| `Swap $20 of USDC to ETH on Base` | **empty** set (edge: user removed every MCP) | `native-swap-cow` → `orderRequest` | 2.6s | `🔏 Swap 19.997646 USDC → ~0.010499 WETH via CoW on Base` — note **WETH**, not ETH |
| `Swap $20 of ETH to USDC on Base` (H1 mirror, for ETH-only holders) | empty set | `native-swap-cow` → `orderRequest` | 9.7s | `🔏 Swap 0.010559 WETH → ~19.903179 USDC via CoW on Base` + `⚠️ Wallet holds less WETH than the order sells — it won't settle until funded.` + approve-WETH warning — the CoW branch sells **WETH**, so a stranger holding only ETH gets an order that cannot settle (QA finding; the uniswap-in-set path is not affected — re-verify the mirror on `/i` before handing it out) |
| `Swap $5 of ETH to USDC on Base` | empty set | `native-swap-cow` → `orderRequest` | 4.0s | `🔏 Swap 0.002638 WETH → ~4.973374 USDC via CoW on Base` |
| **`DCA $10 into ETH weekly`** (H3) | empty set (DCA is a native gate, set-independent) | `native-dca` → **`dcaScheduleId` + `jobId` + `jobToken`** (schedule created, period-1 buy job offered) | 2.9s | `📆 **Recurring buy armed:** $10 of ETH weekly on Base, spending USDC. Each period the buy is built fresh — live quote, guardrails, receipt — and NOTHING buys without your signature…` (probed with a throwaway address; the schedule/run/job/step rows it wrote were deleted afterwards — the DCA ask is a WRITE, not read-only) |
| **`Buy $12 of AAPL`** / `…on Robinhood Chain` (wallet holds USDG on 4663) | empty set | `native-swap-uniswap` → **`txChain` (approve USDG → swap)** | 1.5s / 1.1s | `🔏 Swap 12 USDG → ~0.039051 AAPL via Uniswap v3 on Robinhood Chain (5bps pool), min received 0.038778 (50bps slippage, incl. 0.2% Pantessa fee on the output)` |
| `Protect my spot ETH with a 10% stop loss` | empty set | `native-spot-guard` → nothing | 0.3s | verbatim in §0 |
| `Stake 0.05 ETH with Lido` / `Protect my ETH long on Hyperliquid…` | empty set | no buildPath → the add-the-dapp door | — | `🌊 Staking with Lido runs right here — it just needs the **Lido** dapp in this chat's set. [Add Lido with this ask ready](/chat?mcps=lido-free&prompt=…)` (expected; Ideation §6.4: the Lido house ask is sized wrong for strangers anyway) |

**Read:** H1's exact ask builds the two-signature v3 chain on the real path
in ~1.5s, output is native ETH, fee line visible. Nothing in the lead play
falls to the planner. Two things the kit must warn about, taken from
Ideation §2/H1 and confirmed here: **two MetaMask signatures** (approve, then
swap; expect "why twice") and **a MetaMask chain switch to Base first**.

## 1b. The unfurl — the first thing a recruit sees (checked on prod 2026-08-18)

The DM'd `/i` link previews as an OG card. No house link has H1's exact
shape (none composes `uniswap-free`), so the closest live shapes were
fetched: `/i/bridge-usdc` ("Swap 5 USDC from Base to Arbitrum") and
`/i/dca-eth` (Uniswap venue). PNGs saved at
`squad-2026-08-18/shots-gtm/og-bridge-usdc.png` and `og-dca-eth.png`
(1200×630, ~100 KB, served by `app/i/[slug]/opengraph-image.tsx`).

- `og:title` = `<the ask> · Pantessa`; `og:description` = "One tap from ask
  to signed. Pantessa compiles this into guarded transactions — deterministic
  builders, fail-closed checks, receipts — and your wallet is the only thing
  that can sign." (`app/i/[slug]/page.tsx:42`).
- The card: pangolin lockup + "pantessa" (current brand, no Yeetful),
  eyebrow `INTENT LINK · TAP TO RUN` (house) — for a creator-minted link
  with a claimed handle it reads **`CALL BY @HANDLE`**, else `CALL · TAP TO
  RUN` (`opengraph-image.tsx:324-331`); the ask in large italic serif;
  green line "Connect a wallet and the path builds itself."; pills
  **Guarded build · Your wallet signs · Receipted**; `pantessa.com`.
- **As a stranger:** WHAT — yes (the sentence is the card). WHOSE — yes for
  Nate's minted link (`CALL BY @NATE…`), but "CALL" is YeetCall vocabulary:
  to a friend doing a usability test it reads like a trade tip, not "Nate's
  test link". NON-CUSTODIAL — implied ("Your wallet signs"), never said
  ("no deposits", "non-custodial", "you can reject") — and `TAP TO RUN`
  slightly implies it runs on tap. Nothing says "two wallet prompts" (fine
  for a card). No old branding. Verdict: adequate, undersells the safety
  claim by one word. → Visuals/UI: consider `INTENT LINK · YOUR WALLET
  SIGNS` / a "Non-custodial" pill and a byline word other than CALL for
  non-YeetCall links (`app/i/[slug]/opengraph-image.tsx` L47 pills, L324-331
  eyebrow).

## 2. Who — the screen and the ring (Ideation H1, kept verbatim where better)

**The screen (ask before booking, verbatim — Ideation §8 GTM-1):** *"One
wallet extension only (MetaMask or Rabby, not both), at least $25 USDC AND
some ETH on Base, on desktop or inside the MetaMask mobile browser?"* If
they'd have to bridge, hold no gas ETH, or would sign in by email, they are
not this week's user — that is a different play with a different wall
(funding cascade / unproven OTP / no WalletConnect on a phone's Safari).
**Write down who failed the screen and why; that list IS the next round's
target.** Why each clause: zero gas ETH = the approve tx fails inside the
wallet and NOTHING is logged (§8 #1); two injected wallets = the popup
wallet ≠ the connected wallet (§8 #8); phone Safari = a modal with no
wallet that can connect (§8 #9).

**The ring, in order (Ideation's channel list — replaces mine):**
1. Nate's own first ring by DM — ex-coworkers, hackathon teammates,
   Farcaster mutuals who visibly transact on Base, people from the
   personal.computer forum and the job-hunt network who are in crypto. DM,
   never post.
2. If the ring runs dry after ~15 DMs, ONE narrow public pool where a paid
   usability test is normal: Base Discord `#builders` or the Farcaster
   `/base` channel — still by reply/DM, still one at a time.
3. H2 (the relay) = one private group chat Nate is already in. H3 (DCA) =
   a DIFFERENT pool (r/ethereum Daily General Discussion mod-first,
   EthStaker `#offtopic` mod-first, Bankless `#defi`, Farcaster `/base` +
   `/ethereum`) so the warm ring isn't burned twice.
- **Explicitly not:** KOLs (KOL-KIT.md is §4, gated on this succeeding),
  broadcast, launch thread, anyone we'd need to fund first (unless Nate
  takes the rule-4 option below).

**The honest limit, said out loud (Ideation): a favor is not demand.** Ten
friends signing $20 proves the funnel works for a real human on a real
wallet — which we have never observed — and nothing about willingness to
return. H2/H3 chase return; H1 does not claim to.

## 3. The DM — Template A (Ideation's; ~80 words, /rebrand up front)

Send one at a time. Personalise the first line. Wait for a yes AND a wallet
answer to the screen before booking.

> Building a thing that turns one sentence into a guarded transaction your own wallet signs — nothing custodied, I never see keys. Nobody outside me has used it yet and I want to watch ten people try. 15 min on a call, you swap $20 USDC→ETH on Base with your own MetaMask, tell me what felt off. Full disclosure first: pantessa.com/rebrand — we were Yeetful and an old demo subdomain got blocklisted. Read it, then decide. Say no freely.

*(Kept from my draft as the longer alternative if the relationship wants
more words: "…If it walls you, that's the most useful outcome for me and
I'll fix it the same day. No pitch, no follow-up sequence, no token. Just a
stranger test. Yes/no?")*

Optional (rule 4, Nate's call — Ideation): "I'll cover gas plus $10 for your
time" — paid as `send 10 USDC to <their addr> on base` from Nate's wallet
through the product (a dogfood and a second real signature in the log).
~$120 across ten.

Follow-up (once, 48h later, only if no reply): "no worries if not — if you
know someone who holds a bit of USDC on Base and likes breaking things, I'd
take an intro."

## 4. Before the call — the checklist (5 minutes)

- [ ] `npm run digest:gtm` this morning: serving domains **clean** on both
      feeds (a LISTED serving domain exits 2 — never run a stranger into a
      wallet interstitial).
- [ ] On `/links`, mint **`Swap $20 of USDC to ETH on Base`** under Nate's
      claimed @handle — a real creator link with first-touch attribution,
      not a house link. Copy the `/i/<slug>`. Optionally mint a second,
      addressed copy per tester with "Send it to someone" (their 0x or
      @handle) → lands in `/inbox/<their address>` (H1 door b; seeds H2).
      **One link per tester** so the per-link funnel is that tester's row.
- [ ] ETH-only holders: mint the mirror `Swap $20 of ETH to USDC on Base`
      — do NOT hand them the USDC→ETH link (the funding cascade would offer
      a silly ETH→USDC→ETH detour). **Re-verify the mirror on `/i` first**
      (the empty-set CoW branch sells WETH and won't settle for an ETH-only
      wallet — §1).
- [ ] Prod sanity in a fresh profile: the `/i/<slug>` page renders, the
      connect door opens, no wallet interstitial on `www.pantessa.com`.
- [ ] Two tabs open on Nate's side: `/dashboard/failures?funded=1` and
      `/dashboard/links` (the tester's slug row) — plus `/dashboard/admin`
      with today's arc numbers written down by hand (the arrival tables are
      not `is_internal`-stamped yet; track the ten addresses individually).
- [ ] Recording consent asked in the DM or at the top of the call.

## 5. On the call — the 60-second script, then silence

Say this, then stop talking:

> "I'm going to paste one link. Open it, connect the wallet you already use, and read what it says. It's asking you to swap twenty dollars of USDC to ETH on Base — real money, your wallet signs, you can reject anything. Three things your wallet will do, so they don't surprise you: it'll ask to switch to Base — say yes; then you'll get TWO prompts — the first is a 'spending cap' for exactly 20 USDC, that's the approval, not the payment; the second is the swap itself and it pops up by itself a couple of seconds after the first one confirms. If it says 'likely to fail', wait two seconds and confirm anyway; if it reverts, tell me. Do exactly what you'd do if I weren't here, and think out loud if you can. I'm not going to help unless you're stuck for more than a minute. Go."

*(Why the pre-brief — Ideation §8 #2/#3/#10: H1 is Uniswap v3 approve → swap
in one self-advancing SendTxChain card; MetaMask renders step 1 as a
"Spending cap request", step 2 auto-fires ~2s after step 1 confirms, and a
wallet on another chain gets a "switch network" prompt first. Unbriefed,
"why is it asking again" is the drainer reflex.)*

Then watch. Write down, with timestamps:

| moment | what to note |
|---|---|
| Link opens | Do they read the card (creator byline, the ask, connect CTA) or hunt for a button? First words. |
| Connect | Which wallet, which chain it was on; does MetaMask throw an interstitial on `www.pantessa.com`; does the connect modal make sense (connect-to-act — no SIWE on `/i`). |
| The built swap card | Do they understand what will happen? Do they read the guard line / the 0.2% fee line / "min received"? |
| MetaMask chain switch to Base | Did they expect it? |
| Signature 1 — approve USDC | Hesitation? Any wallet warning (Blockaid "deceptive request" is a known false positive on x402 receivers — note if it appears here)? |
| Signature 2 — the swap | **Does "why twice" come out of their mouth?** Time from link-open to second signature. |
| Receipt | Do they know it's done? Do they click the explorer link? |
| "Sign in & save" bar | Do NOT push it — connect-to-act is the model, SIWE is theirs to want. Note if they click it. |
| Hand-off (if signed and not annoyed) | Offer H2 on the spot: "want to send $5 to someone from here?" — one hop, no pressure. Or H3: type `DCA $10 into ETH weekly` — do they get the standing intent, do they sign period 1? |

**What to watch on which screen — Nate's side, verified 2026-08-18 (source
+ the admin API on a prod build with the burner session):**

| when | screen | what ticks / what you'll see | caveat |
|---|---|---|---|
| link pasted → opened | `/dashboard/links` (or the rail's Links tab), the tester's slug row | `Opens` +1 | **No auto-poll** — `useIntentLinks` loads once; press the page's refresh / reload the tab. Put the tab on a 15s auto-reload (browser extension) for the drill. |
| wallet connected | same row | `Connects` +1 (per-link funnel = open → connect → built → signed → settled + `$` signed) | the funnel is per LINK, so one link per tester is the whole trick |
| card renders | same row | `Built` +1 | |
| approve/swap rejected or fails IN THE WALLET | `/dashboard/failures` | **NOTHING.** Only `SignHlActionButton` reports `wallet-refused`; `SendTxButton`/`SendTxChain` paint the error red locally. `ask_failures` holds **0 `wallet-refused` rows ever** (kinds today: 24 planner-answer, 2 native-wall, 1 blocked). The link row stays at built-not-signed. → your eyes + their words are the only log (QA finding, Ideation §8 QA-2) |
| ask walled server-side (planner fall-through, native wall, guard block) | `/dashboard/failures` | a row within seconds: kind label (`planner fall-through` / `native wall` / `guard blocked` / `wallet refused`), `had funds` verdict, $ idle, prompt + reply | **`?funded=1` in the URL is NOT read** — the page's "funded" and "external" filters are in-page toggle buttons (state defaults off); click them. There is also a Refresh button, no auto-poll. Rows are never `is_internal`-stamped; harness rows are absent only because probes send `x-yf-no-ask-log` — a prod drill without that header writes a visible row (the "external" toggle hides TEST_WALLETS only). |
| swap signed + confirmed | link row `Signed` +1, `$` fills; `/dashboard/admin` arc `signed` (strangers only) | | the arc counts a wallet by FIRST-SEEN date + real origin; a tester who ever hit the site from a preview/localhost origin is fine (real origin wins), but the arrival tables are unstamped so read the row, not the aggregate |
| receipt / settled | link row `Settled` | | |

Only intervene after ~60s of being stuck, and log that you did (a funnel
failure even if they finish).

If it walls: **do not fix it live.** Screenshot, note the exact ask and
wallet, check `/dashboard/failures` — the row is the ticket. Thank them,
tell them you'll ping when it's fixed, and mean it.

## 6. After — the receipt ask

Ideation's one question, verbatim, answer written down:

1. **"What did that feel like, and where did it feel wrong?"**

Then, if there's time (mine — comprehension + retention):

2. "In one sentence, what did that just do?"
3. "Would you run the weekly one without me on the call? Why / why not?"

Then the favour, only if they signed and it settled:

> "Would you mind if I quoted that / posted the receipt? Your address gets shortened, and I'll show you the post first."

A stranger's receipt + one honest sentence is the only content that compounds
(§4 of the brief). Do not ask for a follow, a retweet, or a testimonial.

Same-day: every wall → `ask_failures` row → fix PR (the #595/#621 loop);
every "felt wrong" → the UI/UX lane. Ping them when it ships — that ping is
the second-visit prompt. **Day 6 (H3 signers): DM the period-2 heads-up
by hand — there is no push in the product yet.**

## 7. Tracking table (copy into a private doc; the link funnel is the truth)

Two tallies, kept apart: **DMs** (everyone asked — including the ones who
said no, and WHY) and **sessions** (everyone who got on a call).

**DM tally — CSV header (paste as row 1 of a sheet):**
```
dm_date,handle,ring,reply(yes|no|silent),no_reason(rebrand|no_base_usdc|no_gas_eth|wallet_screen|mobile_only|time|other),screen_passed(y|n),screen_fail_reason,booked_date,notes
```
The `no_reason=rebrand` count is its own number (Ideation §8 #7): it is
the cost of the blocklist entry and it belongs in the MetaMask issue.

**Session tally — CSV header:**
```
session_n,date,handle,wallet,wallet_ext(metamask|rabby),device(desktop|mm_mobile),link_slug,t_link_open,t_connect,t_built,t_sig1_approve,t_sig2_swap,t_settled,chain_switch_prompted(y|n),why_twice_said(y|n),wallet_side_error_words,failures_row_id,walled_kind,felt_like_sentence,almost_stopped_moment,would_use_weekly(y|n|maybe),handoff_taken(none|h2_relay|h3_dca),receipt_ok(y|n),receipt_posted_url,returned_date,notes
```

Rendered, the same thing:

| # | date | who | ring | wallet ext / device | slug | open→connect→built→sig1→sig2→settled (times) | chain-switch? | "why twice"? | walled? (failures row / wallet words) | felt-like sentence | hand-off | receipt OK? | returned |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| … |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |  |  |  |  |  |  |

**Metric (Ideation H1):** ten distinct non-Nate wallets with
`outcome='signed'` on the swap slug, `is_internal` false, real origin; time
connect→first signature per wallet; zero `wallet-refused` rows; the ten
one-sentence answers. **Falsification:** if fifteen DMs can't book five
calls whose wallets pass the screen, the pool is empty — a 48-hour clean
result that says "recruit from where Base USDC lives", not "build".
**Bar to move to §4 (KOLs, embed partners, content):** ten signed and at
least three returned unprompted (an H3 period-2 signature or an H2 mint
counts). **Kill criterion (brief §3):** if ten hand-held people cannot be
made to complete and return, the problem is positioning or market — the
answer is §5, not features.

## 7b. The post-drill receipt post — one per stranger, permission-gated

Only after they said yes to "can I post the receipt?" and saw the draft.
Shorten the address, never name them unless they ask to be named, link the
explorer tx, never quote a number bigger than the one they moved. Nate's
voice: build-in-public, no adjectives, the wall goes in if there was one.

**Single post (the default):**
> stranger test #N. <first name / "a friend"> swapped $20 USDC→ETH on Base from their own MetaMask through one link — approve, swap, done in <M:SS>. their words: "<the felt-like sentence, verbatim>". <what went wrong, if anything: "the second prompt surprised them — fixing the copy today"> tx: <basescan link> · <N>/10.

**Thread variant (when there was a wall worth showing):**
> 1/ stranger test #N of 10. <who, one clause>. the ask: "Swap $20 of USDC to ETH on Base", their wallet, my link.
> 2/ what happened: <the moment — e.g. MetaMask showed the spending-cap screen and they read it as the payment / it walled at X>. screenshot.
> 3/ their words, unedited: "<sentence>".
> 4/ what I changed today: <PR or "nothing — it worked"> . receipt: <basescan>. running tally: <signed>/<sessions>, <returned> back on their own.

**Weekly rollup (only if ≥3 sessions that week; the honest numbers, no
hype):**
> week 1 of watching strangers: <s> sessions, <k> signed, <w> walled (<top wall>), <r> came back unprompted. total real money moved through the product, ever: $<digest figure> — this week added $<x>. what I fixed because of it: <one line>. next: <one line>.

Rules: nothing goes out that `npm run digest:gtm` can't back that morning;
no "first of many"; no follower ask; if they later say "take it down", take
it down.

## 8. What the kit assumes the product does (owed to QA/UI — verify before call #1)

- `/i/<Nate-minted slug>` for `Swap $20 of USDC to ETH on Base`: connect-only
  door (no SIWE), ask fires on connect, the v3 two-step card renders,
  MetaMask switches to Base and signs approve → swap without a
  chain-mismatch refusal (WALLET-MATRIX §4 row 1 shape), receipt renders
  with an explorer link, the link's funnel row shows `signed` within a
  minute. **Prod build proven above; the wallet-side drive is QA's.**
- No "Yeetful" string in the MCP strip on the `/i` page (rows unrenamed;
  display map should cover — verify on `/i`, not just `/chat`).
- The second signature is explained before it fires ("the swap appears
  automatically once it confirms" — is that visible on the card?).
- The mirror link (ETH→USDC) on `/i` builds v3, not the CoW/WETH branch.
- `DCA $10 into ETH weekly` typed in the same thread creates the schedule +
  offers period 1; the rail's Jobs tab shows it; a return next week offers
  period 2 (lazy due detection). Grammar gaps a stranger will hit
  (Ideation §6.2): `set up a weekly $10 ETH buy` / `dca into eth` → planner.
- `/inbox/<address>` renders an addressed intent for someone who has the
  URL; whether a fresh connected wallet finds it unaided (rail "For you")
  is the H2 open question.
- Spot Guardian: **either** refuse EOAs by name (port the DCA autopilot
  `getCode` check) **or** keep it un-provisioned; never a silent arm that
  cannot fire. `lib/examples.ts:43` sends a spot holder to a perps door —
  reword or gate.

## 10. Builders — the B1 agent-builder ring (Ideation §9, folded verbatim where it matters)

**⛔ PRECONDITION (owner, one minute): `BROKER_DESK_ENABLED=true` on the
website Vercel project.** Prod `broker_open` refuses today. Seven of the ten
targets have agents that SIGN WITH THEIR OWN KEY — for them the honest pitch
is the DESK (`broker_execute` agent-signed legs behind the independent
guard, `broker_status`/webhooks, `/agents/<hash>` record), not the hands
human-handoff. **Do not send rows 1–5, 7, 8 until the flip is live and
re-curled. Rows 6, 9, 10 (already human-signs believers) can be reached
with the hands door TODAY.**

| # | target · login | signs today? | door | send when |
|---|---|---|---|---|
| 1 | `x402-foundation/x402` · @phdargen (spend controls #3124), @CarsonRoscoe | own key | desk | after flip |
| 2 | `coinbase/agentkit` · @SashaMIT (guard-shaped security PRs), @ADWilkinson (offramp) | own key | desk | after flip |
| 3 | `Virtual-Protocol/acp-cli` · @psmiratisu (HL TP/SL), @andrew-virtuals (builder code) | own key | desk | after flip |
| 4 | `BlockRunAI/Franklin` · @1bcMax | own key | desk | after flip |
| 5 | `elizaOS/eliza` `plugins/plugin-wallet` · @lalalune | own key | desk | after flip |
| **6** | `agenthill/vaultpilot-mcp` · @szhygulin | **no — human signs** | **hands** | **now** |
| 7 | `lopushok9/Agent-Layer` · @lopushok9 | local runtime signs | desk | after flip |
| 8 | `ChainGPT-org/chaingpt-claude-skill` · @ceoguy | own key (caps) | desk | after flip |
| **9** | `EkuboProtocol/wallet` · @moodysalem | **wallet app signs locally** | **hands** | **now** |
| **10** | `internet-court/internet-court-skill` · @rasca | delegated (ERC-7710) | **hands** | **now** |

Full "why they'd care" per row + adjacent targets (erc-8004 — 4663 added
08-15; altana-sdk; turnkey) + listing paths (awesome-mcp-servers PR,
BankrBot/skills PR beside `uniswap-driver`, ClawHub, MCP registry — owner)
= `STRATEGY-squad-2026-08-18.md` §9.

**The 3-line ask — variant for rows 1–5, 7, 8 (send AFTER the desk flip):**
> Your agent already signs. Ours never lets the model write calldata: it states the intent over MCP, we compile + independently re-decode it fail-closed, and either the human's own wallet signs the link or your agent signs its own legs behind that guard, with a signed webhook back and a public track record page nobody can fake.
> Free right now: `claude mcp add --transport http pantessa-desk https://www.pantessa.com/api/broker/mcp` — call `broker_capabilities`, then `broker_open` with "Swap $20 of USDC to ETH on Base".
> I'd like 30 minutes on a call this week to watch you wire it and hear what your users would need. Background first: pantessa.com/rebrand (we were Yeetful; an old demo host got blocklisted; the guard is our answer).

**Variant for rows 6, 9, 10 (hands works today, no flip):**
> You already believe the human should sign. Ours is the other half: a plain sentence compiles to a guarded build for the human's wallet, an independent guard re-decodes it, they sign from any wallet via a link — no Ledger-only, no calldata ever crosses the MCP wire.
> One line: `claude mcp add --transport http pantessa-hands https://hands-mcp.yeetful.com/mcp`, then `prepare_handoff` for "Swap $20 of USDC to ETH on Base".
> Would you look at the threat model and tell me where it's wrong? Docs: pantessa.com/docs/desk · background: pantessa.com/rebrand.

**Per-row opener (prepend; the specific reason so it isn't a blast):**
1 phdargen — "saw #3124 spend controls land; this is the same problem one layer up." · 2 SashaMIT — "you're fixing exact-allowance/EIP-712-bind bugs provider by provider; we generalized that into one guard." · 3 psmiratisu/andrew-virtuals — "your HL TP/SL + builder-code work is our Guardian + builder fee, from the other side." · 4 1bcMax — "'you approve before a cent moves' — we make the approval a wallet signature." · 5 lalalune — "plugin-wallet's prepare-then-confirm, with the human's key doing the confirm." · 6 szhygulin — "your roadmap says hosted MCP endpoint; ours is live — want to cross-list?" · 7 lopushok9 — "same hosts (Claude Code + ClawHub), same asks incl. tokenized stocks — we're the guarded tx layer under a wallet runtime." · 8 ceoguy — "154 tools guarded by caps; ours re-decodes every build — and we hit the MetaMask/HL-1337 wall you'll have hit." · 9 moodysalem — "your Base signing-path endpoint just shipped; we're a build source your policy could `review`." · 10 rasca — "your catalog lists how agents get money hands; here's the human-EOA-signs answer as a vendored skill."

**Do NOT promise** in any builder DM: a track-record page (desk-only; desk
is OFF in prod until the flip) or self-signing legs before the flip.
**Metric:** three of ten (a) call `prepare_handoff` or `broker_open` from a
key/IP that isn't ours and (b) reply with what's missing; count "can my
agent sign?" replies as desk demand.

## 9. Alignment log — what came from ideation.md, what stayed

- **Taken from Ideation (STRATEGY-squad-2026-08-18.md):** H1 as the lead
  (replaces my A "Swap $5 of ETH → USDC" — same shape, their $20 USDC→ETH
  and the creator-minted `/i` link are better: bigger real signal, no
  gas-token ambiguity, first-touch attribution exercised); the wallet
  screen verbatim; the ring/channel list (replaces mine); Template A
  verbatim; the rule-4 $10 option; the "why twice" watch point; the one
  verbatim question; the metric + falsification; H2 relay as the
  second-touch play; H3 DCA as the return play with the day-6 manual
  reminder; "a favor is not demand".
- **Kept from mine:** the §1 prod-verification table (their assumption
  about the v3 two-signature card is now proven on prod, plus the empty-set
  CoW/WETH edge they didn't have); the 60-second script + moment table; the
  pre-call checklist (digest-clean gate, one link per tester); the
  permission-to-post favour; the two extra questions; the tracking table
  columns; §8 product assumptions.
- **Round 3 folds (Ideation §8/§9):** screen line rewritten ("one wallet
  extension only… ≥$25 USDC AND some ETH on Base… desktop or the MetaMask
  mobile browser"); the three wallet prompts pre-briefed in the script
  (Base switch, spending-cap approve, auto-firing swap); `no_reason=rebrand`
  as its own tally column; $20 stays; §10 Builders with the
  `BROKER_DESK_ENABLED` precondition + rows 6/9/10 hands-now.
- **Deltas worth a decision:** Ideation §7 surfaces "make Spot Guardian
  EOA-capable" as a product call — until then, no protection ask is
  runnable by any wallet we onboard. My earlier candidate B (funded AAPL
  buy) is demoted to "only for someone who volunteers the word stocks" —
  the bridge job is the most fragile path and H1 deliberately avoids it.
