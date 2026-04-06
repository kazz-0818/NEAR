-- エージェント経由の副作用ツール実行前確認（DB に保存した args のみで確定実行）

CREATE TABLE IF NOT EXISTS pending_tool_confirmations (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tool_name TEXT NOT NULL,
  args_json JSONB NOT NULL,
  inbound_message_id BIGINT REFERENCES inbound_messages (id) ON DELETE SET NULL,
  confirmation_nonce TEXT NOT NULL UNIQUE,
  CONSTRAINT pending_tool_confirmations_status_check CHECK (status IN ('pending', 'executed', 'cancelled', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_tool_confirm_active_user
  ON pending_tool_confirmations (channel, channel_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_tool_confirm_expires ON pending_tool_confirmations (expires_at);
