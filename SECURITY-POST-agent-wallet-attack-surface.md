# DRAFT — The Agent Wallet Attack Surface

> **Status: DRAFT for Nate.** Written by the runway loop (2026-08-04), never
> auto-published. Companion artifact: `guard-sdk/` (@pantessa/guard). Voice
> target: the build-in-public thread style — receipts, not FUD. Numbers and
> PR references are real; verify links before publishing.

---

Everyone building an agent wallet is threat-modeling the wrong layer.

The smart contracts are audited. The RPC is rate-limited. The model has a
system prompt that says "never steal funds." And none of that addresses the
actual attack surface, which is the gap between **what the user asked for**
and **what the composed transaction actually does**.

We've been running an AI transaction engine in production for months —
swaps, perps, lending, NFTs, cross-chain — with a hard rule: *the model
never writes calldata*. Deterministic builders construct every transaction,
and an independent guard re-decodes every artifact before it's offered for
signature. That guard layer has caught four distinct attack classes **live**.
Here they are, with receipts.

## 1. The fabricated address

A cross-chain swap works like this on intent venues: you get a quote, the
venue mints a one-time deposit address, you transfer the sell amount to it,
solvers settle on the destination chain.

Early on, we watched a planner-composed turn nearly offer a transfer to a
deposit address **it had made up**. Not malicious — just a language model
doing what language models do: producing something address-shaped when an
address was expected. Anything that pattern-matches `0x[40 hex chars]` looks
equally plausible in a chat transcript, and a signed transfer to a
hallucinated address is unrecoverable.

The fix is not "prompt it harder." The fix is that the guard decodes the
actual calldata and verifies: `transfer(to, amount)` where `to` **is** the
venue's quoted deposit address and `amount` **is** the quoted atoms, on the
quoted origin chain, or it refuses. The model's prose never enters the
check.

Related, subtler: intent venues let integrators attach app fees — and at
least one major venue **never validates the fee recipient**. Any address in
that field gets paid out of the user's swap. Our guard refuses any fee
entry paying an address we didn't pin.

## 2. The consistent liar

This one is the reason this post exists.

Money markets identify markets by id; the id resolves on-chain to a tuple
(loan token, collateral token, oracle, …). Our guard verified that the
calldata matched the resolved tuple exactly. Airtight, right?

No. An audit found the hole: **nothing ever asked the chain what the loan
token actually was.** A hostile or compromised agent in the user's tool set
could answer "supply USDC" with a *real* market id whose loan token is
WETH. The tuple resolves honestly. The calldata matches the tuple. Every
consistency check passes — because the lie is consistent — and the user
signs an approve + supply of the wrong asset.

The lesson generalizes to every agent wallet: **any `symbol → address`
mapping supplied by a tool is an attack vector.** Consistency checks catch
sloppy liars; they do nothing against consistent ones. The only authority
on what a token *is* is the chain itself — so the guard now reads
`symbol()` and `decimals()` on-chain and refuses on any disagreement,
including an unreadable token. (Fail closed: "I couldn't verify" and "it's
wrong" get the same refusal.)

## 3. The runaway delegate

Autonomous protection — a stop-loss that fires while you sleep — requires a
delegated key. A delegated key that can "trade on your behalf" can, by
default, do a lot more than close your position: it can grow it, flip it,
switch assets, or fire twice on the same trigger.

Our delegated close goes through a ten-check, all-block-level gate before
signing: delegation active and unexpired; kill switch clear; this tick won
the atomic trigger flip (single-fire); exactly one order, standard
grouping; **reduce-only** IOC; asset pinned to the guarded coin; side
opposes the live position; size bounded by the live position; price within
a fixed band of mark; and the trigger condition still true at build time.
The close is *derived* from the live position — side, size, price all
computed, none chosen — so there's nothing for a compromised planner to
choose.

This isn't theoretical coverage: a real stop-loss fired autonomously in
production last month — $11.93 of SYRUP, all ten checks green, position
closed reduce-only. Small money, full dress rehearsal.

## 4. Authorized by crash

The most boring one, and the one I'd bet most agent wallets get wrong.

Spend policies gate what an agent may pay without the owner in the loop:
allowlists, per-call caps, daily budgets, expiry. Ours had a bug class we
caught in an audit: a policy row that **failed to evaluate** — a malformed
date, a bad deserialization — threw, and the catch-all returned
"authorized." The gate's own crash was an approval.

Now a broken gate returns `POLICY_ERROR` and refuses. The same rule
applies across the stack: an action whose USD value can't be priced under
an enabled policy is refused, not waved through ("we couldn't price it" is
not a reason to bypass caps). Kill switches survive everything — including
the policy master switch being off, and including *inflows* (we don't
spend-gate your sale proceeds, but a frozen account refuses everything in
both directions).

## The design rules that fall out

1. **Models propose. Deterministic code verifies. Humans sign.** No
   exceptions, no "trusted" model output.
2. **Decode, don't believe.** Every check runs against decoded calldata or
   venue-signed payloads, never against anyone's summary of them.
3. **Fail closed.** The guard's own failure is never an authorization.
4. **Bind identities to the chain.** Tool-supplied symbol/address/decimals
   claims are attacker input until the chain confirms them.
5. **Derive, don't choose.** Anything a delegate signs should be computable
   from live state, so there is no degree of freedom to compromise.

## The open-core part

We extracted this layer into **@pantessa/guard** — the venue-neutral core:
the spend-policy engine, the artifact guardrails, the delegated-execution
gate, the cross-chain deposit guard, the token-identity binding. Pure
TypeScript, I/O injected, no keys, runs its whole suite offline. In our
repo, a sync check enforces byte-parity between the package and the code
guarding production — it's not a demo, it's the actual guards.

If you're building an agent wallet and any of the four classes above made
you check your own code, that's the point. Come take the guards.

---

> **Publishing notes (Nate):**
> - Receipts to link: the cross-chain guard PR (#374 era), the
>   token-identity find (#597), the guardrail audit (#481), the guardian
>   fire (hl_guardian_runs, 2026-07-14), venue fee-recipient find (#578).
> - Targets per the GTM-rethink memo: MetaMask Agent Wallet, Phantom MCP,
>   Coinbase CDP teams. Window ≈ now→Q1 2027.
> - Decide: publish under the Pantessa blog (fenced-figure system exists)
>   or as a thread first. The package README stands alone if linked.
