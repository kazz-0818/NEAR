-- 成長パイプライン各段階の観測用（gate / suggestion / 通知）

CREATE TABLE IF NOT EXISTS growth_funnel_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  inbound_message_id BIGINT REFERENCES inbound_messages (id) ON DELETE SET NULL,
  unsupported_request_id BIGINT REFERENCES unsupported_requests (id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'line',
  channel_user_id TEXT NOT NULL DEFAULT '',
  step TEXT NOT NULL,
  allowed BOOLEAN,
  reason_code TEXT,
  detail JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_growth_funnel_created ON growth_funnel_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_funnel_unsupported ON growth_funnel_events (unsupported_request_id);
CREATE INDEX IF NOT EXISTS idx_growth_funnel_step ON growth_funnel_events (step);
CREATE INDEX IF NOT EXISTS idx_growth_funnel_inbound ON growth_funnel_events (inbound_message_id);

ALTER TABLE unsupported_requests
  ADD COLUMN IF NOT EXISTS growth_gate_allow BOOLEAN,
  ADD COLUMN IF NOT EXISTS growth_gate_reason TEXT,
  ADD COLUMN IF NOT EXISTS growth_gate_evaluated_at TIMESTAMPTZ;
