-- Veliora: compatibility views (read-only bridges to legacy stores)

-- Legacy veliora.ai_agents (text PK) → canonical veriora.ai_agents
CREATE OR REPLACE VIEW veriora.legacy_veliora_ai_agents AS
SELECT
  v.agent_code,
  v.display_name,
  v.parent_brand,
  v.is_active,
  v.created_at,
  a.id AS veriora_agent_id,
  a.agent_key,
  a.code,
  a.department
FROM veliora.ai_agents v
LEFT JOIN veriora.ai_agents a ON a.agent_key = v.agent_code;

-- Unified read model over canonical messages (for RITS / admin)
CREATE OR REPLACE VIEW veriora.message_feed AS
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
FROM veriora.messages m
JOIN veriora.ai_agents a ON a.id = m.agent_id
LEFT JOIN veriora.conversations c ON c.id = m.conversation_id;

-- Legacy LINE events → shape similar to message_feed (when canonical backfill not done)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'veliora' AND table_name = 'line_message_events'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW veriora.line_events_compat AS
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
      FROM veliora.line_message_events e
    $v$;
  END IF;
END $$;

-- RITS public.agent_logs compat (read-only)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agent_logs'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW veriora.rits_agent_logs_compat AS
      SELECT
        l.id,
        l.agent_name,
        a.id AS veriora_agent_id,
        a.agent_key,
        l.user_message,
        l.agent_reply,
        l.intent,
        l.confidence,
        l.source,
        l.metadata,
        l.created_at
      FROM public.agent_logs l
      LEFT JOIN veriora.ai_agents a ON upper(a.code) = upper(l.agent_name)
    $v$;
  END IF;
END $$;

-- LRAM legacy public tables (if present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lram_article_ideas'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW veriora.lram_article_ideas_compat AS
      SELECT * FROM public.lram_article_ideas
    $v$;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lram_articles'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW veriora.lram_articles_compat AS
      SELECT * FROM public.lram_articles
    $v$;
  END IF;
END $$;
