-- Veriora: optional backfill veliora.line_message_events → veriora.conversations + messages
-- Idempotent. Safe to re-run. Does not delete or update legacy rows.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'veliora' AND table_name = 'line_message_events'
  ) THEN
    RAISE NOTICE '061: skip (veliora.line_message_events missing)';
    RETURN;
  END IF;
END $$;

-- Upsert conversations from distinct conversation_key per agent
INSERT INTO veriora.conversations (
  agent_id, source, line_user_id, line_group_id, conversation_key,
  status, started_at, last_message_at, created_at, updated_at
)
SELECT
  a.id,
  COALESCE(NULLIF(btrim(MAX(e.channel)), ''), 'line'),
  MAX(e.line_user_id),
  MAX(e.group_id),
  g.conversation_key,
  'active',
  MIN(e.created_at),
  MAX(e.created_at),
  MIN(e.created_at),
  MAX(e.created_at)
FROM (
  SELECT agent_code, conversation_key
  FROM veliora.line_message_events
  WHERE btrim(conversation_key) <> ''
  GROUP BY agent_code, conversation_key
) g
JOIN veliora.ai_agents a ON a.agent_key = g.agent_code
JOIN veliora.line_message_events e
  ON e.agent_code = g.agent_code AND e.conversation_key = g.conversation_key
WHERE NOT EXISTS (
  SELECT 1 FROM veriora.conversations c
  WHERE c.agent_id = a.id AND c.conversation_key = g.conversation_key
)
GROUP BY a.id, g.conversation_key;

-- Backfill messages (skip duplicates via legacy_row_id on veliora events)
INSERT INTO veriora.messages (
  conversation_id,
  agent_id,
  direction,
  role,
  message_type,
  text,
  raw_payload,
  legacy_schema,
  legacy_table,
  legacy_row_id,
  created_at
)
SELECT
  c.id,
  a.id,
  CASE
    WHEN e.direction = 'outbound' THEN 'outbound'
    WHEN e.direction = 'inbound' THEN 'inbound'
    ELSE 'system'
  END,
  CASE
    WHEN e.direction = 'outbound' THEN 'assistant'
    WHEN e.direction = 'inbound' THEN 'user'
    ELSE 'system'
  END,
  COALESCE(NULLIF(btrim(e.message_type), ''), 'text'),
  e.body_text,
  COALESCE(e.raw_payload, '{}'::jsonb),
  e.legacy_schema,
  e.legacy_table,
  e.id,
  e.created_at
FROM veliora.line_message_events e
JOIN veriora.ai_agents a ON a.agent_key = e.agent_code
JOIN veriora.conversations c ON c.agent_id = a.id AND c.conversation_key = e.conversation_key
WHERE NOT EXISTS (
  SELECT 1 FROM veriora.messages m
  WHERE m.legacy_schema = e.legacy_schema
    AND m.legacy_table = e.legacy_table
    AND m.legacy_row_id = e.id
);
