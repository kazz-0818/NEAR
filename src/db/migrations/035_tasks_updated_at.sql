-- tasks に updated_at を追加（タスク完了・編集時刻管理用）
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- reminders に group_id / actor_user_id の INSERT 対応（カラムは 025 で追加済み・NULL OK）
-- 025 で ADD COLUMN IF NOT EXISTS しているため追加作業は不要
