import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./client.js";
import { getLogger } from "../lib/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATION_FILES = [
  "001_init.sql",
  "002_growth.sql",
  "003_growth_flow.sql",
  "004_growth_user_flow.sql",
  "005_near_line_groups.sql",
  "006_near_line_groups_auto_observe.sql",
  "007_user_sheet_defaults.sql",
  "008_user_google_oauth.sql",
  "009_outbound_messages.sql",
  "010_self_growth_audit.sql",
  "011_user_sheet_pending_confirm.sql",
  "012_user_google_oauth_multi.sql",
  "013_user_sheet_pending_pick.sql",
  "014_agent_tool_runs.sql",
  "015_pending_tool_confirmations.sql",
  "016_agent_search_runs.sql",
  "017_agent_search_runs_tool_names.sql",
  "018_growth_funnel.sql",
  "019_growth_candidate_signals.sql",
  "020_growth_signal_buckets.sql",
  "021_growth_unified_promotion.sql",
  "022_enable_rls_public.sql",
  "023_drop_unused_audit_tables.sql",
  "024_user_profiles.sql",
  "025_tasks_group_support.sql",
  "026_user_roles.sql",
  "027_pending_perm_ops.sql",
  "028_sheet_pending_pick_original_query.sql",
  "029_inbound_actor_user_id.sql",
  "030_user_sheet_last_queried.sql",
  "031_pending_perm_await_role.sql",
  "032_pending_perm_channel_scope.sql",
  "033_add_dorei_role.sql",
  "034_fix_slave_constraint.sql",
  "035_tasks_updated_at.sql",
  "036_context_group_id.sql",
  "037_rename_slave_to_restricted_role.sql",
  "038_pending_clarifications.sql",
  "039_line_quote_message_refs.sql",
  "040_growth_github_issue.sql",
  "041_growth_pr_tracking.sql",
  "042_unsupported_routing_category.sql",
  "043_improvement_capsules.sql",
  "044_routing_trace_session_memory.sql",
  "045_near_schema_and_rename.sql",
  "046_veliora_os.sql",
  "047_near_repair_public_stragglers.sql",
  "048_rename_near_schema_migrations.sql",
] as const;

/** 旧名 schema_migrations → near_schema_migrations（Supabase 上で SERA と並べて識別しやすくする） */
const RENAME_LEGACY_MIGRATION_TABLE_SQL = `
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
`;

const CREATE_MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS public.near_schema_migrations (
    filename   TEXT        PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

/** 適用済みマイグレーション一覧をセットで返す */
async function loadApplied(pool: ReturnType<typeof getPool>): Promise<Set<string>> {
  try {
    const r = await pool.query<{ filename: string }>("SELECT filename FROM public.near_schema_migrations");
    return new Set(r.rows.map((row) => row.filename));
  } catch {
    return new Set();
  }
}

/**
 * 未適用のマイグレーションだけを実行する（初回起動以外は高速）。
 * public.near_schema_migrations で適用済みを追跡する（旧 public.schema_migrations は起動時にリネーム）。
 * 既存の SQL は全て IF NOT EXISTS / DO NOTHING 形式で冪等になっている前提。
 */
export async function ensureSchema(): Promise<void> {
  const log = getLogger();
  const pool = getPool();

  await pool.query(RENAME_LEGACY_MIGRATION_TABLE_SQL);
  await pool.query(CREATE_MIGRATION_TABLE_SQL);

  const applied = await loadApplied(pool);
  const pending = MIGRATION_FILES.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    log.info("ensureSchema: all migrations already applied, nothing to do");
    return;
  }

  log.info({ count: pending.length }, "ensureSchema: applying pending migrations");

  for (const name of pending) {
    const sqlPath = join(__dirname, "migrations", name);
    const sql = await readFile(sqlPath, "utf-8");
    await pool.query(sql);
    await pool.query(
      "INSERT INTO public.near_schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
      [name]
    );
    log.info({ migration: name }, "migration applied");
  }

  log.info({ count: pending.length }, "ensureSchema: done");
}
