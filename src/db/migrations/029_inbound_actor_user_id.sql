-- inbound_messages にグループ内発言者 ID を追加
-- グループ会話での会話履歴をメンバー別に取得できるようにする
ALTER TABLE inbound_messages
  ADD COLUMN IF NOT EXISTS actor_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_inbound_actor ON inbound_messages (channel, actor_user_id)
  WHERE actor_user_id IS NOT NULL;
