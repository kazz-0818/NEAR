-- Supabase Security Advisor 対策（additive・破壊なし）
-- 1) public 互換 VIEW を security_invoker 化（anon は実表 RLS を継承）
-- 2) 共有 DB の exposed 想定 schema / RITS public テーブルに RLS 有効化（ポリシーなし＝deny）
-- 3) 関数 search_path 固定

-- ---------------------------------------------------------------------------
-- Helper: 実テーブルが public に無いときだけ invoker VIEW を張る
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION near._ensure_public_invoker_view(
  p_public_name text,
  p_select_sql text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = near, pg_temp
AS $$
BEGIN
  IF near._is_base_table('public', p_public_name) THEN
    RAISE NOTICE '062: skip view % (public base table still exists)', p_public_name;
    RETURN;
  END IF;
  EXECUTE format(
    'CREATE OR REPLACE VIEW public.%I WITH (security_invoker = true) AS %s',
    p_public_name,
    p_select_sql
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- NEAR public 互換 VIEW
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('near.near_inbound_messages') IS NOT NULL THEN
    PERFORM near._ensure_public_invoker_view(
      'inbound_messages',
      'SELECT * FROM near.near_inbound_messages'
    );
  END IF;
  IF to_regclass('near.near_outbound_messages') IS NOT NULL THEN
    PERFORM near._ensure_public_invoker_view(
      'outbound_messages',
      'SELECT * FROM near.near_outbound_messages'
    );
  END IF;
  IF to_regclass('near.near_user_google_oauth_accounts') IS NOT NULL THEN
    PERFORM near._ensure_public_invoker_view(
      'user_google_oauth_accounts',
      'SELECT * FROM near.near_user_google_oauth_accounts'
    );
  END IF;
  IF to_regclass('near.near_user_google_active_oauth') IS NOT NULL THEN
    PERFORM near._ensure_public_invoker_view(
      'user_google_active_oauth',
      'SELECT * FROM near.near_user_google_active_oauth'
    );
  END IF;
  IF to_regclass('near.near_intent_runs') IS NOT NULL THEN
    PERFORM near._ensure_public_invoker_view(
      'intent_runs',
      'SELECT * FROM near.near_intent_runs'
    );
  END IF;
  IF to_regclass('near.near_tasks') IS NOT NULL THEN
    PERFORM near._ensure_public_invoker_view('tasks', 'SELECT * FROM near.near_tasks');
  END IF;
  IF to_regclass('near.near_reminders') IS NOT NULL THEN
    PERFORM near._ensure_public_invoker_view('reminders', 'SELECT * FROM near.near_reminders');
  END IF;
  IF to_regclass('near.near_user_sheet_defaults') IS NOT NULL THEN
    PERFORM near._ensure_public_invoker_view(
      'user_sheet_defaults',
      'SELECT * FROM near.near_user_sheet_defaults'
    );
  END IF;
  IF to_regclass('near.near_memos') IS NOT NULL THEN
    PERFORM near._ensure_public_invoker_view('memos', 'SELECT * FROM near.near_memos');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- SERA public 互換 VIEW
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'sera_inbound_messages',
    'sera_meta_connections',
    'sera_instagram_media',
    'sera_instagram_insights_daily',
    'sera_meta_ad_accounts',
    'sera_ad_insights_daily',
    'sera_growth_reports',
    'sera_api_sync_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF to_regclass('sera.' || t) IS NOT NULL AND NOT near._is_base_table('public', t) THEN
      PERFORM near._ensure_public_invoker_view(t, format('SELECT * FROM sera.%I', t));
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- LIRA public 互換 VIEW（トリガは維持）
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('lira.lira_audit_log') IS NULL THEN
    RETURN;
  END IF;
  IF near._is_base_table('public', 'lira_audit_log') THEN
    RAISE NOTICE '062: skip lira_audit_log view (public base table)';
    RETURN;
  END IF;
  DROP VIEW IF EXISTS public.lira_audit_log;
  CREATE VIEW public.lira_audit_log
    WITH (security_invoker = true)
    AS
      SELECT id, created_at, source, detail
      FROM lira.lira_audit_log;
  COMMENT ON VIEW public.lira_audit_log IS
    '互換VIEW → lira.lira_audit_log（security_invoker）。INSERT は trg_public_lira_audit_log_insert。';
END $$;

CREATE OR REPLACE FUNCTION lira.public_lira_audit_log_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
BEGIN
  INSERT INTO lira.lira_audit_log (id, created_at, source, detail)
  VALUES (
    COALESCE(NEW.id, gen_random_uuid()),
    COALESCE(NEW.created_at, now()),
    NEW.source,
    COALESCE(NEW.detail, '{}'::jsonb)
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.lira_audit_log') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_public_lira_audit_log_insert ON public.lira_audit_log;
    CREATE TRIGGER trg_public_lira_audit_log_insert
      INSTEAD OF INSERT ON public.lira_audit_log
      FOR EACH ROW
      EXECUTE FUNCTION lira.public_lira_audit_log_insert();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS: near / sera 全実テーブル（ポリシーなし＝ anon/authenticated deny）
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('near', 'sera')
      AND c.relkind = 'r'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      r.schema_name,
      r.table_name
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- RLS: RITS public テーブル（共有 DB）
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'agent_profiles',
    'agent_logs',
    'agent_audits',
    'unsupported_requests',
    'system_errors',
    'daily_reports'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF near._is_base_table('public', t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- RLS: LRAM / veliora レガシー LINE ログ / migration 履歴
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.lram_schema_migrations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  lram_tables text[] := ARRAY[
    'lram_requests',
    'lram_article_ideas',
    'lram_articles',
    'lram_article_reviews',
    'lram_logs',
    'lram_settings'
  ];
BEGIN
  FOREACH t IN ARRAY lram_tables
  LOOP
    IF near._is_base_table('public', t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

ALTER TABLE IF EXISTS veliora.line_message_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('lira', 'veriora')
      AND c.relkind = 'r'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      r.schema_name,
      r.table_name
    );
  END LOOP;
END $$;

ALTER TABLE IF EXISTS lira.lira_sheet_resolution_log ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 関数 search_path 固定
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veriora.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = veriora, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION near._legacy_has_column(p_schema text, p_rel text, p_col text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = near, pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = p_schema
      AND table_name = p_rel
      AND column_name = p_col
  );
$$;

CREATE OR REPLACE FUNCTION near._is_base_table(p_schema text, p_rel text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = near, pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = p_schema
      AND c.relname = p_rel
      AND c.relkind = 'r'
  );
$$;

CREATE OR REPLACE FUNCTION near._legacy_col_expr(
  p_schema text, p_rel text, p_col text, p_expr text, p_default text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = near, pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN near._legacy_has_column(p_schema, p_rel, p_col) THEN p_expr
    ELSE p_default
  END;
$$;

CREATE OR REPLACE FUNCTION near._archive_public_base_table(p_rel text)
RETURNS void
LANGUAGE plpgsql
SET search_path = near, pg_temp
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
    RAISE NOTICE 'near_merge: archived public.% → %', p_rel, archive_name;
  END LOOP;
END $$;
