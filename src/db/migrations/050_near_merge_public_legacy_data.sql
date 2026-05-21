-- public に残った「フォルダ分け前」の実テーブル行を near.* へ統合する（冪等）。
-- 049 の VIEW がある環境では public.inbound_messages は VIEW のためスキップし、
-- public.near_inbound_messages などリネーム済みで public に残った実テーブルを対象にする。

CREATE SCHEMA IF NOT EXISTS near;

CREATE OR REPLACE FUNCTION near._is_base_table(p_schema text, p_rel text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = p_schema
      AND c.relname = p_rel
      AND c.relkind = 'r'
  );
$$;

CREATE OR REPLACE FUNCTION near._legacy_has_column(p_schema text, p_rel text, p_col text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = p_schema
      AND table_name = p_rel
      AND column_name = p_col
  );
$$;

-- 動的 SQL 用: 列があれば l.<col>、なければ default 式を返す
CREATE OR REPLACE FUNCTION near._legacy_col_expr(
  p_schema text, p_rel text, p_col text, p_expr text, p_default text
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN near._legacy_has_column(p_schema, p_rel, p_col) THEN p_expr
    ELSE p_default
  END;
$$;

DO $$
DECLARE
  src_schema text;
  src_rel text;
  ins_count bigint;
BEGIN
  IF NOT near._is_base_table('near', 'near_inbound_messages') THEN
    RAISE NOTICE 'near_merge: skip (near.near_inbound_messages missing)';
    RETURN;
  END IF;

  CREATE TEMP TABLE _near_inbound_id_map (
    legacy_id bigint NOT NULL PRIMARY KEY,
    near_id bigint NOT NULL
  ) ON COMMIT DROP;

  -- ---- inbound（public.inbound_messages または public.near_inbound_messages）----
  FOR src_schema, src_rel IN
    SELECT * FROM (VALUES
      ('public', 'inbound_messages'),
      ('public', 'near_inbound_messages')
    ) AS t(s, r)
  LOOP
    IF NOT near._is_base_table(src_schema, src_rel) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      $q$
      INSERT INTO near.near_inbound_messages (
        channel, channel_user_id, actor_user_id, group_id, message_id,
        quoted_message_id, message_type, text, raw_payload, created_at
      )
      SELECT
        l.channel,
        l.channel_user_id,
        %s,
        %s,
        l.message_id,
        %s,
        l.message_type,
        l.text,
        l.raw_payload,
        l.created_at
      FROM %I.%I l
      WHERE NOT EXISTS (
        SELECT 1 FROM near.near_inbound_messages n
        WHERE n.channel = l.channel AND n.message_id = l.message_id
      )
      ON CONFLICT (channel, message_id) DO NOTHING
      $q$,
      near._legacy_col_expr(src_schema, src_rel, 'actor_user_id', 'l.actor_user_id', 'l.channel_user_id'),
      near._legacy_col_expr(src_schema, src_rel, 'group_id', 'l.group_id', 'NULL'),
      near._legacy_col_expr(src_schema, src_rel, 'quoted_message_id', 'l.quoted_message_id', 'NULL'),
      src_schema,
      src_rel
    );

    EXECUTE format(
      $q$
      INSERT INTO _near_inbound_id_map (legacy_id, near_id)
      SELECT l.id, n.id
      FROM %I.%I l
      INNER JOIN near.near_inbound_messages n
        ON n.channel = l.channel AND n.message_id = l.message_id
      ON CONFLICT (legacy_id) DO NOTHING
      $q$,
      src_schema,
      src_rel
    );
  END LOOP;

  GET DIAGNOSTICS ins_count = ROW_COUNT;
  RAISE NOTICE 'near_merge: inbound id map rows (last source) %', ins_count;

  -- ---- outbound ----
  IF near._is_base_table('near', 'near_outbound_messages') THEN
    FOR src_schema, src_rel IN
      SELECT * FROM (VALUES
        ('public', 'outbound_messages'),
        ('public', 'near_outbound_messages')
      ) AS t(s, r)
    LOOP
      IF NOT near._is_base_table(src_schema, src_rel) THEN
        CONTINUE;
      END IF;

      EXECUTE format(
        $q$
        INSERT INTO near.near_outbound_messages (
          channel, channel_user_id, group_id, text, inbound_message_id, line_message_id, created_at
        )
        SELECT
          l.channel,
          l.channel_user_id,
          %s,
          l.text,
          m.near_id,
          %s,
          l.created_at
        FROM %I.%I l
        LEFT JOIN _near_inbound_id_map m ON m.legacy_id = l.inbound_message_id
        WHERE NOT EXISTS (
          SELECT 1 FROM near.near_outbound_messages o
          WHERE o.channel = l.channel
            AND o.channel_user_id = l.channel_user_id
            AND o.created_at = l.created_at
            AND o.text = l.text
        )
        $q$,
        near._legacy_col_expr(src_schema, src_rel, 'group_id', 'l.group_id', 'NULL'),
        near._legacy_col_expr(src_schema, src_rel, 'line_message_id', 'l.line_message_id', 'NULL'),
        src_schema,
        src_rel
      );
    END LOOP;
  END IF;

  -- ---- intent_runs ----
  IF near._is_base_table('near', 'near_intent_runs') THEN
    FOR src_schema, src_rel IN
      SELECT * FROM (VALUES
        ('public', 'intent_runs'),
        ('public', 'near_intent_runs')
      ) AS t(s, r)
    LOOP
      IF NOT near._is_base_table(src_schema, src_rel) THEN
        CONTINUE;
      END IF;

      EXECUTE format(
        $q$
        INSERT INTO near.near_intent_runs (inbound_message_id, model, raw_output, parsed, created_at)
        SELECT m.near_id, l.model, l.raw_output, l.parsed, l.created_at
        FROM %I.%I l
        INNER JOIN _near_inbound_id_map m ON m.legacy_id = l.inbound_message_id
        WHERE NOT EXISTS (
          SELECT 1 FROM near.near_intent_runs ir
          WHERE ir.inbound_message_id = m.near_id
            AND ir.created_at = l.created_at
            AND ir.model = l.model
        )
        $q$,
        src_schema,
        src_rel
      );
    END LOOP;
  END IF;

  -- ---- Google OAuth ----
  IF near._is_base_table('near', 'near_user_google_oauth_accounts') THEN
    FOR src_schema, src_rel IN
      SELECT * FROM (VALUES
        ('public', 'user_google_oauth_accounts'),
        ('public', 'near_user_google_oauth_accounts')
      ) AS t(s, r)
    LOOP
      IF NOT near._is_base_table(src_schema, src_rel) THEN
        CONTINUE;
      END IF;

      EXECUTE format(
        $q$
        INSERT INTO near.near_user_google_oauth_accounts (
          line_user_id, google_sub, email, refresh_token_ciphertext, scope, updated_at
        )
        SELECT line_user_id, google_sub, email, refresh_token_ciphertext, scope, updated_at
        FROM %I.%I
        ON CONFLICT (line_user_id, google_sub) DO UPDATE SET
          email = COALESCE(EXCLUDED.email, near.near_user_google_oauth_accounts.email),
          refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
          scope = COALESCE(EXCLUDED.scope, near.near_user_google_oauth_accounts.scope),
          updated_at = GREATEST(EXCLUDED.updated_at, near.near_user_google_oauth_accounts.updated_at)
        $q$,
        src_schema,
        src_rel
      );
    END LOOP;
  END IF;

  IF near._is_base_table('near', 'near_user_google_active_oauth') THEN
    FOR src_schema, src_rel IN
      SELECT * FROM (VALUES
        ('public', 'user_google_active_oauth'),
        ('public', 'near_user_google_active_oauth')
      ) AS t(s, r)
    LOOP
      IF NOT near._is_base_table(src_schema, src_rel) THEN
        CONTINUE;
      END IF;

      EXECUTE format(
        $q$
        INSERT INTO near.near_user_google_active_oauth (line_user_id, google_sub, updated_at)
        SELECT line_user_id, google_sub, updated_at FROM %I.%I
        ON CONFLICT (line_user_id) DO UPDATE SET
          google_sub = EXCLUDED.google_sub,
          updated_at = GREATEST(EXCLUDED.updated_at, near.near_user_google_active_oauth.updated_at)
        $q$,
        src_schema,
        src_rel
      );
    END LOOP;
  END IF;

  -- ---- tasks / reminders / memos / sheet defaults（FK なし）----
  IF near._is_base_table('near', 'near_tasks') THEN
    FOR src_schema, src_rel IN
      SELECT * FROM (VALUES ('public', 'tasks'), ('public', 'near_tasks')) AS t(s, r)
    LOOP
      IF NOT near._is_base_table(src_schema, src_rel) THEN CONTINUE; END IF;
      EXECUTE format(
        $q$INSERT INTO near.near_tasks (
          channel, channel_user_id, actor_user_id, group_id, task_scope,
          title, notes, status, created_at, updated_at
        )
        SELECT channel, channel_user_id,
          %s, %s, %s,
          title, notes, status, created_at, %s
        FROM %I.%I l
        WHERE NOT EXISTS (
          SELECT 1 FROM near.near_tasks t
          WHERE t.channel = l.channel AND t.channel_user_id = l.channel_user_id
            AND t.title = l.title AND t.created_at = l.created_at
        )$q$,
        near._legacy_col_expr(src_schema, src_rel, 'actor_user_id', 'actor_user_id', 'channel_user_id'),
        near._legacy_col_expr(src_schema, src_rel, 'group_id', 'group_id', 'NULL'),
        near._legacy_col_expr(src_schema, src_rel, 'task_scope', 'task_scope', '''personal'''),
        near._legacy_col_expr(src_schema, src_rel, 'updated_at', 'updated_at', 'created_at'),
        src_schema, src_rel
      );
    END LOOP;
  END IF;

  IF near._is_base_table('near', 'near_reminders') THEN
    FOR src_schema, src_rel IN
      SELECT * FROM (VALUES ('public', 'reminders'), ('public', 'near_reminders')) AS t(s, r)
    LOOP
      IF NOT near._is_base_table(src_schema, src_rel) THEN CONTINUE; END IF;
      EXECUTE format(
        $q$INSERT INTO near.near_reminders (
          channel, channel_user_id, actor_user_id, group_id, remind_at, message, status, created_at
        )
        SELECT channel, channel_user_id, %s, %s, remind_at, message, status, created_at
        FROM %I.%I l
        WHERE NOT EXISTS (
          SELECT 1 FROM near.near_reminders r
          WHERE r.channel = l.channel AND r.channel_user_id = l.channel_user_id
            AND r.remind_at = l.remind_at AND r.message = l.message
        )$q$,
        near._legacy_col_expr(src_schema, src_rel, 'actor_user_id', 'actor_user_id', 'channel_user_id'),
        near._legacy_col_expr(src_schema, src_rel, 'group_id', 'group_id', 'NULL'),
        src_schema, src_rel
      );
    END LOOP;
  END IF;

  IF near._is_base_table('near', 'near_user_sheet_defaults') THEN
    FOR src_schema, src_rel IN
      SELECT * FROM (VALUES
        ('public', 'user_sheet_defaults'),
        ('public', 'near_user_sheet_defaults')
      ) AS t(s, r)
    LOOP
      IF NOT near._is_base_table(src_schema, src_rel) THEN CONTINUE; END IF;
      EXECUTE format(
        $q$INSERT INTO near.near_user_sheet_defaults (line_user_id, spreadsheet_id, updated_at)
        SELECT line_user_id, spreadsheet_id, updated_at FROM %I.%I
        ON CONFLICT (line_user_id) DO UPDATE SET
          spreadsheet_id = EXCLUDED.spreadsheet_id,
          updated_at = GREATEST(EXCLUDED.updated_at, near.near_user_sheet_defaults.updated_at)$q$,
        src_schema, src_rel
      );
    END LOOP;
  END IF;

  IF near._is_base_table('near', 'near_memos') THEN
    FOR src_schema, src_rel IN
      SELECT * FROM (VALUES ('public', 'memos'), ('public', 'near_memos')) AS t(s, r)
    LOOP
      IF NOT near._is_base_table(src_schema, src_rel) THEN CONTINUE; END IF;
      EXECUTE format(
        $q$INSERT INTO near.near_memos (channel, channel_user_id, actor_user_id, group_id, body, created_at)
        SELECT channel, channel_user_id, %s, %s, body, created_at
        FROM %I.%I l
        WHERE NOT EXISTS (
          SELECT 1 FROM near.near_memos m
          WHERE m.channel = l.channel AND m.channel_user_id = l.channel_user_id
            AND m.body = l.body AND m.created_at = l.created_at
        )$q$,
        near._legacy_col_expr(src_schema, src_rel, 'actor_user_id', 'actor_user_id', 'channel_user_id'),
        near._legacy_col_expr(src_schema, src_rel, 'group_id', 'group_id', 'NULL'),
        src_schema, src_rel
      );
    END LOOP;
  END IF;

  -- unsupported / implementation_suggestions（inbound ID はマップ後）
  IF near._is_base_table('near', 'near_unsupported_requests') THEN
    CREATE TEMP TABLE _near_unsupported_id_map (
      legacy_id bigint NOT NULL PRIMARY KEY,
      near_id bigint NOT NULL
    ) ON COMMIT DROP;

    FOR src_schema, src_rel IN
      SELECT * FROM (VALUES
        ('public', 'unsupported_requests'),
        ('public', 'near_unsupported_requests')
      ) AS t(s, r)
    LOOP
      IF NOT near._is_base_table(src_schema, src_rel) THEN CONTINUE; END IF;

      EXECUTE format(
        $q$
        INSERT INTO near.near_unsupported_requests (
          channel, channel_user_id, original_message, detected_intent, why_unsupported,
          suggested_implementation_category, priority, status, notes, confidence,
          inbound_message_id, created_at
        )
        SELECT
          l.channel, l.channel_user_id, l.original_message, l.detected_intent, l.why_unsupported,
          l.suggested_implementation_category, l.priority, l.status, l.notes, l.confidence,
          m.near_id, l.created_at
        FROM %I.%I l
        LEFT JOIN _near_inbound_id_map m ON m.legacy_id = l.inbound_message_id
        WHERE NOT EXISTS (
          SELECT 1 FROM near.near_unsupported_requests u
          WHERE u.channel = l.channel
            AND u.channel_user_id = l.channel_user_id
            AND u.original_message = l.original_message
            AND u.created_at = l.created_at
        )
        $q$,
        src_schema, src_rel
      );

      EXECUTE format(
        $q$
        INSERT INTO _near_unsupported_id_map (legacy_id, near_id)
        SELECT l.id, u.id
        FROM %I.%I l
        INNER JOIN near.near_unsupported_requests u
          ON u.channel = l.channel
         AND u.channel_user_id = l.channel_user_id
         AND u.original_message = l.original_message
         AND u.created_at = l.created_at
        ON CONFLICT (legacy_id) DO NOTHING
        $q$,
        src_schema, src_rel
      );
    END LOOP;

    IF near._is_base_table('near', 'near_implementation_suggestions') THEN
      FOR src_schema, src_rel IN
        SELECT * FROM (VALUES
          ('public', 'implementation_suggestions'),
          ('public', 'near_implementation_suggestions')
        ) AS t(s, r)
      LOOP
        IF NOT near._is_base_table(src_schema, src_rel) THEN CONTINUE; END IF;

        EXECUTE format(
          $q$
          INSERT INTO near.near_implementation_suggestions (
            unsupported_request_id, summary, required_apis, new_modules, data_stores,
            steps, difficulty, priority_score, raw_llm, created_at
          )
          SELECT um.near_id, s.summary, s.required_apis, s.new_modules, s.data_stores,
            s.steps, s.difficulty, s.priority_score, s.raw_llm, s.created_at
          FROM %I.%I s
          INNER JOIN _near_unsupported_id_map um ON um.legacy_id = s.unsupported_request_id
          WHERE NOT EXISTS (
            SELECT 1 FROM near.near_implementation_suggestions n
            WHERE n.unsupported_request_id = um.near_id
              AND n.summary = s.summary
              AND n.created_at = s.created_at
          )
          $q$,
          src_schema, src_rel
        );
      END LOOP;
    END IF;
  END IF;

  RAISE NOTICE 'near_merge: public legacy → near.* merge pass completed';
