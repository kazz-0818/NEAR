-- Veriora: conversations + messages (canonical message store for all agents)

CREATE TABLE IF NOT EXISTS veriora.conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID NOT NULL REFERENCES veriora.ai_agents (id) ON DELETE RESTRICT,
  source           TEXT NOT NULL,
  line_user_id     TEXT,
  line_group_id    TEXT,
  title            TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  conversation_key TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_veriora_conversations_agent_key
  ON veriora.conversations (agent_id, conversation_key)
  WHERE conversation_key IS NOT NULL AND btrim(conversation_key) <> '';

CREATE INDEX IF NOT EXISTS idx_veriora_conversations_agent_last
  ON veriora.conversations (agent_id, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_veriora_conversations_line_user
  ON veriora.conversations (line_user_id, created_at DESC)
  WHERE line_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_veriora_conversations_updated ON veriora.conversations;
CREATE TRIGGER trg_veriora_conversations_updated
  BEFORE UPDATE ON veriora.conversations
  FOR EACH ROW EXECUTE FUNCTION veriora.set_updated_at();

CREATE TABLE IF NOT EXISTS veriora.messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES veriora.conversations (id) ON DELETE CASCADE,
  agent_id         UUID NOT NULL REFERENCES veriora.ai_agents (id) ON DELETE RESTRICT,
  direction        TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal', 'system')),
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  message_type     TEXT NOT NULL DEFAULT 'text',
  text             TEXT,
  raw_payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_calls       JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  legacy_schema    TEXT,
  legacy_table     TEXT,
  legacy_row_id    BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veriora_messages_conversation_created
  ON veriora.messages (conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_veriora_messages_agent_created
  ON veriora.messages (agent_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_veriora_messages_legacy
  ON veriora.messages (legacy_schema, legacy_table, legacy_row_id)
  WHERE legacy_row_id IS NOT NULL AND legacy_schema IS NOT NULL AND legacy_table IS NOT NULL;

ALTER TABLE veriora.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE veriora.messages ENABLE ROW LEVEL SECURITY;
