-- user_sheet_defaults に最後に使ったシートIDを追記
-- 「URLリンク出して」などで前回のシートURLを返せるようにする
ALTER TABLE user_sheet_defaults
  ADD COLUMN IF NOT EXISTS last_queried_spreadsheet_id TEXT,
  ADD COLUMN IF NOT EXISTS last_queried_at TIMESTAMPTZ;

-- user_sheet_defaults に行がないユーザー向けに単独でも insert できるよう対応
-- (spreadsheet_id を NULL 許容に変更)
ALTER TABLE user_sheet_defaults
  ALTER COLUMN spreadsheet_id DROP NOT NULL;
