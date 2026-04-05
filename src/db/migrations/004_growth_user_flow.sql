-- 依頼ユーザー向け成長フロー: アクティブな suggestion を 1 件紐づけ

CREATE TABLE IF NOT EXISTS growth_user_sessions (
  requesting_line_user_id TEXT PRIMARY KEY,
  active_suggestion_id BIGINT REFERENCES implementation_suggestions (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_user_session_suggestion
  ON growth_user_sessions (active_suggestion_id)
  WHERE active_suggestion_id IS NOT NULL;
