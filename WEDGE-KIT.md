# WEDGE KIT — ten strangers, by hand (L2-Q4, written 2026-08-18)

The §3 doctrine of `HANDOFF-gtm-bulletproof.md`, made runnable: **no KOL DM,
no launch thread, no campaign until ten strangers have each completed one
real transaction and told us what it felt like.** This kit is everything Nate
needs to recruit one person, watch them, and record it — ten times.

Companion instruments: `npm run digest:gtm` (the daily arc + money + failures
+ blocklist watch), `/dashboard/failures?funded=1` (what walled them),
`/dashboard/admin` "The arc · strangers only", the per-link funnel on
`/dashboard/links` (open → connect → built → signed → settled).

---

## 0. Read this first — the ask we planned to lead with is not available on prod

THE WEEK item 7 (CLAUDE.md, 2026-08-17) says: *"Lead with the Spot Guardian
protection ask — it works on wallet balances today."* Verified against
production on 2026-08-18 and it does not, for two independent reasons:

1. **Not provisioned in prod.** `POST https://www.pantessa.com/api/chat` with
   `Protect my spot ETH with a 10% stop loss` (wallet attached, read-only,
   internal-stamped) returns
   `🛡️ Spot protection runs on the autopilot rails, which aren't provisioned in this environment yet.`
   (`buildPath: native-spot-guard`). The CDP spender env
   (`CDP_API_KEY_ID/SECRET`, `CDP_WALLET_SECRET`, `CDP_SPEND_NETWORK=base`)
   is not set on Vercel — the memory note `dca-autopilot` lists it as an
   owner activation step that was never run.
2. **Every front door yields an EOA, and the arm needs a smart wallet.** The
   Spend Permission is enforced by the grantor wallet's own contract
   (`lib/spot-guard.ts` header; `SpendPermissionManager.spend` executes
   through a Coinbase Smart Wallet). But MetaMask/Rabby are EOAs, the CDP
   email/Google wallet is created `eoa` (`lib/cdp-embedded.ts:32`), and the
   RainbowKit Coinbase connector is pinned `eoaOnly` (`lib/wagmi.ts:48`).
   Worse: unlike DCA autopilot (`lib/dca-auto-exec.ts:248-259` — a `getCode`
   smart-wallet check that refuses EOAs by name), **the Spot Guardian arm
   turn has no such check** (`lib/spot-guard-exec.ts` `runSpotGuardTurn`):
   once provisioned, a MetaMask stranger would receive the full arm offer,
   the arm route's `simulateApprove` (ECDSA-valid for an EOA) would pass,
   the policy would be stored `active`, and the sweep would revert at fire
   time. A stranger who believes they are protected and is not is the worst
   possible first impression. → QA/Security finding, filed in
   `squad-2026-08-18/gtm.md`.

So the wedge leads with an ask that a MetaMask stranger can complete on
production **today**. All three below were built live on 2026-08-18 against
prod (read-only, `activeServers: []`, internal-stamped):

