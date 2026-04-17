-- Yeetful bootstrap: creates all tables matching prisma/schema.prisma and
-- seeds mcp_servers with the 16 default MCP servers that were previously
-- hard-coded in prisma/seed.ts.
--
-- Run on the host (where Postgres is reachable):
--   psql "postgresql://nategeier@127.0.0.1:5432/yeetful" -f scripts/bootstrap.sql
--
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS and ON CONFLICT (slug) DO UPDATE.
--
-- Column naming: all columns use unquoted snake_case so Postgres stores them
-- lowercase. The Prisma schema uses @map("snake_case") decorators to translate
-- between camelCase TypeScript field names and these DB column names.

BEGIN;

-- ---------------------------------------------------------------------------
-- Schema (mirrors prisma/schema.prisma)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mcp_servers (
    id            TEXT        PRIMARY KEY,
    name          TEXT        NOT NULL,
    slug          TEXT        NOT NULL UNIQUE,
    description   TEXT        NOT NULL,
    icon_url      TEXT,
    category      TEXT        NOT NULL,
    website_url   TEXT,
    docs_url      TEXT,
    is_default    BOOLEAN     NOT NULL DEFAULT FALSE,
    is_custom     BOOLEAN     NOT NULL DEFAULT FALSE,
    config_schema JSONB,
    color         TEXT,
    created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chats (
    id         TEXT        PRIMARY KEY,
    title      TEXT        NOT NULL DEFAULT 'New Chat',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_servers (
    id        TEXT PRIMARY KEY,
    chat_id   TEXT NOT NULL,
    server_id TEXT NOT NULL,
    config    JSONB,
    CONSTRAINT chat_servers_chat_fk
        FOREIGN KEY (chat_id)   REFERENCES chats(id)       ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chat_servers_server_fk
        FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chat_servers_chat_server_uniq UNIQUE (chat_id, server_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    tool_calls JSONB,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT messages_chat_fk
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Helpful lookup indexes
CREATE INDEX IF NOT EXISTS mcp_servers_category_idx   ON mcp_servers(category);
CREATE INDEX IF NOT EXISTS mcp_servers_isdefault_idx  ON mcp_servers(is_default);
CREATE INDEX IF NOT EXISTS chat_servers_chat_idx      ON chat_servers(chat_id);
CREATE INDEX IF NOT EXISTS chat_servers_server_idx    ON chat_servers(server_id);
CREATE INDEX IF NOT EXISTS messages_chat_idx          ON messages(chat_id);

-- Keep updated_at in sync without relying on the Prisma client.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mcp_servers_updated_at ON mcp_servers;
CREATE TRIGGER mcp_servers_updated_at
    BEFORE UPDATE ON mcp_servers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS chats_updated_at ON chats;
CREATE TRIGGER chats_updated_at
    BEFORE UPDATE ON chats
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: the 16 default MCP servers previously hard-coded in prisma/seed.ts
-- IDs use a stable 'srv_<slug>' scheme so re-runs are idempotent.
-- ---------------------------------------------------------------------------

INSERT INTO mcp_servers (id, name, slug, description, icon_url, category, website_url, docs_url, color, is_default, is_custom, config_schema) VALUES
('srv_github',       'GitHub',       'github',       'Access repositories, issues, PRs, and code search across GitHub', 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png', 'Development',        'https://github.com',                            'https://docs.github.com',              '#6e40c9', TRUE, FALSE, '{"apiKey":{"type":"string","label":"Personal Access Token","required":true}}'::jsonb),
('srv_slack',        'Slack',        'slack',        'Send messages, search channels, and manage your workspace',       'https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png', 'Communication', 'https://slack.com',                             'https://api.slack.com',                '#4A154B', TRUE, FALSE, '{"botToken":{"type":"string","label":"Bot Token","required":true}}'::jsonb),
('srv_notion',       'Notion',       'notion',       'Read and write to your Notion workspace, pages, and databases',   'https://www.notion.so/images/logo-ios.png',                         'Productivity',        'https://notion.so',                             'https://developers.notion.com',        '#000000', TRUE, FALSE, '{"apiKey":{"type":"string","label":"Integration Token","required":true}}'::jsonb),
('srv_linear',       'Linear',       'linear',       'Manage issues, projects, and sprints in your Linear workspace',   'https://linear.app/favicon.ico',                                    'Project Management',  'https://linear.app',                            'https://developers.linear.app',        '#5E6AD2', TRUE, FALSE, '{"apiKey":{"type":"string","label":"API Key","required":true}}'::jsonb),
('srv_google_drive', 'Google Drive', 'google-drive', 'Browse, read, and search your Google Drive files and folders',    'https://ssl.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png', 'Storage',        'https://drive.google.com',                      'https://developers.google.com/drive',  '#1fa463', TRUE, FALSE, '{"serviceAccountJson":{"type":"textarea","label":"Service Account JSON","required":true}}'::jsonb),
('srv_stripe',       'Stripe',       'stripe',       'Query payments, customers, subscriptions, and financial data',    'https://b.stripecdn.com/manage-statics-srv/assets/public/images/favicon/apple-touch-icon.png', 'Payments', 'https://stripe.com',                    'https://stripe.com/docs/api',          '#635BFF', TRUE, FALSE, '{"secretKey":{"type":"string","label":"Secret Key","required":true}}'::jsonb),
('srv_airtable',     'Airtable',     'airtable',     'Read and update records in your Airtable bases and tables',       'https://airtable.com/images/favicon/baymax/favicon-32x32.png',      'Database',            'https://airtable.com',                          'https://airtable.com/developers/web/api', '#FCB400', TRUE, FALSE, '{"apiKey":{"type":"string","label":"Personal Access Token","required":true}}'::jsonb),
('srv_figma',        'Figma',        'figma',        'Access design files, components, and assets from Figma',          'https://static.figma.com/app/icon/1/favicon.ico',                   'Design',              'https://figma.com',                             'https://www.figma.com/developers/api', '#F24E1E', TRUE, FALSE, '{"accessToken":{"type":"string","label":"Personal Access Token","required":true}}'::jsonb),
('srv_jira',         'Jira',         'jira',         'Manage Jira issues, sprints, boards, and project workflows',      'https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon.png', 'Project Management', 'https://www.atlassian.com/software/jira',  'https://developer.atlassian.com/cloud/jira', '#0052CC', TRUE, FALSE, '{"email":{"type":"string","label":"Email","required":true},"apiToken":{"type":"string","label":"API Token","required":true},"domain":{"type":"string","label":"Domain (e.g. yourco.atlassian.net)","required":true}}'::jsonb),
('srv_hubspot',      'HubSpot',      'hubspot',      'Access CRM data, contacts, deals, and marketing campaigns',       'https://www.hubspot.com/hubfs/HubSpot_Logos/HubSpot-Inversed-Favicon.png', 'CRM',            'https://hubspot.com',                           'https://developers.hubspot.com',       '#FF7A59', TRUE, FALSE, '{"accessToken":{"type":"string","label":"Private App Token","required":true}}'::jsonb),
('srv_shopify',      'Shopify',      'shopify',      'Query products, orders, customers, and store analytics',          'https://cdn.shopify.com/shopifycloud/brochure/assets/brand-assets/shopify-logo-primary-logo-456baa801ee65a0a4f72b2bc2d4a4278.svg', 'E-Commerce', 'https://shopify.com',            'https://shopify.dev/docs/api',         '#96BF48', TRUE, FALSE, '{"shopDomain":{"type":"string","label":"Shop Domain","required":true},"accessToken":{"type":"string","label":"Admin API Token","required":true}}'::jsonb),
('srv_asana',        'Asana',        'asana',        'Manage tasks, projects, teams, and timelines in Asana',           'https://asana.com/favicon.ico',                                     'Project Management',  'https://asana.com',                             'https://developers.asana.com',         '#F06A6A', TRUE, FALSE, '{"accessToken":{"type":"string","label":"Personal Access Token","required":true}}'::jsonb),
('srv_postgresql',   'PostgreSQL',   'postgresql',   'Query and manage your PostgreSQL databases with natural language','https://www.postgresql.org/media/img/about/press/elephant.png',     'Database',            'https://postgresql.org',                        'https://www.postgresql.org/docs',      '#336791', TRUE, FALSE, '{"connectionUrl":{"type":"string","label":"Connection URL","required":true}}'::jsonb),
('srv_aws',          'AWS',          'aws',          'Manage S3, Lambda, EC2, and other AWS services via natural language', 'https://a0.awsstatic.com/libra-css/images/logos/aws_logo_smile_1200x630.png', 'Cloud',  'https://aws.amazon.com',                        'https://docs.aws.amazon.com',          '#FF9900', TRUE, FALSE, '{"accessKeyId":{"type":"string","label":"Access Key ID","required":true},"secretAccessKey":{"type":"string","label":"Secret Access Key","required":true},"region":{"type":"string","label":"Region","required":false}}'::jsonb),
('srv_twilio',       'Twilio',       'twilio',       'Send SMS, make calls, and manage communications programmatically','https://www.twilio.com/assets/icons/twilio-icon-512.png',           'Communication',       'https://twilio.com',                            'https://www.twilio.com/docs',          '#F22F46', TRUE, FALSE, '{"accountSid":{"type":"string","label":"Account SID","required":true},"authToken":{"type":"string","label":"Auth Token","required":true}}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
    name          = EXCLUDED.name,
    description   = EXCLUDED.description,
    icon_url      = EXCLUDED.icon_url,
    category      = EXCLUDED.category,
    website_url   = EXCLUDED.website_url,
    docs_url      = EXCLUDED.docs_url,
    color         = EXCLUDED.color,
    is_default    = EXCLUDED.is_default,
    is_custom     = EXCLUDED.is_custom,
    config_schema = EXCLUDED.config_schema;

COMMIT;

-- Quick sanity check
SELECT COUNT(*) AS mcp_server_count FROM mcp_servers;
SELECT slug, category FROM mcp_servers ORDER BY category, name;
