-- 成長候補シグナルの集約バケット（重複排除ビュー・優先度の土台）
-- raw の growth_candidate_signals は監査用に残し、bucket で「同種の再現」を数える。

CREATE TABLE IF NOT EXISTS growth_signal_buckets (
  id BIGSERIAL PRIMARY KEY,
  bucket_key TEXT NOT NULL UNIQUE,
  user_message_fingerprint TEXT,
  channel TEXT NOT NULL DEFAULT 'line',
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count INT NOT NULL DEFAULT 1,
  priority_score SMALLINT NOT NULL DEFAULT 50,
  primary_source TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_growth_signal_buckets_last ON growth_signal_buckets (last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_growth_signal_buckets_pri_last ON growth_signal_buckets (priority_score DESC, last_seen DESC);

ALTER TABLE growth_candidate_signals
  ADD COLUMN IF NOT EXISTS bucket_id BIGINT REFERENCES growth_signal_buckets (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_message_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS bucket_key TEXT,
  ADD COLUMN IF NOT EXISTS priority_score SMALLINT;

CREATE INDEX IF NOT EXISTS idx_growth_candidate_signals_bucket_key ON growth_candidate_signals (bucket_key);