END $$;

-- 統合後: public の実テーブルは DROP せず archive リネーム（051 でも再処理可）
DO $$
DECLARE
  rel_name text;
  archive_name text;
BEGIN
  FOREACH rel_name IN ARRAY ARRAY[
    'inbound_messages', 'near_inbound_messages',
    'outbound_messages', 'near_outbound_messages',
    'user_google_oauth_accounts', 'near_user_google_oauth_accounts',
    'user_google_active_oauth', 'near_user_google_active_oauth',
    'intent_runs', 'near_intent_runs',
    'tasks', 'near_tasks',
    'reminders', 'near_reminders',
    'memos', 'near_memos',
    'user_sheet_defaults', 'near_user_sheet_defaults',
    'unsupported_requests', 'near_unsupported_requests',
    'implementation_suggestions', 'near_implementation_suggestions'
  ]
  LOOP
    IF near._is_base_table('public', rel_name) THEN
      archive_name := rel_name || '_archived_050';
      IF NOT near._is_base_table('public', archive_name) THEN
        EXECUTE format('ALTER TABLE public.%I RENAME TO %I', rel_name, archive_name);
        RAISE NOTICE 'near_merge: archived public.% → %', rel_name, archive_name;
      END IF;
    END IF;
  END LOOP;
END $$;

