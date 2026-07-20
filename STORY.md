# What Yeetful is

*The one-pager every surface has to agree with. If a page, a doc, a nav item,
or a tweet can't trace its sentence back to this, cut it or fix it.
(2026-07-20, written under the full-tilt mandate; thesis history lives in
brand/PROBLEM.md and STRATEGY.md.)*

## One sentence

**Yeetful is the non-custodial back office for autonomous money.**

## One paragraph

You tell Yeetful what should happen — once. Buy $10 of AAPL every week.
Close my position if it drops 8%. Fund the wallet, wait for it to settle,
then stake. Yeetful compiles the sentence into deterministic, guarded
transactions, and your own wallet stays the only thing that can sign. Every
build is priced, capped, receipted, and killable. Then it keeps running —
at 3am, on a Tuesday, while nobody's watching. The best screenshot of the
product is the one where nobody was at the keyboard.

## The stack (why each layer exists)

| Layer | What it is | Role |
|---|---|---|
| **Guardrails** | Deterministic builders, fail-closed guards, caps, receipts, kill switches. The model never writes calldata or addresses. | **The moat.** The buying criterion for autonomous money is "what stops this from draining me." |
| **Standing intents** | Jobs, DCA schedules, Guardian protections, funded agents. | **Retention.** The only flow that recurs — and recurring flow × 0.20% is the business. |
| **Embed + free MCPs** | The chat that mounts on any site in five lines and signs with the host page's wallet; the free MCP fleet. | **Distribution.** |
| **Fees on flow + plans** | 0.20% on movement (treasury: read it from lib/fees.ts, never retype), monthly plans, x402 paid doors. | **The model.** |

## The scoreboard

Money moved splits into **attended** (a human typed it and signed it) and
**standing** (a job, a schedule, the guardian, or a paying agent fired it).
The company exists the week the standing line grows on its own. It's live on
/activity — watch that line, not the vanity total.

## One sentence per surface

- **/** — Tell it once. It keeps running. *(show the machine: jobs, DCA, guardian, funding, receipts)*
- **/chat** — Say what should happen; sign what it builds.
- **/embed** — This whole thing, on your site, in five lines.
- **/dashboard** — Your keys, your embeds, your money moved.
- **/servers** — The MCPs you can hand to the chat — free fleet first.
- **/activity** — Every dollar the system moved, and who was watching.
- **/docs** — Three doors: embed it (hosts), trust it (users), pay it (agent devs).
- **/pricing** — Plain and honest. The autonomy is what you're paying for.

## What we say (and don't)

- Say **"standing"** money, **"attended"** money. Say **"your own wallet
  signs"** — never "we hold," because we don't.
- Say what the guardrails literally do: pinned contracts, re-derived
  calldata, fail-closed, receipts. Specifics are the marketing.
- The x402 catalog, App-mode, token-launchpad era: demoted. They exist;
  they don't lead. Don't delete history — stop narrating it.
- One wink per page, maximum. Money surfaces get zero.
