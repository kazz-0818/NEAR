import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATION_FILES = ["001_init.sql", "002_growth.sql"] as const;

/** Idempotent: safe to run on every server start. */
export async function ensureSchema(): Promise<void> {
  const pool = getPool();
  for (const name of MIGRATION_FILES) {
    const sqlPath = join(__dirname, "migrations", name);
    const sql = await readFile(sqlPath, "utf-8");
    await pool.query(sql);
  }
}