-- 049 VIEW を再適用（DROP 後に public から旧名で見えるようにする）
CREATE OR REPLACE VIEW public.inbound_messages AS
  SELECT * FROM near.near_inbound_messages;
CREATE OR REPLACE VIEW public.outbound_messages AS
  SELECT * FROM near.near_outbound_messages;
CREATE OR REPLACE VIEW public.user_google_oauth_accounts AS
  SELECT * FROM near.near_user_google_oauth_accounts;
CREATE OR REPLACE VIEW public.user_google_active_oauth AS
  SELECT * FROM near.near_user_google_active_oauth;
CREATE OR REPLACE VIEW public.intent_runs AS
  SELECT * FROM near.near_intent_runs;
CREATE OR REPLACE VIEW public.tasks AS
  SELECT * FROM near.near_tasks;
CREATE OR REPLACE VIEW public.reminders AS
  SELECT * FROM near.near_reminders;
CREATE OR REPLACE VIEW public.user_sheet_defaults AS
  SELECT * FROM near.near_user_sheet_defaults;
CREATE OR REPLACE VIEW public.memos AS
  SELECT * FROM near.near_memos;

COMMENT ON SCHEMA near IS 'NEAR 実データ（public 旧テーブルは 050 で統合済み。public.* は読み取り専用 VIEW）';
