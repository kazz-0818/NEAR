-- IRIE: 観測した LINE グループ／ルーム ID（メイングループ特定・運用メモ用）

CREATE TABLE IF NOT EXISTS irie.line_group_registry (
  chat_id              TEXT PRIMARY KEY,
  chat_kind            TEXT NOT NULL CHECK (chat_kind IN ('group', 'room')),
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_text_preview    TEXT,
  last_respond_reason  TEXT,
  hit_count            BIGINT NOT NULL DEFAULT 1
);

COMMENT ON TABLE irie.line_group_registry IS
  'IRIE Webhook で観測した LINE groupId / roomId。LINE_MAIN_GROUP_ID 設定前の GID 調査に使用。';

-- レガシー lira schema 上の同名テーブルが残っていれば irie へ移す
DO $$
BEGIN
  IF to_regclass('lira.line_group_registry') IS NOT NULL
     AND to_regclass('irie.line_group_registry') IS NULL THEN
    ALTER TABLE lira.line_group_registry SET SCHEMA irie;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.upsert_lira_line_group_registry(text, text, text, text);

CREATE OR REPLACE FUNCTION public.upsert_irie_line_group_registry(
  p_chat_id text,
  p_chat_kind text,
  p_last_text_preview text DEFAULT NULL,
  p_last_respond_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = irie, public
AS $$
BEGIN
  INSERT INTO irie.line_group_registry (
    chat_id, chat_kind, last_text_preview, last_respond_reason
  )
  VALUES (p_chat_id, p_chat_kind, p_last_text_preview, p_last_respond_reason)
  ON CONFLICT (chat_id) DO UPDATE SET
    last_seen_at = now(),
    last_text_preview = COALESCE(EXCLUDED.last_text_preview, irie.line_group_registry.last_text_preview),
    last_respond_reason = COALESCE(EXCLUDED.last_respond_reason, irie.line_group_registry.last_respond_reason),
    hit_count = irie.line_group_registry.hit_count + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_irie_line_group_registry(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_irie_line_group_registry(text, text, text, text) TO service_role;

DROP VIEW IF EXISTS public.lira_line_group_registry;

CREATE OR REPLACE VIEW public.irie_line_group_registry
WITH (security_invoker = true) AS
  SELECT
    chat_id,
    chat_kind,
    first_seen_at,
    last_seen_at,
    last_text_preview,
    last_respond_reason,
    hit_count
  FROM irie.line_group_registry;

COMMENT ON VIEW public.irie_line_group_registry IS
  'IRIE が Webhook で観測した LINE groupId / roomId 一覧（読取専用）。';

GRANT USAGE ON SCHEMA irie TO service_role;
GRANT SELECT, INSERT, UPDATE ON irie.line_group_registry TO service_role;
GRANT SELECT ON public.irie_line_group_registry TO service_role;
