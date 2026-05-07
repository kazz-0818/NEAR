-- tasks: グループタスク・作成者対応
-- channel_user_id はグループ/個人どちらも保持（後方互換）
-- actor_user_id: グループ内で実際に発言したユーザーのLINE userId
-- group_id:      グループ/トークルームID（個人1:1 の場合は NULL）
-- task_scope:    'personal'（個人）| 'group'（グループ全体で共有）

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS actor_user_id TEXT,
  ADD COLUMN IF NOT EXISTS group_id      TEXT,
  ADD COLUMN IF NOT EXISTS task_scope    TEXT NOT NULL DEFAULT 'personal';

CREATE INDEX IF NOT EXISTS idx_tasks_actor   ON tasks (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_group   ON tasks (group_id);
CREATE INDEX IF NOT EXISTS idx_tasks_scope   ON tasks (task_scope, channel_user_id);

COMMENT ON COLUMN tasks.actor_user_id IS 'タスクを作ったLINEユーザーのuserId（グループでは発言者を特定するために必要）';
COMMENT ON COLUMN tasks.group_id      IS 'グループ/トークルームID。個人1:1はNULL。';
COMMENT ON COLUMN tasks.task_scope    IS 'personal=個人タスク, group=グループ共有タスク';

-- memos にも同様に追加
ALTER TABLE memos
  ADD COLUMN IF NOT EXISTS actor_user_id TEXT,
  ADD COLUMN IF NOT EXISTS group_id      TEXT;

COMMENT ON COLUMN memos.actor_user_id IS 'メモを作ったLINEユーザーのuserId';
COMMENT ON COLUMN memos.group_id      IS 'グループ/トークルームID。個人1:1はNULL。';

-- reminders にも追加
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS actor_user_id TEXT,
  ADD COLUMN IF NOT EXISTS group_id      TEXT;

COMMENT ON COLUMN reminders.actor_user_id IS 'リマインドを登録したLINEユーザーのuserId';
COMMENT ON COLUMN reminders.group_id      IS 'グループ/トークルームID。個人1:1はNULL。';
