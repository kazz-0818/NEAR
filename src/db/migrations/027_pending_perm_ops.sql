-- 権限操作の確認待ち保留テーブル
-- 管理者が名前で権限付与/削除を依頼し、確認待ち中の操作を保存する

CREATE TABLE IF NOT EXISTS pending_perm_ops (
  actor_line_user_id  TEXT         PRIMARY KEY,
  op_type             TEXT         NOT NULL CHECK (op_type IN ('grant', 'revoke')),
  stage               TEXT         NOT NULL DEFAULT 'pick'
                                   CHECK (stage IN ('pick', 'confirm')),
  candidates_json     JSONB        NOT NULL,  -- [{lineUserId, displayName}]
  target_line_user_id TEXT,                   -- 確認ステージで確定したターゲット
  target_display_name TEXT,
  role                TEXT,                   -- grant の場合のみ
  notes               TEXT,
  expires_at          TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_perm_ops_expires ON pending_perm_ops (expires_at);

COMMENT ON TABLE pending_perm_ops IS '権限操作の名前検索→確認フローで保留中の操作を保持する（短期）';
