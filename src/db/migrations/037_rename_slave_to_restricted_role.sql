-- user_roles.role: アプリ識別子 slave を restricted に改称（DB 値のみ変更、既存行は UPDATE）。
-- 表示ラベル「制限ユーザー」は TypeScript の ROLE_LABEL。

DO $$
DECLARE
  cname TEXT;
BEGIN
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

UPDATE user_roles SET role = 'restricted' WHERE role = 'slave';

UPDATE pending_perm_ops SET role = 'restricted' WHERE role = 'slave';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_name = cc.constraint_name
         AND tc.constraint_schema = cc.constraint_schema
    WHERE tc.table_name      = 'user_roles'
      AND tc.table_schema    = current_schema()
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause    ILIKE '%restricted%'
      AND cc.check_clause    ILIKE '%guest%'
  ) THEN
    ALTER TABLE user_roles
      ADD CONSTRAINT user_roles_role_check
        CHECK (role IN ('restricted', 'guest', 'member', 'admin', 'developer'));
  END IF;
END $$;
