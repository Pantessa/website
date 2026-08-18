# DRAFT — NOT FOR PUBLICATION UNTIL NATE CALLS THE §5 FORK

> Status: draft only (L2-Q5 of HANDOFF-gtm-bulletproof.md). This is the §5-B
> content bet — it only makes sense if Nate picks "guard layer as
> infrastructure, consumer chat as the showcase." Publishing is the admin
> blog toggle (owner-only; blog publish tests hit the PROD DB). Numbers below
> are the honest ones from `npm run digest:gtm` on 2026-08-18 and must be
> re-run the morning it ships. Do not soften them.

---

## Our interface got blocklisted. The guard is the product.

*Working title alternatives: "The blocklist was right about us" · "What a
year of building a transaction guard taught me when our own demo got flagged"*

Last summer we did something that, in hindsight, is the exact thing a
wallet-drainer does.

We were building an embeddable chat that turns a sentence — "swap $5 of ETH
to USDC", "buy $12 of AAPL on Robinhood Chain", "protect my long with a 5%
stop" — into a guarded on-chain transaction the user signs from their own
wallet. To show that the widget installs on any existing app in a few lines,
we forked the open-source Uniswap interface, mounted our chat, and put it up
at `uniswap-embed.yeetful.com`. Then we did the same with CoW Swap.

Within a few weeks MetaMask's phishing detector and SEAL's blocklist both
listed the Uniswap fork. They were right to. A well-known DEX's interface,
served from a domain that isn't the DEX's, on a subdomain carrying the DEX's
name, is indistinguishable at scan time from a clone that swaps the router
address for a drainer. Our fork changed about 25 lines and never touched
routing, contracts, or recipients — and none of that is visible to a scanner,
nor should the scanner have to take our word for it.

We took both sites down for good, archived the repos in public so the diff
against upstream is inspectable, pulled every link, and wrote ourselves a
rule: never host or brand anything that looks like someone else's product.
Then we renamed the company (Yeetful → Pantessa), which — I know — is also
exactly what a drainer does after getting listed. So we published a dated,
signed record of the rename with a verify-it-yourself table at
`pantessa.com/rebrand`, filed the delisting request under our own name, and
kept the old domain redirecting so nothing installed on it breaks. A rebrand
you announce is a fact; a redirect a scanner discovers is a finding.

Here is the part I actually want to write about.

### The blocklist could not see the one thing we care about

The listing was about the *front door*: a familiar-looking page on the wrong
domain. Every wallet-safety tool in the ecosystem is a front-door tool —
domain reputation, address reputation, simulation of what a signature will
do. They are essential and they are all downstream of the same question:
*can the thing asking me to sign be trusted?*

We spent the year on a different question: *what if it can't, and it's fine?*

The architecture we ended up with has one invariant that everything else
hangs off: **the model never writes calldata.** An LLM parses the sentence
into a typed intent — token, amount, chain, venue, trigger. Deterministic
per-venue builders (Uniswap v3/v4, CoW, Aave, Lido, Hyperliquid, NEAR
Intents, LiFi, Seaport, the Robinhood Chain bridge) turn that intent into
bytes. Then an independent guard re-decodes every byte — selector, target,
recipient, amounts, deadlines, fee legs — and compares it against the intent
and a live quote, and refuses if anything is off. Only then does the user's
wallet see a request. If the planner hallucinates a venue, the guard has
never heard of it. If a tool returns a "helpful" transaction with a
third-party recipient, the guard refuses it. If a deposit address is
fabricated (this happened, once, in testing — a cross-chain tool answered
with an address that wasn't its own), the guard checks the transfer target
against the tool's real one-time address and fails closed.

We got listed for the door. The building was never the problem. And the
building — the guard — is what every agentic-money product is going to need
and none of them want to write.

### The honest numbers

Because a post like this is worth nothing if it's a pitch: as of this
morning, real strangers have moved **$7,589 across 44 signed transactions**
through the product, ever. Since the rename, essentially zero. Our own
dashboard used to say $288k, then $490k, then $673k — that was our test
harness writing rows that looked like users, and we only caught it when we
started asking "who exactly signed that?" (Rotating whale wallets, four
signed turns each, identical $1,349 values. Not subtle, once you look.) The
per-day arrival curve on our arrival tables matched our own test-run days
exactly. So the honest read is not "everybody bounces." It's "nobody has
come yet."

I'm writing that down in public because I'd rather build on it than on the
big number.

### What we're doing with it

1. Publishing the guard as a standalone package (`@pantessa/guard`, MIT) —
   the invariant and the re-decoders, no chat required — so anyone building
   an agent that touches money can bolt on "the model never writes calldata,
   an independent guard re-decodes every byte" without trusting us.
2. Keeping the consumer chat alive as the flagship demo that proves the
   guard in production — receipts, not slides.
3. Getting ten real strangers through one real transaction each, by hand,
   on a call, before we say a louder word than this post.

If you review domains for a wallet or a blocklist: the entry for
`uniswap-embed.yeetful.com` is still live as I write this, the host has been
404 for weeks, and the request to remove it is in your queue under my name.
If you build agents that move money: the guard is the part you want, and I'd
like to hear what it fails on.

— Nate

---

### Screenshot list (capture the morning it ships; all public surfaces)

1. `https://www.pantessa.com/rebrand` — the dated record + verify table.
2. The MetaMask stalelist entry (terminal: `curl … /v1/stalelist | jq` grep
   for `uniswap-embed.yeetful.com`) and `curl -I https://uniswap-embed.yeetful.com` → 404, side by side.
3. The removal-request issue on `MetaMask/eth-phishing-detect` (the NEW one,
   once filed — not #273376).
4. `/activity` hero: the honest money-moved figure ($7,589 / 44 as of
   2026-08-18) — never the raw `embed_turns` sum.
5. One real receipt: a guarded build card (guard checks green, fee line
   visible) next to its explorer link — Nate's own signed USDG→AMD or a
   stranger's, with their permission.
6. The guard refusing something: the planner-artifact guard's refusal on a
   third-party-recipient tool result, or the venue-gated-pool refusal
   ("never burn a signature") — the fail-closed moment.
7. `@pantessa/guard` on npm (after publish; today it 404s — do not ship the
   post before it exists).

### Do-not-ship checklist

- [ ] Nate has called the §5 fork (B as wedge, A as showcase) — else this
      post is off-strategy.
- [ ] `@pantessa/guard` is published (the post links it).
- [ ] The NEW MetaMask issue is filed and linked (not the closed one).
- [ ] Numbers re-run via `npm run digest:gtm` the same morning.
- [ ] `/rebrand` no longer says the appeal is "open at #273376".
