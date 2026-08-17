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

## Keeping these current

Bump `version` when the tool set changes, and keep the `tools` arrays in sync
with what the servers actually register (`services/hands/lib/tools.ts` and
`app/api/broker/[transport]/route.ts`). A stale manifest misdescribes the
product to every agent that reads it — the exact bug M2 fixed on the hands
contract.
