-- Veliora: 正典 Postgres スキーマ veriora → veliora、旧 LINE スキーマ veliora → veliora_line_legacy
-- 冪等: 既にリネーム済みの DB ではスキップ

DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'veliora')
     AND EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'veliora' AND table_name = 'line_message_events'
     )
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'veriora')
     AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'veliora_line_legacy')
  THEN
    ALTER SCHEMA veliora RENAME TO veliora_line_legacy;
  END IF;
END $block$;

DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'veriora')
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'veriora' AND table_name = 'ai_agents' AND column_name = 'agent_key'
     )
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'veliora' AND table_name = 'ai_agents' AND column_name = 'agent_key'
     )
  THEN
    ALTER SCHEMA veriora RENAME TO veliora;
  END IF;
END $block$;

COMMENT ON SCHEMA veliora IS 'Veliora organization OS — canonical tables (UUID agents, conversations, messages)';
DO $cmt$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'veliora_line_legacy') THEN
    EXECUTE $q$COMMENT ON SCHEMA veliora_line_legacy IS 'Legacy LINE line_message_events (VELIORA_LEGACY_LINE_LOG)'$q$;
  END IF;
END $cmt$;

-- 統合 LINE 履歴 VIEW（正典 veliora + legacy 未ミラー行）
DROP VIEW IF EXISTS veliora.line_messages;
DROP VIEW IF EXISTS veliora_line_legacy.line_messages;

CREATE OR REPLACE VIEW veliora.line_messages
WITH (security_invoker = true)
AS
SELECT
  COALESCE(m.legacy_row_id, abs(hashtext(m.id::text)))::bigint AS id,
  a.agent_key AS agent_code,
  m.direction::text AS direction,
  COALESCE(c.source, 'line') AS channel,
  c.line_user_id,
  NULL::text AS actor_user_id,
  c.line_group_id AS group_id,
  c.conversation_key,
  NULL::text AS line_message_id,
  m.message_type,
  m.text,
  m.raw_payload,
  m.legacy_schema,
  m.legacy_table,
  m.legacy_row_id,
  m.created_at
FROM veliora.messages m
JOIN veliora.ai_agents a ON a.id = m.agent_id
LEFT JOIN veliora.conversations c ON c.id = m.conversation_id

UNION ALL

SELECT
  e.id,
  e.agent_code,
  e.direction,
  e.channel,
  e.line_user_id,
  e.actor_user_id,
  e.group_id,
  e.conversation_key,
  e.line_message_id,
  e.message_type,
  e.body_text AS text,
  e.raw_payload,
  e.legacy_schema,
  e.legacy_table,
  e.legacy_row_id,
  e.created_at
FROM veliora_line_legacy.line_message_events e
WHERE NOT EXISTS (
  SELECT 1
  FROM veliora.messages m2
  WHERE m2.legacy_schema IS NOT DISTINCT FROM e.legacy_schema
    AND m2.legacy_table IS NOT DISTINCT FROM e.legacy_table
    AND m2.legacy_row_id IS NOT DISTINCT FROM e.legacy_row_id
);

COMMENT ON VIEW veliora.line_messages IS
  'Unified LINE history: veliora.messages + veliora_line_legacy.line_message_events not yet mirrored.';

-- legacy ai_agents (text PK) 突合 VIEW
DROP VIEW IF EXISTS veliora.legacy_veliora_ai_agents;
CREATE OR REPLACE VIEW veliora.legacy_veliora_line_ai_agents AS
SELECT
  v.agent_code,
  v.display_name,
  v.parent_brand,
  v.is_active,
  v.created_at,
  a.id AS veliora_agent_id,
  a.agent_key,
  a.code,
  a.department
FROM veliora_line_legacy.ai_agents v
LEFT JOIN veliora.ai_agents a ON a.agent_key = v.agent_code;

COMMENT ON VIEW veliora.legacy_veliora_line_ai_agents IS
  'Maps veliora_line_legacy.ai_agents (text PK) to veliora.ai_agents (UUID).';

CREATE OR REPLACE VIEW veliora.message_feed AS
SELECT
  m.id,
  m.conversation_id,
  m.agent_id,
  a.agent_key,
  a.code AS agent_code,
  a.display_name AS agent_display_name,
  m.direction,
  m.role,
  m.message_type,
  m.text,
  m.raw_payload,
  m.tool_calls,
  m.metadata,
  m.legacy_schema,
  m.legacy_table,
  m.legacy_row_id,
  m.created_at,
  c.source,
  c.line_user_id,
  c.line_group_id,
  c.conversation_key
FROM veliora.messages m
JOIN veliora.ai_agents a ON a.id = m.agent_id
LEFT JOIN veliora.conversations c ON c.id = m.conversation_id;

DO $ev$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'veliora_line_legacy' AND table_name = 'line_message_events'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW veliora.line_events_compat AS
      SELECT
        e.id AS legacy_event_id,
        e.agent_code,
        e.direction,
        e.channel AS source,
        e.line_user_id,
        e.group_id AS line_group_id,
        e.conversation_key,
        e.body_text AS text,
        e.raw_payload,
        e.legacy_schema,
        e.legacy_table,
        e.legacy_row_id,
        e.created_at
      FROM veliora_line_legacy.line_message_events e
    $v$;
  END IF;
END $ev$;
