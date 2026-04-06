-- LINE ユーザーごとの Google OAuth（ユーザー権限で Sheets 読取）
-- ワンタイム用: ブラウザ連携開始 URL に埋め込むトークン

CREATE TABLE IF NOT EXISTS google_oauth_link_tokens (
  token TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_oauth_link_expires ON google_oauth_link_tokens (expires_at);

-- ユーザーごとのトークンは 012_user_google_oauth_multi.sql の user_google_oauth_accounts へ移行済み
