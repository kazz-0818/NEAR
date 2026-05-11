-- ルーティング trace（デバッグ用）・会話セッションメモリ（短期文脈）・改善候補の拡張

CREATE TABLE IF NOT EXISTS routing_traces (
  trace_id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_user_id                  TEXT        NOT NULL,
  inbound_message_id               BIGINT      NOT NULL REFERENCES inbound_messages (id) ON DELETE CASCADE,
  user_message                     TEXT,
  route                            TEXT        NOT NULL DEFAULT 'started',
  module_name                      TEXT,
  intent                           TEXT,
  confidence                       DOUBLE PRECISION,
  reason                           TEXT,
  used_llm_fallback                BOOLEAN     NOT NULL DEFAULT false,
  used_growth_pipeline             BOOLEAN     NOT NULL DEFAULT false,
  used_improvement_capsule_candidate BOOLEAN   NOT NULL DEFAULT false,
  used_pending                     BOOLEAN     NOT NULL DEFAULT false,
  cleared_pending                  BOOLEAN     NOT NULL DEFAULT false,
  pending_type                     TEXT,
  pending_id                       TEXT,
  sheet_used                       BOOLEAN     NOT NULL DEFAULT false,
  drive_used                       BOOLEAN     NOT NULL DEFAULT false,
  reminder_used                    BOOLEAN     NOT NULL DEFAULT false,
  task_used                        BOOLEAN     NOT NULL DEFAULT false,
  github_used                      BOOLEAN     NOT NULL DEFAULT false,
  final_reply_summary              TEXT,
  meta_json                        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS routing_traces_channel_inbound_idx
  ON routing_traces (channel_user_id, inbound_message_id DESC);

CREATE INDEX IF NOT EXISTS routing_traces_channel_created_idx
  ON routing_traces (channel_user_id, created_at DESC);

COMMENT ON TABLE routing_traces IS 'LINE 1ターンごとのルーティング要約（管理者デバッグ用。秘密情報は入れない）';

CREATE TABLE IF NOT EXISTS conversation_session_memory (
  id                 BIGSERIAL PRIMARY KEY,
  channel_user_id    TEXT        NOT NULL,
  memory_type        TEXT        NOT NULL,
  memory_key         TEXT        NOT NULL DEFAULT '',
  memory_value_json  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source_message_id  BIGINT,
  source_route       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_session_memory_user_type_key_idx
  ON conversation_session_memory (channel_user_id, memory_type, memory_key);

CREATE INDEX IF NOT EXISTS conversation_session_memory_expires_idx
  ON conversation_session_memory (expires_at);

COMMENT ON TABLE conversation_session_memory IS 'ユーザー短期会話文脈（これ/それ/番号解決用）。expires_at 厳守';

ALTER TABLE improvement_candidates
  ADD COLUMN IF NOT EXISTS conversation_window_json JSONB,
  ADD COLUMN IF NOT EXISTS routing_trace_id UUID REFERENCES routing_traces (trace_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expected_route_hint TEXT;
