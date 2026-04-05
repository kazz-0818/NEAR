-- ユーザーごとの既定 Google スプレッドシート（読み取り用）

CREATE TABLE IF NOT EXISTS user_sheet_defaults (
  line_user_id TEXT PRIMARY KEY,
  spreadsheet_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sheet_defaults_updated ON user_sheet_defaults (updated_at DESC);
