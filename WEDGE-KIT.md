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

## 2. Who — the screen and the ring (Ideation H1, kept verbatim where better)

**The screen (ask before booking, verbatim):** *"MetaMask or Rabby, and at
least $25 USDC already sitting on Base?"* If they'd have to bridge or would
sign in by email, they are not this week's user — that is a different play
with a different wall (funding cascade / unproven OTP). **Write down who
failed the screen and why; that list IS the next round's target.** Add for
practicality: a little ETH on Base for the two gas legs (approve + swap).

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

> "I'm going to paste one link. Open it, connect the wallet you already use, and read what it says. It's asking you to swap twenty dollars of USDC to ETH on Base — real money, your wallet signs, you can reject anything. Do exactly what you'd do if I weren't here, and think out loud if you can. I'm not going to help unless you're stuck for more than a minute. Go."

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

| # | date | who (handle) | source ring | screen passed? (wallet / USDC on Base) | wallet | link slug | open→connect→built→signed→settled | time link-open→sig 2 | "why twice"? | walled? (failures row) | felt-like sentence | H2/H3 hand-off taken? | receipt OK? | returned (date) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| … |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

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
- **Deltas worth a decision:** Ideation §7 surfaces "make Spot Guardian
  EOA-capable" as a product call — until then, no protection ask is
  runnable by any wallet we onboard. My earlier candidate B (funded AAPL
  buy) is demoted to "only for someone who volunteers the word stocks" —
  the bridge job is the most fragile path and H1 deliberately avoids it.
