-- グループと個人の会話コンテキストを分離するため、group_id を追加する。
-- NULL = 個人1:1チャット、値あり = グループ/ルームチャット。
-- 既存行は NULL のままで問題なし（個人として扱う）。

ALTER TABLE inbound_messages
  ADD COLUMN IF NOT EXISTS group_id TEXT DEFAULT NULL;

ALTER TABLE outbound_messages
  ADD COLUMN IF NOT EXISTS group_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_inbound_group
  ON inbound_messages (channel, group_id, actor_user_id);

CREATE INDEX IF NOT EXISTS idx_outbound_group
  ON outbound_messages (channel, group_id, channel_user_id, inbound_message_id DESC);
