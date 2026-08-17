# MCP registry manifests (owner submits)

Pantessa ships two agent-facing MCP servers. Getting them listed where agents
shop for tools is the distribution channel the moonshot bets on (agents arrive
at directory scale, each bringing its humans). The manifests here are prepped;
**submission is a Nate-only step** — most registries verify domain/namespace
ownership.

| server | manifest | endpoint | docs |
|---|---|---|---|
| `com.pantessa/hands` | `hands.server.json` | `https://hands-mcp.yeetful.com/mcp` | `/docs/desk` |
| `com.pantessa/desk` | `desk.server.json` | `https://www.pantessa.com/api/broker/mcp` | `/docs/desk` |

The `.server.json` files follow the official MCP registry `server.schema.json`
shape (a starting point — each target registry has its own submission form).

## Submission targets, in leverage order

1. **Official MCP registry** (`registry.modelcontextprotocol.io`) — publish via
   the `mcp-publisher` CLI. Namespace `com.pantessa/*` needs domain verification
   (a DNS TXT or an `.well-known` file on `pantessa.com`); do this once and both
   servers publish under it.
2. **Smithery** (`smithery.ai`) — connect the GitHub repos and add a
   `smithery.yaml` per server, or submit the hosted URL directly.
3. **mcp.so** — submit the hosted endpoint + description via its add form.
4. **Anthropic connector directory** — once the desk is out of preview
   (`BROKER_DESK_ENABLED=true` in prod) and the hands MCP has a stable listing.

## Before submitting the desk

The desk's agent-signed path is fail-closed: it serves only when
`BROKER_DESK_ENABLED=true` is set on Vercel (see `lib/broker-policy.ts`). List
the **hands** MCP first (it is live today with no gating); list the desk once it
is enabled in prod, so a first caller never hits a paused surface.

## Turning on desk pricing (owner + one follow-on)

The desk (`com.pantessa/desk`) is free to call by default and advertises that in
`broker_capabilities` (`pricing.model = "free"`). The pricing config already
exists (`lib/broker-pricing.ts`, fail-closed to free); flipping it to paid is
config + one route:

1. Set on Vercel: `BROKER_PAYMENT_ADDRESS=0x…` (the treasury pay-to),
   `BROKER_X402_PRICE_USD` (default `0.02`), `BROKER_X402_NETWORK` (default
   `base`). With the address set, `broker_capabilities` flips to
   `pricing.model = "x402-per-call"` and names the priced tools + endpoint.
2. **Follow-on route (not yet built):** add `/api/broker/paid/[transport]`
   wrapping the SAME handler behind the x402 payment challenge (the two-door
   pattern in `@yeetful/mcp-kit`'s `x402.ts` — `loadX402DoorConfig` +
   `paymentProxy`). This pulls `@x402/next` + `@coinbase/x402` into the website
   and needs a CDP facilitator, so it is a deliberate deploy step, not an
   autonomous one. The **x402 payer address becomes the agent's `agent_key`
   identity** — payment and identity are the same fact.

Until step 2 ships, pricing is advertised but the free door is the only door —
never a paid path that serves for nothing.

## Keeping these current

Bump `version` when the tool set changes, and keep the `tools` arrays in sync
with what the servers actually register (`services/hands/lib/tools.ts` and
`app/api/broker/[transport]/route.ts`). A stale manifest misdescribes the
product to every agent that reads it — the exact bug M2 fixed on the hands
contract.
