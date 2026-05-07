-- ユーザー権限テーブル
-- レベル: guest(1) < member(2) < admin(3) < developer(4)
-- 未登録ユーザーはデフォルト guest として扱う（行がなくてもよい）

CREATE TABLE IF NOT EXISTS user_roles (
  line_user_id TEXT     PRIMARY KEY,
  role         TEXT     NOT NULL DEFAULT 'guest'
                        CHECK (role IN ('guest', 'member', 'admin', 'developer')),
  granted_by   TEXT,                        -- 付与した人の LINE userId
  notes        TEXT,                        -- メモ（「○○部 田中」など）
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles (role);

COMMENT ON TABLE  user_roles IS 'LINE ユーザーの権限レベル。未登録は guest 扱い。';
COMMENT ON COLUMN user_roles.role IS 'guest | member | admin | developer';
COMMENT ON COLUMN user_roles.granted_by IS '権限を付与した LINE userId（developer の自動セットは NULL）';
