import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Idempotent: safe to run on every server start. */
export async function ensureSchema(): Promise<void> {
  const sqlPath = join(__dirname, "migrations", "001_init.sql");
  const sql = await readFile(sqlPath, "utf-8");
  await getPool().query(sql);
}
