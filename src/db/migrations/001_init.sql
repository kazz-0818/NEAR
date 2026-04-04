-- NEAR MVP schema

CREATE TABLE IF NOT EXISTS inbound_messages (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'line',
  channel_user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  text TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, message_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_created ON inbound_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_user ON inbound_messages (channel, channel_user_id);

CREATE TABLE IF NOT EXISTS intent_runs (
  id BIGSERIAL PRIMARY KEY,
  inbound_message_id BIGINT NOT NULL REFERENCES inbound_messages (id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  raw_output JSONB,
  parsed JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intent_inbound ON intent_runs (inbound_message_id);

CREATE TABLE IF NOT EXISTS tasks (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'line',
  channel_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memos (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'line',
  channel_user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminders (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'line',
  channel_user_id TEXT NOT NULL,
  remind_at TIMESTAMPTZ NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (status, remind_at);

CREATE TABLE IF NOT EXISTS unsupported_requests (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'line',
  channel_user_id TEXT NOT NULL,
  original_message TEXT NOT NULL,
  detected_intent TEXT,
  why_unsupported TEXT,
  suggested_implementation_category TEXT,
  priority INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'logged',
  notes TEXT,
  confidence NUMERIC,
  inbound_message_id BIGINT REFERENCES inbound_messages (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unsupported_created ON unsupported_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unsupported_intent ON unsupported_requests (detected_intent);

CREATE TABLE IF NOT EXISTS implementation_suggestions (
  id BIGSERIAL PRIMARY KEY,
  unsupported_request_id BIGINT NOT NULL REFERENCES unsupported_requests (id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  required_apis JSONB NOT NULL DEFAULT '[]',
  new_modules JSONB NOT NULL DEFAULT '[]',
  data_stores JSONB NOT NULL DEFAULT '[]',
  steps JSONB NOT NULL DEFAULT '[]',
  difficulty TEXT,
  priority_score INT,
  raw_llm JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suggestions_unsupported ON implementation_suggestions (unsupported_request_id);
