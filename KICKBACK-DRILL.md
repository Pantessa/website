# The kickback drill — run the creator loop once, for real

**Why this exists (§2.3 of HANDOFF-gtm-bulletproof.md):** 2,804 intent
links have been minted and **zero** have ever been claimed through to a
kickback by anyone who isn't us. The 50%-lifetime-kickback offer is the
entire YeetCall pitch — before it goes in a single KOL DM, it has to have
executed once, end to end, with real money and two real wallets. A
mechanism nobody has completed is a claim, not a feature.

**Time: ~10 minutes. Cost: two ~$5 swaps (fees: pennies).**

## Before you start (once)

```bash
BASE=http://localhost:3521 npm run drill:kickback
```

Run the rehearsal against a local `next start` build. It walks the exact
machinery — mint → sign-through → first-touch referral → later-trade
accrual → earnings panel — with throwaway wallets and fails loudly at
the first broken step. **Green rehearsal = the real drill below can only
fail on product, which is exactly what you want to learn.**

## The real drill

You need: **wallet A** (creator — your main), **wallet B** (the
"stranger" — a second profile/phone/hardware wallet) holding ~$15 on
Base.

1. **Mint (wallet A).** Sign in on prod, open the rail's **Links** tab →
   mint `Swap $5 of ETH to USDC`. Copy the `/i/…` URL.
2. **Sign through it (wallet B).** Open the link in a separate browser
   profile (never the same one — first-touch keys on the signing
   wallet). Connect B — no SIWE, connect is enough — run the ask, and
   **sign the real swap**.
3. **Check attribution (wallet A).** `/dashboard/links`: the link's row
   shows moved-$ and an `earned` figure (half of the 50bps link tier on
   a $5 swap ≈ **$0.0125** — sub-cent precision renders, that's the
   `formatEarnedUsd` contract).
4. **The lifetime half (wallet B again).** From plain `/chat` — *not*
   the link — swap another $5. Wallet A's earnings gain a **referred**
   component: B belongs to A now, first touch, lifetime.
5. **The claims rail (wallet A).** The earnings panel's *claimable*
   equals lifetime earned. The floor is $10, so today's numbers won't
   clear a payout — the drill verifies the NUMBER, not the transfer.
   (A real $10+ claim end-to-end is the follow-up drill once volume
   exists.)

## What each number is

Server truth only: signed `embed_turns` rows, guardrail-priced,
fee-bearing build paths only (a bridge or NFT transfer moves $ but earns
$0 — the zero says "fee-free route"). Direct link attribution wins
per-turn; unattributed trades by referred wallets accrue to their
first-touch creator. The claims route recomputes the same sums — the
panel and the payout can never disagree.

## If a step fails

That failure is the product gap the whole doctrine hunts for. It lands
in `/dashboard/failures` (money asks) — file it, fix it same-day, rerun.
Do not DM a single KOL until this drill has passed twice: once by us,
once by someone we watched.
