-- Veriora Vegapunk: プロフィール・記憶・会話リンク

CREATE TABLE IF NOT EXISTS veriora.customer_profiles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id             UUID NOT NULL REFERENCES veriora.customers (id) ON DELETE CASCADE,
  profile_type            TEXT NOT NULL,
  profile_key             TEXT NOT NULL,
  profile_value           TEXT,
  confidence              NUMERIC NOT NULL DEFAULT 0.5,
  source_agent_key        TEXT,
  source_conversation_id    UUID REFERENCES veriora.conversations (id) ON DELETE SET NULL,
  source_message_id       UUID REFERENCES veriora.messages (id) ON DELETE SET NULL,
  is_sensitive            BOOLEAN NOT NULL DEFAULT false,
  requires_confirmation   BOOLEAN NOT NULL DEFAULT true,
  confirmed               BOOLEAN NOT NULL DEFAULT false,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_profiles_customer_type_key
  ON veriora.customer_profiles (customer_id, profile_type, profile_key);

CREATE TABLE IF NOT EXISTS veriora.customer_memory_notes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id             UUID NOT NULL REFERENCES veriora.customers (id) ON DELETE CASCADE,
  note                    TEXT NOT NULL,
  category                TEXT,
  source_agent_key        TEXT,
  source_conversation_id    UUID REFERENCES veriora.conversations (id) ON DELETE SET NULL,
  source_message_id       UUID REFERENCES veriora.messages (id) ON DELETE SET NULL,
  importance              TEXT NOT NULL DEFAULT 'medium',
  confidence              NUMERIC NOT NULL DEFAULT 0.5,
  confirmed               BOOLEAN NOT NULL DEFAULT false,
  expires_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_memory_notes_customer
  ON veriora.customer_memory_notes (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS veriora.customer_agent_contexts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id             UUID NOT NULL REFERENCES veriora.customers (id) ON DELETE CASCADE,
  agent_key               TEXT NOT NULL,
  context_summary         TEXT,
  last_conversation_id    UUID REFERENCES veriora.conversations (id) ON DELETE SET NULL,
  last_interaction_at     TIMESTAMPTZ,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_customer_agent_contexts_customer_agent UNIQUE (customer_id, agent_key)
);

CREATE TABLE IF NOT EXISTS veriora.customer_conversation_links (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES veriora.customers (id) ON DELETE CASCADE,
  conversation_id   UUID NOT NULL REFERENCES veriora.conversations (id) ON DELETE CASCADE,
  agent_key         TEXT,
  link_reason       TEXT,
  confidence        NUMERIC NOT NULL DEFAULT 1.0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_customer_conversation_links UNIQUE (customer_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_conversation_links_conversation
  ON veriora.customer_conversation_links (conversation_id);

DROP TRIGGER IF EXISTS trg_veriora_customer_profiles_updated ON veriora.customer_profiles;
CREATE TRIGGER trg_veriora_customer_profiles_updated
  BEFORE UPDATE ON veriora.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION veriora.set_updated_at();

DROP TRIGGER IF EXISTS trg_veriora_customer_memory_notes_updated ON veriora.customer_memory_notes;
CREATE TRIGGER trg_veriora_customer_memory_notes_updated
  BEFORE UPDATE ON veriora.customer_memory_notes
  FOR EACH ROW EXECUTE FUNCTION veriora.set_updated_at();

DROP TRIGGER IF EXISTS trg_veriora_customer_agent_contexts_updated ON veriora.customer_agent_contexts;
CREATE TRIGGER trg_veriora_customer_agent_contexts_updated
  BEFORE UPDATE ON veriora.customer_agent_contexts
  FOR EACH ROW EXECUTE FUNCTION veriora.set_updated_at();
