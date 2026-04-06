-- Drive 候補リストから番号で選ぶ（LINE で「1」「2番」など）
CREATE TABLE IF NOT EXISTS user_sheet_pending_pick (
  line_user_id TEXT PRIMARY KEY,
  options_json JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sheet_pending_pick_expires_idx ON user_sheet_pending_pick (expires_at);
