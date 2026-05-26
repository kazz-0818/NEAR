-- タスクとリマインドの紐付け（1文でタスク追加+リマインド用）
ALTER TABLE near.near_reminders
  ADD COLUMN IF NOT EXISTS task_id BIGINT REFERENCES near.near_tasks (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_near_reminders_task_id
  ON near.near_reminders (task_id)
  WHERE task_id IS NOT NULL;

COMMENT ON COLUMN near.near_reminders.task_id IS '紐づく NEAR 内部タスク（near_tasks.id）。NULL は従来どおりメッセージのみのリマインド。';
