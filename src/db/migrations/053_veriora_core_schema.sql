-- Veriora OS: canonical schema (additive). Legacy veliora.* remains unchanged.

CREATE SCHEMA IF NOT EXISTS veriora;

COMMENT ON SCHEMA veriora IS 'Veriora organization OS — canonical tables (UUID agents, conversations, messages)';

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veriora.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- agent_departments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS veriora.agent_departments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_key  TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veriora_agent_departments_key
  ON veriora.agent_departments (department_key);

-- ---------------------------------------------------------------------------
-- ai_agents (canonical master; agent_key aligns with registry id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS veriora.ai_agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key     TEXT NOT NULL UNIQUE,
  code          TEXT NOT NULL,
  kana          TEXT NOT NULL,
  department    TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL,
  description   TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veriora_ai_agents_code ON veriora.ai_agents (code);
CREATE INDEX IF NOT EXISTS idx_veriora_ai_agents_enabled ON veriora.ai_agents (enabled) WHERE enabled = true;

DROP TRIGGER IF EXISTS trg_veriora_ai_agents_updated ON veriora.ai_agents;
CREATE TRIGGER trg_veriora_ai_agents_updated
  BEFORE UPDATE ON veriora.ai_agents
  FOR EACH ROW EXECUTE FUNCTION veriora.set_updated_at();

ALTER TABLE veriora.agent_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE veriora.ai_agents ENABLE ROW LEVEL SECURITY;
