import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import pg from "pg";
import { pgPoolConfig } from "./poolConfig.js";

loadDotenv();

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sqlPath = join(__dirname, "migrations", "001_init.sql");
  const sql = await readFile(sqlPath, "utf-8");
  const pool = new pg.Pool(pgPoolConfig(url));
  try {
    await pool.query(sql);
    console.log("Migration 001_init.sql applied.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
