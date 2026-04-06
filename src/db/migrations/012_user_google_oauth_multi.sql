-- LINE 1人あたり複数 Google アカウント（user_google_oauth からの移行）

CREATE TABLE IF NOT EXISTS user_google_oauth_accounts (
  id BIGSERIAL PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  email TEXT,
  refresh_token_ciphertext TEXT NOT NULL,
  scope TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (line_user_id, google_sub)
);

CREATE INDEX IF NOT EXISTS idx_ugoa_line ON user_google_oauth_accounts (line_user_id);

CREATE TABLE IF NOT EXISTS user_google_active_oauth (
  line_user_id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_google_oauth'
  ) THEN
    INSERT INTO user_google_oauth_accounts (
      line_user_id, google_sub, email, refresh_token_ciphertext, scope, updated_at
    )
    SELECT
      line_user_id,
      'legacy:' || line_user_id,
      NULL,
      refresh_token_ciphertext,
      COALESCE(scope, ''),
      updated_at
    FROM user_google_oauth
    ON CONFLICT (line_user_id, google_sub) DO NOTHING;

    INSERT INTO user_google_active_oauth (line_user_id, google_sub, updated_at)
    SELECT line_user_id, 'legacy:' || line_user_id, updated_at
    FROM user_google_oauth
    ON CONFLICT (line_user_id) DO NOTHING;

    DROP TABLE user_google_oauth;
  END IF;
END $$;
