-- agent 時代の成長フロー: バケット昇格・ファネル相関・合成 unsupported

ALTER TABLE unsupported_requests
  ADD COLUMN IF NOT EXISTS entry_source TEXT NOT NULL DEFAULT 'intent_routed',
  ADD COLUMN IF NOT EXISTS growth_signal_bucket_id BIGINT REFERENCES growth_signal_buckets (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_unsupported_entry_source ON unsupported_requests (entry_source);
CREATE INDEX IF NOT EXISTS idx_unsupported_growth_bucket ON unsupported_requests (growth_signal_bucket_id)
  WHERE growth_signal_bucket_id IS NOT NULL;

ALTER TABLE growth_signal_buckets
  ADD COLUMN IF NOT EXISTS last_user_text TEXT,
  ADD COLUMN IF NOT EXISTS last_channel_user_id TEXT,
  ADD COLUMN IF NOT EXISTS last_inbound_message_id BIGINT,
  ADD COLUMN IF NOT EXISTS last_parsed_intent JSONB,
  ADD COLUMN IF NOT EXISTS implementation_suggestion_id BIGINT REFERENCES implementation_suggestions (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_growth_buckets_impl_suggestion ON growth_signal_buckets (implementation_suggestion_id)
  WHERE implementation_suggestion_id IS NOT NULL;

ALTER TABLE growth_funnel_events
  ADD COLUMN IF NOT EXISTS growth_signal_bucket_id BIGINT REFERENCES growth_signal_buckets (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS implementation_suggestion_id BIGINT REFERENCES implementation_suggestions (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_growth_funnel_bucket ON growth_funnel_events (growth_signal_bucket_id)
  WHERE growth_signal_bucket_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unsupported_one_per_growth_bucket
  ON unsupported_requests (growth_signal_bucket_id)
  WHERE growth_signal_bucket_id IS NOT NULL;
