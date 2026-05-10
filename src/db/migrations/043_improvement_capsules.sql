-- Improvement Capsule v1: 軽量候補ログ + 日次まとめ分析用カプセル

CREATE TABLE IF NOT EXISTS improvement_candidates (
  candidate_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_user_id      TEXT        NOT NULL,
  inbound_message_id   BIGINT      NOT NULL REFERENCES inbound_messages (id) ON DELETE CASCADE,
  trigger_message_id   TEXT        NOT NULL,
  trigger_reason       TEXT        NOT NULL,
  user_message         TEXT,
  near_reply           TEXT,
  parsed_intent        JSONB,
  route_taken          TEXT,
  module_name          TEXT,
  used_llm_fallback    BOOLEAN     NOT NULL DEFAULT false,
  used_growth_pipeline BOOLEAN     NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  analyzed_at          TIMESTAMPTZ,
  analysis_batch_id    TEXT,
  status               TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'analyzed', 'ignored'))
);

CREATE INDEX IF NOT EXISTS improvement_candidates_pending_created_idx
  ON improvement_candidates (status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS improvement_candidates_pending_dedupe_lookup_idx
  ON improvement_candidates (inbound_message_id, trigger_reason)
  WHERE status = 'pending';

COMMENT ON TABLE improvement_candidates IS 'NEAR 改善カプセル用: 会話ごとの軽量ルール検知のみ（LLM分析は日次バッチ）';

CREATE TABLE IF NOT EXISTS improvement_capsules (
  capsule_id              BIGSERIAL PRIMARY KEY,
  analysis_batch_id       TEXT        NOT NULL,
  problem_type            TEXT        NOT NULL,
  problem_summary         TEXT        NOT NULL,
  context_summary         TEXT        NOT NULL,
  improvement_proposal    TEXT        NOT NULL,
  suggested_requirements  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  priority                TEXT        NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  confidence              DOUBLE PRECISION NOT NULL,
  source_candidate_ids    UUID[]      NOT NULL DEFAULT '{}',
  status                  TEXT        NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'notified', 'approved', 'rejected', 'issue_created', 'implemented')),
  github_issue_url        TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at             TIMESTAMPTZ,
  approved_at             TIMESTAMPTZ,
  rejected_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS improvement_capsules_status_created_idx
  ON improvement_capsules (status, created_at DESC);

COMMENT ON TABLE improvement_capsules IS '日次/手動 LLM 分析で生成された改善カプセル（管理者通知・Issue 化）';
