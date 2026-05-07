-- LINE ユーザープロフィールキャッシュ（表示名・顔写真・メモ）
CREATE TABLE IF NOT EXISTS line_user_profiles (
  line_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  picture_url  TEXT,
  language     TEXT,
  memo         TEXT,           -- ユーザーの特徴・好み・注意点メモ（将来の自己学習用）
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  line_user_profiles IS 'LINE Profile API で取得したユーザー情報のキャッシュ。表示名でNEARが名前呼びするために使う。';
COMMENT ON COLUMN line_user_profiles.memo IS 'ユーザーごとの特徴・好み・注意点の自由記述（管理者が手動記入 or 将来自動学習）';
