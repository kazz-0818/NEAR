-- 050/051 で archive 名が既にあると RENAME がスキップされ、
-- public.inbound_messages が実テーブルのまま残る → CREATE VIEW 失敗 → NEAR 起動不能。
-- 実テーブルは一意な archive 名へ退避してから互換 VIEW を作り直す（冪等）。

CREATE SCHEMA IF NOT EXISTS near;

CREATE OR REPLACE FUNCTION near._is_base_table(p_schema text, p_rel text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = p_schema AND c.relname = p_rel AND c.relkind = 'r'
  );
$$;

CREATE OR REPLACE FUNCTION near._archive_public_base_table(p_rel text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  archive_name text;
  n int := 0;
BEGIN
  WHILE near._is_base_table('public', p_rel) LOOP
    n := n + 1;
    archive_name := p_rel || '_archived_' || n::text;
    WHILE near._is_base_table('public', archive_name) LOOP
      n := n + 1;
      archive_name := p_rel || '_archived_' || n::text;
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I RENAME TO %I', p_rel, archive_name);
    RAISE NOTICE '052: archived public.% → %', p_rel, archive_name;
  END LOOP;
END $$;

DO $$
DECLARE
  rel_name text;
BEGIN
  FOREACH rel_name IN ARRAY ARRAY[
    'inbound_messages', 'near_inbound_messages',
    'outbound_messages', 'near_outbound_messages',
    'user_google_oauth_accounts', 'near_user_google_oauth_accounts',
    'user_google_active_oauth', 'near_user_google_active_oauth',
    'intent_runs', 'near_intent_runs',
    'tasks', 'near_tasks',
    'reminders', 'near_reminders',
    'memos', 'near_memos',
    'user_sheet_defaults', 'near_user_sheet_defaults'
  ]
  LOOP
    PERFORM near._archive_public_base_table(rel_name);
  END LOOP;
END $$;

CREATE OR REPLACE VIEW public.inbound_messages AS
  SELECT * FROM near.near_inbound_messages;
CREATE OR REPLACE VIEW public.outbound_messages AS
  SELECT * FROM near.near_outbound_messages;
CREATE OR REPLACE VIEW public.user_google_oauth_accounts AS
  SELECT * FROM near.near_user_google_oauth_accounts;
CREATE OR REPLACE VIEW public.user_google_active_oauth AS
  SELECT * FROM near.near_user_google_active_oauth;
CREATE OR REPLACE VIEW public.intent_runs AS
  SELECT * FROM near.near_intent_runs;
CREATE OR REPLACE VIEW public.tasks AS
  SELECT * FROM near.near_tasks;
CREATE OR REPLACE VIEW public.reminders AS
  SELECT * FROM near.near_reminders;
CREATE OR REPLACE VIEW public.user_sheet_defaults AS
  SELECT * FROM near.near_user_sheet_defaults;
CREATE OR REPLACE VIEW public.memos AS
  SELECT * FROM near.near_memos;
