-- Veliora: RITS quality reviews, findings, improvement tasks

CREATE TABLE IF NOT EXISTS veriora.agent_quality_reviews (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_date          DATE NOT NULL,
  agent_id             UUID REFERENCES veriora.ai_agents (id) ON DELETE SET NULL,
  score_overall        NUMERIC,
  score_understanding  NUMERIC,
  score_accuracy       NUMERIC,
  score_role_adherence NUMERIC,
  score_actionability  NUMERIC,
  summary              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_veriora_quality_reviews_agent_date
  ON veriora.agent_quality_reviews (agent_id, review_date)
  WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_veriora_quality_reviews_date
  ON veriora.agent_quality_reviews (review_date DESC);

CREATE TABLE IF NOT EXISTS veriora.agent_quality_findings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id        UUID REFERENCES veriora.agent_quality_reviews (id) ON DELETE CASCADE,
  agent_id         UUID REFERENCES veriora.ai_agents (id) ON DELETE SET NULL,
  conversation_id  UUID REFERENCES veriora.conversations (id) ON DELETE SET NULL,
  message_id       UUID REFERENCES veriora.messages (id) ON DELETE SET NULL,
  category         TEXT NOT NULL,
  severity         TEXT NOT NULL,
  finding          TEXT NOT NULL,
  suggestion       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veriora_quality_findings_review
  ON veriora.agent_quality_findings (review_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_veriora_quality_findings_agent
  ON veriora.agent_quality_findings (agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS veriora.agent_improvement_tasks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_finding_id   UUID REFERENCES veriora.agent_quality_findings (id) ON DELETE SET NULL,
  target_agent_id     UUID REFERENCES veriora.ai_agents (id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  description         TEXT,
  cursor_instruction  TEXT,
  priority            TEXT NOT NULL DEFAULT 'medium',
  status              TEXT NOT NULL DEFAULT 'draft',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veriora_improvement_tasks_status
  ON veriora.agent_improvement_tasks (status, created_at DESC);

DROP TRIGGER IF EXISTS trg_veriora_improvement_tasks_updated ON veriora.agent_improvement_tasks;
CREATE TRIGGER trg_veriora_improvement_tasks_updated
  BEFORE UPDATE ON veriora.agent_improvement_tasks
  FOR EACH ROW EXECUTE FUNCTION veriora.set_updated_at();

ALTER TABLE veriora.agent_quality_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE veriora.agent_quality_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE veriora.agent_improvement_tasks ENABLE ROW LEVEL SECURITY;
