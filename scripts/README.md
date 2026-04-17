# Database bootstrap

The Prisma schema lives in `prisma/schema.prisma`. The previously hard-coded
MCP server list (in `prisma/seed.ts`) has been mirrored into
`scripts/bootstrap.sql` so the tables can be created and seeded in a single
`psql` run, without needing Node or Prisma installed.

## One-shot bootstrap (raw SQL)

```bash
psql "postgresql://nategeier@127.0.0.1:5432/yeetful" -f scripts/bootstrap.sql
```

This creates `mcp_servers`, `chats`, `chat_servers`, `messages` (matching the
Prisma schema exactly) and seeds the 15 default MCP servers. The script is
idempotent — re-run it any time and it will upsert rows by `slug`.

## Prisma-managed bootstrap (equivalent)

```bash
pnpm install
pnpm db:push      # creates the tables from schema.prisma
pnpm db:seed      # runs prisma/seed.ts (same 15 servers)
```

## Adding a new MCP server

Three ways, all writing to the same `mcp_servers` table.

**1. SQL**

```sql
INSERT INTO mcp_servers (id, name, slug, description, category, "iconUrl", "websiteUrl", color, "isDefault", "isCustom", "configSchema")
VALUES (
  'srv_vercel', 'Vercel', 'vercel',
  'Deploy, inspect, and manage Vercel projects',
  'Cloud',
  'https://vercel.com/favicon.ico',
  'https://vercel.com',
  '#000000',
  FALSE, TRUE,
  '{"token":{"type":"string","label":"API Token","required":true}}'::jsonb
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description;
```

**2. CLI helper (Prisma)**

```bash
pnpm tsx scripts/add-mcp-server.ts '{
  "name": "Vercel",
  "description": "Deploy, inspect, and manage Vercel projects",
  "category": "Cloud",
  "iconUrl": "https://vercel.com/favicon.ico",
  "websiteUrl": "https://vercel.com",
  "color": "#000000",
  "configSchema": { "token": { "type": "string", "label": "API Token", "required": true } }
}'
```

**3. HTTP (Next.js API)**

```bash
curl -X POST http://localhost:3000/api/servers \
  -H 'Content-Type: application/json' \
  -d '{"name":"Vercel","description":"...","category":"Cloud"}'
```

## Verify

```bash
psql "postgresql://nategeier@127.0.0.1:5432/yeetful" -c \
  'SELECT slug, category, "isDefault" FROM mcp_servers ORDER BY category, name;'
```
