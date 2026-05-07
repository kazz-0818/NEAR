-- pending_perm_ops の stage に await_role を追加
-- 名前は取れたがロールが未指定のとき、次の発言でロールを受け取るためのステージ
ALTER TABLE pending_perm_ops
  DROP CONSTRAINT IF EXISTS pending_perm_ops_stage_check;

ALTER TABLE pending_perm_ops
  ADD CONSTRAINT pending_perm_ops_stage_check
    CHECK (stage IN ('pick', 'confirm', 'await_role'));
