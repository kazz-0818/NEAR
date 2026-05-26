-- Veliora: routing, handoff, audit logs

CREATE TABLE IF NOT EXISTS veriora.agent_routing_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID REFERENCES veriora.conversations (id) ON DELETE SET NULL,
  from_agent_id    UUID REFERENCES veriora.ai_agents (id) ON DELETE SET NULL,
  to_agent_id      UUID REFERENCES veriora.ai_agents (id) ON DELETE SET NULL,
  intent           TEXT,
  confidence       NUMERIC,
  reason           TEXT,
  raw_result       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veriora_routing_logs_created
  ON veriora.agent_routing_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_veriora_routing_logs_conversation
  ON veriora.agent_routing_logs (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS veriora.agent_handoff_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID REFERENCES veriora.conversations (id) ON DELETE SET NULL,
  from_agent_id    UUID REFERENCES veriora.ai_agents (id) ON DELETE SET NULL,
  to_agent_id      UUID REFERENCES veriora.ai_agents (id) ON DELETE SET NULL,
  handoff_reason   TEXT,
  summary          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veriora_handoff_logs_created
  ON veriora.agent_handoff_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS veriora.agent_audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID REFERENCES veriora.ai_agents (id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info',
  message     TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veriora_audit_logs_agent_created
  ON veriora.agent_audit_logs (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_veriora_audit_logs_event_created
  ON veriora.agent_audit_logs (event_type, created_at DESC);

ALTER TABLE veriora.agent_routing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE veriora.agent_handoff_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE veriora.agent_audit_logs ENABLE ROW LEVEL SECURITY;
