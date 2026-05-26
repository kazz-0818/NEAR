-- Veliora: unify LINE log read path; deprecate public NEAR compat VIEW shortcuts.
-- Safe additive: veliora.line_message_events table unchanged; veliora.line_messages becomes unified read model.

COMMENT ON SCHEMA veliora IS 'Legacy LINE / Veliora namespace. Writes optional (VERIORA_LEGACY_VELIORA_LINE_LOG). Reads: veliora.line_messages unified VIEW.';

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
FROM veriora.messages m
JOIN veriora.ai_agents a ON a.id = m.agent_id
LEFT JOIN veriora.conversations c ON c.id = m.conversation_id

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
FROM veliora.line_message_events e
WHERE NOT EXISTS (
  SELECT 1
  FROM veriora.messages m2
  WHERE m2.legacy_schema IS NOT DISTINCT FROM e.legacy_schema
    AND m2.legacy_table IS NOT DISTINCT FROM e.legacy_table
    AND m2.legacy_row_id IS NOT DISTINCT FROM e.legacy_row_id
);

COMMENT ON VIEW veliora.line_messages IS
  'Unified LINE history: veriora.messages (canonical) + veliora.line_message_events not yet mirrored. Prefer veriora.message_feed for new integrations.';

-- NEAR-only public shortcuts (duplicate near.* in Table Editor). Drop after 052/062 security_invoker refresh.
DROP VIEW IF EXISTS public.inbound_messages;
DROP VIEW IF EXISTS public.outbound_messages;
DROP VIEW IF EXISTS public.user_google_oauth_accounts;
DROP VIEW IF EXISTS public.user_google_active_oauth;
DROP VIEW IF EXISTS public.intent_runs;
DROP VIEW IF EXISTS public.tasks;
DROP VIEW IF EXISTS public.reminders;
DROP VIEW IF EXISTS public.user_sheet_defaults;
DROP VIEW IF EXISTS public.memos;
