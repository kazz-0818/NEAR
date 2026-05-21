-- public に残ったレガシー実テーブルを near へ再マージし、DROP では archive リネーム。
-- veliora.line_message_events を near 履歴からバックフィル（veliora だけ見て空に感じる問題の救済）。

CREATE SCHEMA IF NOT EXISTS near;
CREATE SCHEMA IF NOT EXISTS veliora;

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

CREATE OR REPLACE FUNCTION near._legacy_col_expr(
  p_schema text, p_rel text, p_col text, p_expr text, p_default text
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = p_schema AND table_name = p_rel AND column_name = p_col
    ) THEN p_expr
    ELSE p_default
  END;
$$;

DO $$
DECLARE
  src_schema text;
  src_rel text;
  archive_name text;
  row_count bigint;
BEGIN
  IF NOT near._is_base_table('near', 'near_inbound_messages') THEN
    RAISE NOTICE '051: skip (near.near_inbound_messages missing)';
    RETURN;
  END IF;

  FOR src_schema, src_rel IN
    SELECT * FROM (VALUES
      ('public', 'inbound_messages'),
      ('public', 'near_inbound_messages')
    ) AS t(s, r)
  LOOP
    IF NOT near._is_base_table(src_schema, src_rel) THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT COUNT(*) FROM %I.%I', src_schema, src_rel) INTO row_count;
    RAISE NOTICE '051: merge inbound % rows from %.%', row_count, src_schema, src_rel;

    EXECUTE format(
      $q$
      INSERT INTO near.near_inbound_messages (
        channel, channel_user_id, actor_user_id, group_id, message_id,
        quoted_message_id, message_type, text, raw_payload, created_at
      )
      SELECT l.channel, l.channel_user_id, %s, %s, l.message_id, %s,
        l.message_type, l.text, l.raw_payload, l.created_at
      FROM %I.%I l
      WHERE NOT EXISTS (
        SELECT 1 FROM near.near_inbound_messages n
        WHERE n.channel = l.channel AND n.message_id = l.message_id
      )
      ON CONFLICT (channel, message_id) DO NOTHING
      $q$,
      near._legacy_col_expr(src_schema, src_rel, 'actor_user_id', 'l.actor_user_id', 'l.channel_user_id'),
      near._legacy_col_expr(src_schema, src_rel, 'group_id', 'l.group_id', 'NULL'),
      near._legacy_col_expr(src_schema, src_rel, 'quoted_message_id', 'l.quoted_message_id', 'NULL'),
      src_schema, src_rel
    );

    archive_name := src_rel || '_archived_051';
    IF NOT near._is_base_table(src_schema, archive_name) THEN
      EXECUTE format('ALTER TABLE %I.%I RENAME TO %I', src_schema, src_rel, archive_name);
      RAISE NOTICE '051: archived %.% → %', src_schema, src_rel, archive_name;
    END IF;
  END LOOP;
END $$;

-- Veliora 横断ログ ← near 実体（046 以前は events 未記録のためここで復元）
INSERT INTO veliora.line_message_events (
  agent_code, direction, channel, line_user_id, actor_user_id, group_id, conversation_key,
  line_message_id, message_type, body_text, raw_payload, legacy_schema, legacy_table, legacy_row_id, created_at
)
SELECT
  'near', 'inbound', i.channel, i.channel_user_id, i.actor_user_id, i.group_id,
  CASE
    WHEN i.group_id IS NOT NULL AND btrim(i.group_id) <> ''
      THEN 'near:' || i.channel || ':group:' || btrim(i.group_id)
    ELSE 'near:' || i.channel || ':dm:' || btrim(i.channel_user_id)
  END,
  i.message_id, i.message_type, i.text, COALESCE(i.raw_payload, '{}'::jsonb),
  'near', 'near_inbound_messages', i.id, i.created_at
FROM near.near_inbound_messages i
WHERE NOT EXISTS (
  SELECT 1 FROM veliora.line_message_events e
  WHERE e.agent_code = 'near' AND e.legacy_schema = 'near'
    AND e.legacy_table = 'near_inbound_messages' AND e.legacy_row_id = i.id
);

INSERT INTO veliora.line_message_events (
  agent_code, direction, channel, line_user_id, actor_user_id, group_id, conversation_key,
  line_message_id, message_type, body_text, raw_payload, legacy_schema, legacy_table, legacy_row_id, created_at
)
SELECT
  'near', 'outbound', o.channel, o.channel_user_id, o.channel_user_id, o.group_id,
  CASE
    WHEN o.group_id IS NOT NULL AND btrim(o.group_id) <> ''
      THEN 'near:' || o.channel || ':group:' || btrim(o.group_id)
    ELSE 'near:' || o.channel || ':dm:' || btrim(o.channel_user_id)
  END,
  o.line_message_id, 'text', o.text, '{}'::jsonb,
  'near', 'near_outbound_messages', o.id, o.created_at
FROM near.near_outbound_messages o
WHERE NOT EXISTS (
  SELECT 1 FROM veliora.line_message_events e
  WHERE e.agent_code = 'near' AND e.legacy_schema = 'near'
    AND e.legacy_table = 'near_outbound_messages' AND e.legacy_row_id = o.id
);

CREATE OR REPLACE VIEW public.inbound_messages AS
  SELECT * FROM near.near_inbound_messages;
CREATE OR REPLACE VIEW public.outbound_messages AS
  SELECT * FROM near.near_outbound_messages;
