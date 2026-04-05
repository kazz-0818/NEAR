-- 1 グループ/ルームにつき 1 行に統一し、Webhook からの自動 UPSERT を可能にする

ALTER TABLE near_line_groups ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE near_line_groups ADD COLUMN IF NOT EXISTS source_kind TEXT;

ALTER TABLE near_line_groups DROP CONSTRAINT IF EXISTS near_line_groups_line_group_or_room_id_purpose_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_near_line_groups_line_id ON near_line_groups (line_group_or_room_id);

COMMENT ON TABLE near_line_groups IS 'LINE グループ/ルーム ID。Webhook でメッセージを受けたときに自動登録・更新。進化グループの動作は GROWTH_APPROVAL_GROUP_ID。';
COMMENT ON COLUMN near_line_groups.last_seen_at IS '最後に Webhook で観測した時刻';
COMMENT ON COLUMN near_line_groups.source_kind IS 'group または room';
COMMENT ON COLUMN near_line_groups.purpose IS 'discovered=自動検出直後。手で編集可';
