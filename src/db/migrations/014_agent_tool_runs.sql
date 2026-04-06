-- エージェント経路のカスタムツール実行ログ（運用・デバッグ用）

CREATE TABLE IF NOT EXISTS agent_tool_runs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  inbound_message_id BIGINT REFERENCES inbound_messages (id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  situation TEXT,
  duration_ms INTEGER,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_runs_inbound ON agent_tool_runs (inbound_message_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_runs_created ON agent_tool_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tool_runs_user ON agent_tool_runs (channel, channel_user_id);
