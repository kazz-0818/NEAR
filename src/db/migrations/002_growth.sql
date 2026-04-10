-- NEAR growth system: richer unsupported logging, suggestion workflow, admin notify cooldown

ALTER TABLE unsupported_requests
  ADD COLUMN IF NOT EXISTS message_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS improvement_kind TEXT NOT NULL DEFAULT 'new_module';

ALTER TABLE implementation_suggestions
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_notes TEXT,
  ADD COLUMN IF NOT EXISTS cursor_prompt TEXT,
  ADD COLUMN IF NOT EXISTS improvement_kind TEXT,
  ADD COLUMN IF NOT EXISTS risk_level TEXT,
  ADD COLUMN IF NOT EXISTS estimated_effort TEXT;

CREATE INDEX IF NOT EXISTS idx_unsupported_fingerprint ON unsupported_requests(message_fingerprint);
