-- COMMUNITY (squad community, 2026-11-09). Additive only. Run on TEST by the
-- squad (scripts/run-ddl.ts); PROD is an owner step BEFORE the PR merges
-- (the feed and the forum select the new chart_posts columns).

ALTER TABLE chart_posts ADD COLUMN IF NOT EXISTS community_slug text;
ALTER TABLE chart_posts ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE chart_posts ADD COLUMN IF NOT EXISTS proof_turn_id text;
ALTER TABLE chart_posts ADD COLUMN IF NOT EXISTS proof jsonb;
ALTER TABLE chart_posts ADD COLUMN IF NOT EXISTS score integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS chart_posts_community_slug_is_internal_created_at_idx ON chart_posts (community_slug, is_internal, created_at);
CREATE INDEX IF NOT EXISTS chart_posts_is_internal_created_at_idx ON chart_posts (is_internal, created_at);

CREATE TABLE IF NOT EXISTS communities (
  slug text PRIMARY KEY,
  name text NOT NULL,
  about text NOT NULL DEFAULT '',
  owner text NOT NULL,
  symbols text[] NOT NULL DEFAULT '{}',
  member_count integer NOT NULL DEFAULT 0,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS communities_is_internal_member_count_idx ON communities (is_internal, member_count);

CREATE TABLE IF NOT EXISTS community_members (
  id text PRIMARY KEY,
  community_slug text NOT NULL,
  member_key text NOT NULL,
  wallet text,
  display_name text,
  role text NOT NULL DEFAULT 'member',
  via text,
  source text NOT NULL DEFAULT 'site',
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS community_members_community_slug_member_key_key ON community_members (community_slug, member_key);
CREATE INDEX IF NOT EXISTS community_members_member_key_idx ON community_members (member_key);
CREATE INDEX IF NOT EXISTS community_members_community_slug_via_idx ON community_members (community_slug, via);
CREATE INDEX IF NOT EXISTS community_members_community_slug_created_at_idx ON community_members (community_slug, created_at);

CREATE TABLE IF NOT EXISTS community_invites (
  code text PRIMARY KEY,
  community_slug text NOT NULL,
  inviter_key text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS community_invites_community_slug_inviter_key_key ON community_invites (community_slug, inviter_key);

CREATE TABLE IF NOT EXISTS post_votes (
  post_id text NOT NULL,
  voter_key text NOT NULL,
  value integer NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, voter_key)
);
CREATE INDEX IF NOT EXISTS post_votes_voter_key_idx ON post_votes (voter_key);

CREATE TABLE IF NOT EXISTS community_channels (
  id text PRIMARY KEY,
  community_slug text NOT NULL,
  platform text NOT NULL,
  external_id text NOT NULL,
  title text,
  secret text,
  linked_by text NOT NULL,
  announce boolean NOT NULL DEFAULT true,
  last_post_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS community_channels_platform_external_id_key ON community_channels (platform, external_id);
CREATE INDEX IF NOT EXISTS community_channels_community_slug_idx ON community_channels (community_slug);

CREATE TABLE IF NOT EXISTS channel_link_codes (
  code text PRIMARY KEY,
  community_slug text NOT NULL,
  platform text NOT NULL,
  created_by text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS identity_links (
  provider text NOT NULL,
  external_id text NOT NULL,
  wallet text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, external_id)
);
CREATE INDEX IF NOT EXISTS identity_links_wallet_idx ON identity_links (wallet);

-- Whose posts reach the linked chats (QA-SECURITY S10): owner + mods by default.
ALTER TABLE communities ADD COLUMN IF NOT EXISTS announce_from text NOT NULL DEFAULT 'mods';
