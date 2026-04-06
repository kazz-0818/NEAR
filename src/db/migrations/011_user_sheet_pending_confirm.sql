-- スプレッドシート Drive 検索で「第一候補でよいか」確認中のブック ID（短期）
CREATE TABLE IF NOT EXISTS user_sheet_pending_confirm (
  line_user_id TEXT PRIMARY KEY,
  spreadsheet_id TEXT NOT NULL,
  suggested_name TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sheet_pending_confirm_expires_idx
  ON user_sheet_pending_confirm (expires_at);
