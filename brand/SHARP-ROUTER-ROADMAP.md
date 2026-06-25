# Sharp Router — routing roadmap (the "pick the right MCP" problem)

_2026-06-25. Written after the MLB miss: "running score of the latest MLB game"
routed to **Wolfram|Alpha** (returned an empty input-interpretation pod) instead
of **Fanfare**, whose `/mlb/schedule` + `/mlb/game/:game_pk` endpoints are built
for exactly this. The data was there; the router didn't find it._

## Is "route across ALL MCPs from one prompt" possible? Yes — with the caveat:

You will **never** literally put all ~1,800 endpoints in one LLM prompt and get
reliable picks — context cost, latency, and attention dilution ("lost in the
middle") make accuracy *drop* as you add tools. That's the wrong framing.

The right framing: **make RETRIEVAL good enough that the correct MCP is always in
a small shortlist, then let the LLM pick.** This is a solved class of problem
(semantic tool-retrieval / RAG-over-tools). It's real work, but very achievable.
A full knowledge graph is mostly over-engineering — a **capability taxonomy +
embeddings + a feedback loop** gets ~all the value. Two honest limits: it's never
"one prompt over everything," and it's never 100% — you target a *measured*
precision\@1 and push it up.

## Why it misses today (root cause)

The shortlist (`lib/router.shortlistEndpoints`) is **lexical keyword overlap**.
That breaks in three ways the MLB case shows at once:
1. **Semantic gap** — generic answer-engines (Wolfram = "computes anything")
   have broad keyword surfaces and out-score a specific domain MCP.
2. **Wrong endpoint within the right service** — Fanfare's play-by-play needs a
   `:game_pk`; the right first hop is `/mlb/schedule` (resolve today's game),
   *then* the score. Single-pass planning can't express that.
3. **No "did it actually answer" signal** — Wolfram *settled* (we paid, 200 OK)
   but returned nothing useful. We reward "settled," not "answered."

## The architecture (the right way)

A retrieve → rerank → plan pipeline over the WHOLE catalog, with a feedback loop:

```
prompt → intent+expansion → hybrid retrieve (semantic+keyword+capability)
       → rerank → plan (≤1/service, multi-hop) → pay → answer
                                   ↑ reputation + answer-quality feedback ┘
```

## Tasks (sequenced; R0 first — you can't improve what you can't measure)

- **R0 · Routing eval harness.** ~40 representative prompts → expected
  service/capability (incl. the MLB case). Assert on the engine's PICK, not just
  settle. Output precision\@1 + a miss list. Extends the live-test harness.
  _This is how we know if any change helps — and the honest scoreboard for
  "is it working."_ **Do this first.**

- **R1 · Capability taxonomy.** At ingest, LLM-label every service/endpoint with
  a domain (`sports`, `crypto-price`, `web-search`, `weather`, `travel`,
  `onchain`, `math`, `social`, `media`, …), input/output types, and 2–3 example
  queries. Store on the row. Structured signal the router can filter on.

- **R2 · Semantic index (pgvector).** Add `pgvector` on Neon; embed each endpoint
  (name + description + tags + example queries). Query-time embed + **hybrid**
  retrieval (vector ∪ keyword) over ALL endpoints → top ~40. _Biggest single
  lever; directly fixes MLB → Fanfare._

- **R3 · Intent + query expansion.** Cheap first pass: classify intent/domain and
  expand the query (MLB → baseball, scores, live game). Drives the capability
  filter and lifts recall for the lexical gap.

- **R4 · Retrieve → rerank → plan.** Two-stage: hybrid-retrieve top ~40 → LLM
  rerank → top ~10 → plan. Bias **domain-specific over generic** for domain
  intents (a sports MCP beats a general compute engine on "MLB score").

- **R5 · Multi-hop planning.** Resolve dependent calls — `/mlb/schedule`
  (today's game → game_pk) → `/mlb/game/:game_pk` (score). Fill a path param
  from a prior call's result. Unlocks "latest game", "this wallet's biggest
  position", etc.

- **R6 · Answer-quality feedback.** Detect empty/unhelpful results (Wolfram's
  empty pod) as a NEGATIVE signal distinct from "settled" — feed reputation
  (#238) + routing penalty (#242) + incidents (#247). Closes the learning loop.

- **R7 · Capability coverage audit.** Report what the network CAN answer per
  capability + gaps; surface on the leaderboard. Knowing coverage is half of
  good routing.

### Sequencing
R0 (measure) → **R1 + R2** (the core retrieval upgrade — most of the win) →
R3/R4 (precision) → R5 (multi-hop) → R6 (feedback) → R7 (coverage).

### Honest bottom line
Possible, standard, worth doing. The win comes from **retrieval quality +
feedback**, not from stuffing more into the prompt or from a heavyweight graph.
After R0–R2 the MLB-class miss should disappear; R3–R6 push precision\@1 toward
"reliable," and the eval harness proves it at each step.
