-- unsupported 以外の「実質未解決」シグナル（エージェント経路等）

CREATE TABLE IF NOT EXISTS growth_candidate_signals (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  inbound_message_id BIGINT REFERENCES inbound_messages (id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'line',
  channel_user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  parsed_intent_snapshot JSONB
);

CREATE INDEX IF NOT EXISTS idx_growth_candidate_signals_created ON growth_candidate_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_candidate_signals_source ON growth_candidate_signals (source);
CREATE INDEX IF NOT EXISTS idx_growth_candidate_signals_user ON growth_candidate_signals (channel, channel_user_id);
