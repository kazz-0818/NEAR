-- エージェントターンごとの Web 検索ツール付与判定ログ

CREATE TABLE IF NOT EXISTS agent_search_runs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  inbound_message_id BIGINT REFERENCES inbound_messages (id) ON DELETE SET NULL,
  policy_enabled BOOLEAN NOT NULL,
  attached_web_search BOOLEAN NOT NULL,
  reason_code TEXT NOT NULL,
  user_text_chars INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agent_search_runs_inbound ON agent_search_runs (inbound_message_id);
CREATE INDEX IF NOT EXISTS idx_agent_search_runs_created ON agent_search_runs (created_at DESC);
