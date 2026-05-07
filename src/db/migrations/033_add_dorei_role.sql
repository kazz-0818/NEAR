-- 奴隷ロール(slave)の追加
-- レベル: slave(0) < guest(1) < member(2) < admin(3) < developer(4)
-- 未登録ユーザーのデフォルトは引き続き guest。
-- slave は明示的に付与しないと付かない（最低限の挨拶のみ可）。

-- user_roles の CHECK 制約を更新
ALTER TABLE user_roles
  DROP CONSTRAINT IF EXISTS user_roles_role_check;

ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_role_check
    CHECK (role IN ('slave', 'guest', 'member', 'admin', 'developer'));

-- pending_perm_ops の role 列も同様に許容
-- （CHECK が無い場合はスキップ）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'pending_perm_ops'
      AND constraint_name = 'pending_perm_ops_role_check'
  ) THEN
    ALTER TABLE pending_perm_ops DROP CONSTRAINT pending_perm_ops_role_check;
  END IF;
END $$;
