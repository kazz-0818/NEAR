-- user_roles.role の CHECK 制約を完全に入れ替える
-- 033 の DROP が効かない場合に備え、role 列に関連する CHECK を全て洗い出して DROP する

DO $$
DECLARE
  cname TEXT;
BEGIN
  -- user_roles テーブルの CHECK 制約を全て取得して DROP
  FOR cname IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_name = cc.constraint_name
         AND tc.constraint_schema = cc.constraint_schema
    WHERE tc.table_name   = 'user_roles'
      AND tc.table_schema = current_schema()
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS %I', cname);
  END LOOP;
END $$;

-- slave を含む最新の制約を追加（IF NOT EXISTS は使えないので DO $$ で守る）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_name = cc.constraint_name
    WHERE tc.table_name      = 'user_roles'
      AND tc.table_schema    = current_schema()
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause    ILIKE '%slave%'
  ) THEN
    ALTER TABLE user_roles
      ADD CONSTRAINT user_roles_role_check
        CHECK (role IN ('slave', 'guest', 'member', 'admin', 'developer'));
  END IF;
END $$;
