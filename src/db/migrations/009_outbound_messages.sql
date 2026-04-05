-- NEAR（ボット）側の返答テキスト。続きの一言（円マークつけて等）で文脈を踏むために保持する。

CREATE TABLE IF NOT EXISTS outbound_messages (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  inbound_message_id BIGINT REFERENCES inbound_messages (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_user_created
  ON outbound_messages (channel, channel_user_id, inbound_message_id DESC);
