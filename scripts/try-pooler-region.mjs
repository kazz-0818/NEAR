#!/usr/bin/env node
/**
 * Session pooler のリージョン当たり（Tenant or user not found 対策）
 * .env の DATABASE_URL から ref・パスワードを拾い、aws-0-*.pooler を試す。
 */
import "dotenv/config";
import pg from "pg";

const urlRaw = process.env.DATABASE_URL || "";
const m = urlRaw.match(
  /^postgresql:\/\/postgres\.([^:]+):([^@]+)@aws-0-([^.]+)\.pooler\.supabase\.com/
);
if (!m) {
  console.error("DATABASE_URL が postgres.<ref>@aws-0-REGION.pooler... 形式ではありません。");
  process.exit(1);
}
const ref = m[1];
let pass = decodeURIComponent(m[2]);
const regions = [
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-southeast-1",
  "ap-south-1",
  "us-east-1",
  "us-west-1",
  "eu-west-1",
  "eu-central-1",
  "sa-east-1",
];

for (const region of regions) {
  const enc = encodeURIComponent(pass);
  const conn = `postgresql://postgres.${ref}:${enc}@aws-0-${region}.pooler.supabase.com:5432/postgres`;
  const pool = new pg.Pool({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const r = await pool.query("select 1 as ok");
    console.log("OK region:", region, r.rows[0]);
    console.log("");
    console.log("DATABASE_URL=" + conn);
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error("NG", region, e.message);
  } finally {
    await pool.end().catch(() => {});
  }
}
console.error("どのリージョンでも繋がりませんでした。パスワード・プロジェクト状態を確認してください。");
process.exit(1);
