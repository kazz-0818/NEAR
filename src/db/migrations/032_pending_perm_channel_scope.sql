-- pending_perm_ops にチャンネルスコープを追加
-- グループ A での権限操作が グループ B に引き継がれないようにする
ALTER TABLE pending_perm_ops
  ADD COLUMN IF NOT EXISTS channel_id TEXT;
