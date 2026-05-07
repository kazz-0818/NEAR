-- Drive 候補選択保留テーブルに元の質問文を追加
-- 番号で候補を選んだ後も「2月の売上は？」などの元の質問を使えるようにする
ALTER TABLE user_sheet_pending_pick
  ADD COLUMN IF NOT EXISTS original_query TEXT;
