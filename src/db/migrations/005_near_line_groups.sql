-- LINE グループ／トークルーム ID のメモ用一覧（Supabase テーブルエディタで見る・編集するだけ）
-- アプリはこのテーブルを読まない。進化／承認グループの実体は GROWTH_APPROVAL_GROUP_ID（環境変数）。

CREATE TABLE IF NOT EXISTS near_line_groups (
  id BIGSERIAL PRIMARY KEY,
  line_group_or_room_id TEXT NOT NULL,
  label TEXT,
  purpose TEXT NOT NULL DEFAULT 'growth_approval',
  notify_push BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (line_group_or_room_id, purpose)
);

CREATE INDEX IF NOT EXISTS idx_near_line_groups_lookup
  ON near_line_groups (purpose, enabled, line_group_or_room_id);

COMMENT ON TABLE near_line_groups IS '運用メモ用。アプリ未参照。実際の進化グループは GROWTH_APPROVAL_GROUP_ID。';
COMMENT ON COLUMN near_line_groups.line_group_or_room_id IS 'Webhook source.groupId または source.roomId';
COMMENT ON COLUMN near_line_groups.label IS 'メモ（例: ニア進化カプセル）';
COMMENT ON COLUMN near_line_groups.purpose IS '分類メモ用（アプリは未使用）';
COMMENT ON COLUMN near_line_groups.notify_push IS '未使用（アプリは参照しない）';
COMMENT ON COLUMN near_line_groups.enabled IS '未使用（アプリは参照しない）';
