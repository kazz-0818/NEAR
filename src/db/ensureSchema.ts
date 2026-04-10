import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./client.js";

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
] as const;

/** Idempotent: safe to run on every server start. */
export async function ensureSchema(): Promise<void> {
  const pool = getPool();
  for (const name of MIGRATION_FILES) {
    const sqlPath = join(__dirname, "migrations", name);
    const sql = await readFile(sqlPath, "utf-8");
    await pool.query(sql);
  }
}
