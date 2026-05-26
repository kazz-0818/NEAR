-- Veliora: rename accounting agent LIRA → IRIE (agent_key, code, display, legacy schema)

-- ---------------------------------------------------------------------------
-- veriora.ai_agents + departments
-- ---------------------------------------------------------------------------
UPDATE veriora.agent_departments
SET description = 'IRIE — 経理・数値'
WHERE department_key = 'accounting';

UPDATE veriora.ai_agents
SET
  agent_key = 'irie',
  code = 'IRIE',
  kana = 'イリ',
  display_name = 'IRIE-イリ-『経理部』',
  updated_at = now()
WHERE agent_key = 'lira';

INSERT INTO veriora.ai_agents (
  agent_key, code, kana, department, display_name, role, description, enabled
)
SELECT
  'irie', 'IRIE', 'イリ', '経理部', 'IRIE-イリ-『経理部』',
  '売上・経費・請求・入金・利益管理',
  '経理・数値の整理。スプレッドシート正の経理支援。',
  true
WHERE NOT EXISTS (SELECT 1 FROM veriora.ai_agents WHERE agent_key = 'irie');

-- ---------------------------------------------------------------------------
-- agent_key / channel_key columns (veriora customer + messaging)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'veriora' AND table_name = 'conversations' AND column_name = 'agent_key'
  ) THEN
    UPDATE veriora.conversations SET agent_key = 'irie' WHERE agent_key = 'lira';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'veriora' AND table_name = 'conversations' AND column_name = 'agent_id'
  ) THEN
    UPDATE veriora.conversations c
    SET agent_id = irie.id
    FROM veriora.ai_agents irie, veriora.ai_agents lira
    WHERE c.agent_id = lira.id AND lira.agent_key = 'lira' AND irie.agent_key = 'irie';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'veriora' AND table_name = 'messages' AND column_name = 'agent_key'
  ) THEN
    UPDATE veriora.messages SET agent_key = 'irie' WHERE agent_key = 'lira';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'veriora' AND table_name = 'messages' AND column_name = 'agent_id'
  ) THEN
    UPDATE veriora.messages m
    SET agent_id = irie.id
    FROM veriora.ai_agents irie, veriora.ai_agents lira
    WHERE m.agent_id = lira.id AND lira.agent_key = 'lira' AND irie.agent_key = 'irie';
  END IF;
END $$;
UPDATE veriora.customer_identities
SET
  agent_key = 'irie',
  channel_key = CASE
    WHEN channel_key = 'lira_line' THEN 'irie_line'
    ELSE channel_key
  END
WHERE agent_key = 'lira' OR channel_key = 'lira_line';
UPDATE veriora.customer_agent_contexts SET agent_key = 'irie' WHERE agent_key = 'lira';
UPDATE veriora.customer_conversation_links SET agent_key = 'irie' WHERE agent_key = 'lira';
UPDATE veriora.customer_memory_notes SET source_agent_key = 'irie' WHERE source_agent_key = 'lira';
UPDATE veriora.agent_routing_logs ar
SET from_agent_id = (SELECT id FROM veriora.ai_agents WHERE agent_key = 'irie' LIMIT 1)
FROM veriora.ai_agents a
WHERE ar.from_agent_id = a.id AND a.agent_key = 'lira';
UPDATE veriora.agent_routing_logs ar
SET to_agent_id = (SELECT id FROM veriora.ai_agents WHERE agent_key = 'irie' LIMIT 1)
FROM veriora.ai_agents a
WHERE ar.to_agent_id = a.id AND a.agent_key = 'lira';
UPDATE veriora.agent_handoff_logs ar
SET from_agent_id = (SELECT id FROM veriora.ai_agents WHERE agent_key = 'irie' LIMIT 1)
FROM veriora.ai_agents a
WHERE ar.from_agent_id = a.id AND a.agent_key = 'lira';
UPDATE veriora.agent_handoff_logs ar
SET to_agent_id = (SELECT id FROM veriora.ai_agents WHERE agent_key = 'irie' LIMIT 1)
FROM veriora.ai_agents a
WHERE ar.to_agent_id = a.id AND a.agent_key = 'lira';

-- ---------------------------------------------------------------------------
-- veliora legacy LINE log
-- ---------------------------------------------------------------------------
UPDATE veliora.ai_agents
SET agent_code = 'irie', display_name = 'IRIE'
WHERE agent_code = 'lira';

UPDATE veliora.line_message_events
SET agent_code = 'irie'
WHERE agent_code = 'lira';

-- conversation_key prefix: lira: → irie:
UPDATE veriora.conversations
SET conversation_key = regexp_replace(conversation_key, '^lira:', 'irie:')
WHERE conversation_key LIKE 'lira:%';

-- ---------------------------------------------------------------------------
-- Postgres schema lira → irie (accounting service tables)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'lira')
     AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'irie') THEN
    ALTER SCHEMA lira RENAME TO irie;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('irie.lira_audit_log') IS NOT NULL THEN
    ALTER TABLE irie.lira_audit_log RENAME TO irie_audit_log;
  END IF;
  IF to_regclass('irie.lira_sheet_resolution_log') IS NOT NULL THEN
    ALTER TABLE irie.lira_sheet_resolution_log RENAME TO irie_sheet_resolution_log;
  END IF;
END $$;

COMMENT ON SCHEMA irie IS 'IRIE 経理エージェント専用（旧 lira schema）';
