-- Supabase Table Editor で「昔の public テーブル名」を開いてもデータが見えるよう、読み取り専用 VIEW を置く。
-- 実体は near スキーマ。INSERT/UPDATE は near.* 側（アプリ経由）を使うこと。

CREATE OR REPLACE VIEW public.inbound_messages AS
  SELECT * FROM near.near_inbound_messages;
COMMENT ON VIEW public.inbound_messages IS
  '互換VIEW → near.near_inbound_messages。新規確認は near スキーマを推奨。';

CREATE OR REPLACE VIEW public.outbound_messages AS
  SELECT * FROM near.near_outbound_messages;
COMMENT ON VIEW public.outbound_messages IS
  '互換VIEW → near.near_outbound_messages';

CREATE OR REPLACE VIEW public.user_google_oauth_accounts AS
  SELECT * FROM near.near_user_google_oauth_accounts;
COMMENT ON VIEW public.user_google_oauth_accounts IS
  '互換VIEW → near.near_user_google_oauth_accounts';

CREATE OR REPLACE VIEW public.user_google_active_oauth AS
  SELECT * FROM near.near_user_google_active_oauth;
COMMENT ON VIEW public.user_google_active_oauth IS
  '互換VIEW → near.near_user_google_active_oauth';

CREATE OR REPLACE VIEW public.intent_runs AS
  SELECT * FROM near.near_intent_runs;
COMMENT ON VIEW public.intent_runs IS
  '互換VIEW → near.near_intent_runs';

CREATE OR REPLACE VIEW public.tasks AS
  SELECT * FROM near.near_tasks;
COMMENT ON VIEW public.tasks IS
  '互換VIEW → near.near_tasks';

CREATE OR REPLACE VIEW public.reminders AS
  SELECT * FROM near.near_reminders;
COMMENT ON VIEW public.reminders IS
  '互換VIEW → near.near_reminders';

CREATE OR REPLACE VIEW public.user_sheet_defaults AS
  SELECT * FROM near.near_user_sheet_defaults;
COMMENT ON VIEW public.user_sheet_defaults IS
  '互換VIEW → near.near_user_sheet_defaults';
