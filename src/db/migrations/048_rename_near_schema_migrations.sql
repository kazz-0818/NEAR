-- NEAR のマイグレ履歴テーブルを SERA の sera_schema_migrations と同様、public.near_schema_migrations に統一する。
-- 旧名 public.schema_migrations は起動時 ensureSchema でも先にリネームする（本ファイルは冪等）。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'schema_migrations'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'near_schema_migrations'
  ) THEN
    ALTER TABLE public.schema_migrations RENAME TO near_schema_migrations;
  END IF;
END $$;
