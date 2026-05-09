CREATE TABLE IF NOT EXISTS pending_clarifications (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  actor_user_id TEXT NULL,
  group_id TEXT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  required_slot TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  inbound_message_id BIGINT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_clarifications_lookup
  ON pending_clarifications (channel, channel_user_id, actor_user_id, group_id, status, expires_at DESC);