| candidate ask | prod result 2026-08-18 | why it's a wedge | dependency |
|---|---|---|---|
| **A. `Swap $5 of ETH to USDC on Base`** | `native-swap-cow` → `orderRequest` (signable CoW order) | The "first real transaction" with zero setup: any wallet with a few dollars of Base ETH. Proves connect → build → sign → receipt in under a minute. | none |
| **B. `Buy $12 of AAPL on Robinhood Chain`** | `native-swap-uniswap` → `txChain` (approve + swap on 4663) for a funded 4663 wallet; unfunded wallets get the Base-USDC funding chips → bridge → buy job | The differentiated one — a tokenized stock from a chat, funding handled. Nate's own 08-12 drill hit the LiFi revert; #641 (merged) routes the buy through the v3 cascade now. | recruit holds ≥$15 USDC on Base (or Eth/Arb) + a little gas; two or three signatures |
| **C. `DCA $10 into ETH weekly`** | confirm-mode schedule + first-period buy job (EOA-safe; house link `/i/dca-eth`) | The **standing intent** — the company thesis, and the only ask that brings the recruit BACK (the arc's `returned` stop) without a smart wallet. | recruit returns next week to sign period 2 — that return is the point |

**Recommendation (Nate decides — this is a §5-adjacent product call):** run
**A then C in the same sitting.** A gets the stranger through the whole
funnel with nothing to explain; C plants the standing intent that measures
retention. Use B for recruits who already hold USDC on Base and say the word
"stocks" — it is the best story and the most fragile path. Do NOT lead with
Spot Guardian or the HL protected-long until items 1–2 above and THE WEEK
item 2 (treasury / fee env) are cleared and WALLET-MATRIX §4 rows 5–6 are
green on MetaMask.

> **Alignment note:** the Ideation lane's `squad-2026-08-18/ideation.md` did
> not exist when this kit was written; the channel list in §2 is my own and
> should be re-aligned to Ideation's "ten strangers + agent builders" output
> in round 2.

---

## 1. Who — the recruit profile (ten names, one at a time)

Not a persona. Ten people Nate can DM today and get on a 15-minute call.

- Has MetaMask or Rabby installed and **already holds a few dollars on Base**
  (ETH for A/C; USDC for B). Someone who has to bridge first is a different,
  longer test — save them for round two.
- Has never used Pantessa/Yeetful. Not a friend who has heard the pitch.
  Not a crypto-security person (their feedback is about the guard, not the
  door).
- Willing to screen-share (Zoom/Meet/Discord call) for ten minutes and say
  what they are thinking out loud. **Watching is non-negotiable** — the arc
  cannot tell us *why* someone stopped.
- Where they come from (channels, in the order I'd try them; re-align with
  Ideation in round 2):
  1. Nate's own DMs — people who replied to any build-in-public post since
     July, then people who follow @nategeier and post about on-chain trading.
  2. The Base / Hyperliquid / Uniswap Discords' "show-and-tell" style
     channels — a personal ask, not a link drop (drop = spam = reputation
     risk while the blocklist entry is live).
  3. Two or three indie-hacker / agent-builder communities (the moonshot's
     audience) — they hold Base ETH and are used to being someone's first
     user.
  4. Anyone who came through `/rebrand` or the org GitHub and asked a
     question.
- **Explicitly not:** KOLs (KOL-KIT.md is §4, gated on this kit succeeding),
  anyone reached by broadcast, anyone we'd need to fund first.

## 2. The DM — Nate's plain build-in-public voice

Send one at a time. Personalise the first line to something they actually
posted. No link in the first message; the link goes out on the call.

> hey — quick honest ask.
>
> I've spent a year building a thing that turns a sentence into a guarded on-chain transaction you sign from your own wallet (no deposits, no custody, an independent guard re-decodes every byte before it ever reaches you). It works. Nobody who isn't me has used it yet, and I'd rather find out what's confusing by watching one real person than by guessing.
>
> Would you give me 10 minutes on a call this week? You screen-share, I hand you one link, you do one small real thing (about $5 of ETH → USDC on Base — your wallet, your keys, your gas), and I shut up and watch. Afterwards I'll ask you three questions and that's it. If it walls you, that's the most useful outcome for me and I'll fix it the same day.
>
> No pitch, no follow-up sequence, no token. Just a stranger test. Yes/no?

Follow-up (once, 48h later, only if no reply): "no worries if not — if you
know someone who holds a bit of ETH on Base and likes breaking things, I'd
take an intro."

## 3. Before the call — the checklist (5 minutes)

- [ ] `npm run digest:gtm` this morning: serving domains **clean** on both
      feeds (a LISTED serving domain exits 2 — do not run a stranger into a
      wallet interstitial).
- [ ] Prod sanity: open `https://www.pantessa.com/i/<slug>` in a fresh
      profile — the page renders, the connect door opens.
- [ ] Mint the recruit's own link so their funnel is a row of its own: on
      `/links` (or the rail's Links tab), mint the exact ask (A: `Swap $5 of
      ETH to USDC on Base`) — one link per recruit, note the slug in the
      table in §6. (Nate's wallet is a test wallet, so links he mints count
      as *creator link* source in the arc, not house — that is fine, and
      the per-link funnel is what we read anyway.)
- [ ] Two tabs open on Nate's side: `/dashboard/failures?funded=1` and
      `/dashboard/links` (the recruit's slug row).
- [ ] Recording consent asked in the DM or at the top of the call.

## 4. On the call — the 60-second script, then silence

Say this, then stop talking:

> "I'm going to paste one link. Open it, connect the wallet you already use, and read what it says. It's asking you to swap about five dollars of ETH to USDC on Base — real money, your wallet signs, you can reject anything. Do exactly what you'd do if I weren't here, and think out loud if you can. I'm not going to help unless you're stuck for more than a minute. Go."

Then watch. Write down, with timestamps:

| moment | what to note |
|---|---|
| Link opens | Do they read the card or hunt for the button? First words. |
| Connect | Which wallet, which chain it was on, did the sign-in modal confuse them (rule 6: connect to act, no SIWE on /i). |
| The build appears | Do they understand what will happen? Do they read the guard line / the fee line? |
| The wallet popup | Does the wallet warn (Blockaid "deceptive request" is a known false positive on x402 receivers — note if it appears)? Do they hesitate? |
| Sign or reject | If reject: their exact words. If sign: time from link-open to signature. |
| Receipt | Do they know it's done? Do they click the explorer link? |
| Second ask (C) | Type or tap `DCA $10 into ETH weekly` — do they get the standing intent? Do they sign period 1? |

Only intervene after ~60s of being stuck, and log that you did (it is a
funnel failure even if they finish).

If it walls: **do not fix it live.** Screenshot, note the exact ask and
wallet, check `/dashboard/failures` — the row is the ticket. Thank them,
tell them you'll ping when it's fixed, and mean it.

## 5. After — the receipt ask (three questions, then the favour)

Ask, in this order, and write the answers verbatim:

1. "In one sentence, what did that just do?"  (comprehension)
2. "What was the moment you almost stopped?"   (the wall or the doubt)
3. "Would you use the weekly one without me on the call? Why / why not?" (retention)

Then the favour, only if they signed and it settled:

> "Would you mind if I quoted that / posted the receipt? Your address gets shortened, and I'll show you the post first."

A stranger's receipt + one honest sentence is the only content that compounds
(§4). Do not ask for a follow, a retweet, or a testimonial. If they offer,
fine.

Same-day: every wall becomes an `ask_failures` row → a fix PR (the #595/#621
loop). Ping them when it ships — that ping is the second-visit prompt.

## 6. Tracking table (copy into a private doc; the link funnel is the truth)

| # | date | who (handle) | source channel | wallet | ask | link slug | open→connect→built→signed→settled | time to sign | walled? (failures row) | Q1 | Q2 | Q3 | receipt OK? | returned (date) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 |  |  |  |  | A |  |  |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| … |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

**Bar to move to §4 (KOLs, embed partners, content):** ten signed, at least
three returned unprompted (the C schedule's period-2 signature counts).
**Kill criterion:** if ten hand-held people cannot be made to complete and
return, the problem is positioning or market — the answer is §5, not
features.

## 7. What the kit assumes the product does (owed to QA/UI — verify before call #1)

- `/i/<slug>` for a Nate-minted link: connect-only door (no SIWE), ask
  auto-fires on connect, the CoW order card renders and signs from MetaMask
  on Base without a chain-mismatch refusal (WALLET-MATRIX §4 row 2).
- Receipt renders with an explorer link; the link's funnel row shows
  `signed` within a minute (per-link events).
- `DCA $10 into ETH weekly` typed in the same thread creates the schedule +
  offers the period-1 buy; the rail's Jobs tab shows it; a return visit next
  week offers period 2 (lazy due detection).
- Buy-AAPL for an unfunded wallet answers funding chips (never a planner
  paragraph) — the funded queue's 08-12 rows are exactly this class.
- Spot Guardian: **either** refuse EOAs by name (port the DCA autopilot
  `getCode` check) **or** keep it un-provisioned; never a silent arm that
  cannot fire.
