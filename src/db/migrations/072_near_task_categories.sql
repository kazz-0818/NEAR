-- タスクカテゴリ（個人 / グループ共有は group_id で区別）
CREATE TABLE IF NOT EXISTS near.near_task_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL DEFAULT 'line',
  channel_user_id TEXT NOT NULL,
  group_id TEXT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_near_task_categories_personal_slug
  ON near.near_task_categories (channel_user_id, slug)
  WHERE group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_near_task_categories_group_slug
  ON near.near_task_categories (channel_user_id, group_id, slug)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_near_task_categories_user
  ON near.near_task_categories (channel_user_id, group_id);

ALTER TABLE near.near_tasks
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES near.near_task_categories (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_near_tasks_category_id
  ON near.near_tasks (category_id)
  WHERE category_id IS NOT NULL;

COMMENT ON TABLE near.near_task_categories IS 'LINE ユーザー単位のタスクカテゴリ（グループは group_id で共有）';
COMMENT ON COLUMN near.near_tasks.category_id IS 'near_task_categories への参照（任意）';
