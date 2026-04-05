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
